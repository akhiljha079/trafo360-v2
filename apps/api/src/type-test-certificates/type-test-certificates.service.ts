import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { NOTIFICATION_EVENTS } from "@trafo360/shared";
import { AuditService } from "../common/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { computeExpiryStatus, daysUntil, EXPIRY_WARNING_DAYS, isReminderDue } from "./certificate-expiry";
import { CreateCertificateDto, RenewCertificateDto } from "./dto/certificate.dto";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB - certificates are small scanned/printed PDFs

const certificateInclude = {
  uploadedBy: { select: { id: true, name: true } },
} as const;

function withExpiryStatus<T extends { expiryDate: Date }>(cert: T) {
  return { ...cert, ...computeExpiryStatus(cert.expiryDate, new Date()) };
}

/** Type Test Certificate registry (standalone - not tied to a project, since
 * a type test is done once per transformer type/rating and reused across
 * whichever projects build that type). Reminders start once a certificate
 * has <=30 days left and repeat every 4 days - including after expiry -
 * until it's renewed with a new file and a new (future) expiry date, which
 * naturally moves it out of the warning window and stops the cycle. */
@Injectable()
export class TypeTestCertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  private validateFile(file: Express.Multer.File) {
    if (!file) throw new BadRequestException("A certificate file is required");
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(`File exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`);
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`File type "${file.mimetype}" is not permitted - upload a PDF or scanned image`);
    }
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  }

  async list() {
    const certificates = await this.prisma.typeTestCertificate.findMany({
      include: certificateInclude,
      orderBy: { expiryDate: "asc" },
    });
    return certificates.map(withExpiryStatus);
  }

  async get(id: string) {
    const certificate = await this.prisma.typeTestCertificate.findUnique({ where: { id }, include: certificateInclude });
    if (!certificate) throw new NotFoundException("Certificate not found");
    return withExpiryStatus(certificate);
  }

  async create(dto: CreateCertificateDto, file: Express.Multer.File, userId: string, ip?: string) {
    this.validateFile(file);
    const safeName = this.sanitizeFileName(file.originalname);
    const relativePath = path.posix.join("certificates", `${crypto.randomUUID()}-${safeName}`);
    const written = await this.storage.write(file.buffer, relativePath);

    const certificate = await this.prisma.typeTestCertificate.create({
      data: {
        transformerType: dto.transformerType,
        title: dto.title,
        certificateNo: dto.certificateNo,
        fileName: safeName,
        storagePath: written.storagePath,
        storageStatus: written.storageStatus,
        checksum: written.checksum,
        sizeBytes: written.sizeBytes,
        mimeType: file.mimetype,
        expiryDate: new Date(dto.expiryDate),
        uploadedById: userId,
      },
      include: certificateInclude,
    });

    await this.audit.log({
      userId,
      action: "TYPE_TEST_CERTIFICATE_UPLOADED",
      objectType: "TypeTestCertificate",
      objectId: certificate.id,
      newValue: { transformerType: certificate.transformerType, expiryDate: certificate.expiryDate },
      ipAddress: ip,
    });

    return withExpiryStatus(certificate);
  }

  /** Renewal replaces the file and sets a new expiry date on the same row -
   * no version history, since (unlike engineering documents) there's no
   * approval chain or superseded-version concept for these; the audit log
   * already records who renewed what and when. Resets the reminder clock. */
  async renew(id: string, dto: RenewCertificateDto, file: Express.Multer.File, userId: string, ip?: string) {
    const existing = await this.prisma.typeTestCertificate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Certificate not found");
    this.validateFile(file);

    const safeName = this.sanitizeFileName(file.originalname);
    const relativePath = path.posix.join("certificates", `${crypto.randomUUID()}-${safeName}`);
    const written = await this.storage.write(file.buffer, relativePath);

    const certificate = await this.prisma.typeTestCertificate.update({
      where: { id },
      data: {
        fileName: safeName,
        storagePath: written.storagePath,
        storageStatus: written.storageStatus,
        checksum: written.checksum,
        sizeBytes: written.sizeBytes,
        mimeType: file.mimetype,
        expiryDate: new Date(dto.expiryDate),
        certificateNo: dto.certificateNo ?? existing.certificateNo,
        lastReminderSentAt: null,
      },
      include: certificateInclude,
    });

    await this.audit.log({
      userId,
      action: "TYPE_TEST_CERTIFICATE_RENEWED",
      objectType: "TypeTestCertificate",
      objectId: certificate.id,
      oldValue: { expiryDate: existing.expiryDate },
      newValue: { expiryDate: certificate.expiryDate },
      ipAddress: ip,
    });

    return withExpiryStatus(certificate);
  }

  async prepareDownload(id: string, userId: string, ip?: string) {
    const certificate = await this.prisma.typeTestCertificate.findUnique({ where: { id } });
    if (!certificate) throw new NotFoundException("Certificate not found");

    const buffer = await this.storage.read(certificate.storagePath, certificate.storageStatus);
    await this.audit.log({
      userId,
      action: "TYPE_TEST_CERTIFICATE_DOWNLOADED",
      objectType: "TypeTestCertificate",
      objectId: certificate.id,
      ipAddress: ip,
    });
    return { buffer, fileName: certificate.fileName, mimeType: certificate.mimeType };
  }

  /** The recurring reminder check - called on a schedule by the worker
   * process (see apps/worker/src/check-certificate-expiry.ts), and also
   * exposed as a manual "check now" trigger, same pattern as
   * FileIssuesService.notifyDueTomorrow()/markOverdueTransactions(). Every
   * admin (System Administrator role) is notified once per qualifying
   * certificate per 4-day window - never more often, tracked via
   * lastReminderSentAt so a more frequent worker tick doesn't spam. */
  async checkExpiring(): Promise<number> {
    const now = new Date();
    // The DB query is a coarse pre-filter (just the expiry-window cutoff -
    // a superset of what actually qualifies) purely to avoid fetching every
    // certificate row; isReminderDue() below is the single source of truth
    // for the precise "is this actually due right now" boundary, same
    // function the unit tests exercise.
    const cutoff = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.typeTestCertificate.findMany({ where: { expiryDate: { lte: cutoff } } });
    const due = candidates.filter((cert) => isReminderDue(cert.expiryDate, cert.lastReminderSentAt, now));
    if (due.length === 0) return 0;

    const admins = await this.prisma.user.findMany({ where: { role: { name: "System Administrator" } } });
    if (admins.length === 0) return 0;

    let notifiedCount = 0;
    for (const cert of due) {
      const daysLeft = daysUntil(cert.expiryDate, now);
      const variables = {
        transformerType: cert.transformerType,
        title: cert.title,
        certificateNo: cert.certificateNo ?? "",
        expiryDate: cert.expiryDate.toLocaleDateString(),
        daysLeft: daysLeft < 0 ? `expired ${Math.abs(daysLeft)} days ago` : `${daysLeft} days left`,
      };
      for (const admin of admins) {
        await this.notifications.notify(NOTIFICATION_EVENTS.TYPE_TEST_CERTIFICATE_EXPIRING, admin.id, variables);
        notifiedCount++;
      }
      await this.prisma.typeTestCertificate.update({ where: { id: cert.id }, data: { lastReminderSentAt: now } });
    }
    return notifiedCount;
  }
}
