import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "node:crypto";
import * as QRCode from "qrcode";
import { AuditService } from "../common/audit.service";
import { PermissionsService } from "../common/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertPhysicalFileLocationDto } from "./dto/physical-file.dto";

const physicalFileInclude = {
  project: { select: { id: true, projectNo: true, name: true, customer: { select: { name: true } } } },
  confidentialityLevel: true,
} as const;

@Injectable()
export class PhysicalFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
    private readonly config: ConfigService,
  ) {}

  /** Same atomic-sequence pattern as project numbering (ProjectsService) -
   * see that module for why a raw SQL upsert instead of read-then-write. */
  private async generateFileCode(): Promise<string> {
    const year = new Date().getFullYear();
    const key = `physical_file_seq_${year}`;
    const rows = await this.prisma.$queryRaw<{ value: string }[]>`
      INSERT INTO "SystemSetting" (id, key, value, "isSecret", "updatedAt")
      VALUES (gen_random_uuid()::text, ${key}, '1', false, now())
      ON CONFLICT (key) DO UPDATE
        SET value = (CAST("SystemSetting".value AS INTEGER) + 1)::text, "updatedAt" = now()
      RETURNING value;
    `;
    const seq = Number(rows[0].value);
    return `PF-${year}-${String(seq).padStart(6, "0")}`;
  }

  async createForProject(projectId: string, actorUserId: string, ip?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const existing = await this.prisma.physicalFile.findUnique({ where: { projectId } });
    if (existing) throw new ConflictException("This project already has a physical file record");

    const fileCode = await this.generateFileCode();
    // Opaque token only - spec §26 forbids confidential content in the QR.
    // Resolved via /pf/:token behind auth, never the raw DB id or a path.
    const qrToken = crypto.randomBytes(16).toString("hex");

    const physicalFile = await this.prisma.physicalFile.create({
      data: { projectId, fileCode, qrToken, confidentialityLevelId: project.confidentialityLevelId, status: "AVAILABLE" },
      include: physicalFileInclude,
    });
    await this.audit.log({
      userId: actorUserId,
      action: "PHYSICAL_FILE_CREATED",
      objectType: "PhysicalFile",
      objectId: physicalFile.id,
      newValue: { fileCode },
      ipAddress: ip,
    });
    return physicalFile;
  }

  async getByProject(projectId: string, userId: string) {
    const physicalFile = await this.prisma.physicalFile.findUnique({ where: { projectId }, include: physicalFileInclude });
    if (!physicalFile) return null;
    await this.assertAccess(physicalFile, userId);
    return physicalFile;
  }

  async list(userId: string, search?: string) {
    const ceiling = await this.permissions.getConfidentialityRank(userId);
    return this.prisma.physicalFile.findMany({
      where: {
        confidentialityLevel: { rank: { lte: ceiling } },
        ...(search
          ? {
              OR: [
                { fileCode: { contains: search, mode: "insensitive" as const } },
                { project: { projectNo: { contains: search, mode: "insensitive" as const } } },
                { project: { name: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: physicalFileInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  private async assertAccess(physicalFile: { confidentialityLevel: { rank: number } }, userId: string) {
    const ceiling = await this.permissions.getConfidentialityRank(userId);
    if (physicalFile.confidentialityLevel.rank > ceiling) {
      throw new ForbiddenException("This physical file's confidentiality level exceeds your access");
    }
  }

  async get(id: string, userId: string) {
    const physicalFile = await this.prisma.physicalFile.findUnique({ where: { id }, include: physicalFileInclude });
    if (!physicalFile) throw new NotFoundException("Physical file not found");
    await this.assertAccess(physicalFile, userId);
    return physicalFile;
  }

  async getByToken(token: string, userId: string) {
    const physicalFile = await this.prisma.physicalFile.findUnique({ where: { qrToken: token }, include: physicalFileInclude });
    if (!physicalFile) throw new NotFoundException("Physical file not found");
    await this.assertAccess(physicalFile, userId);
    await this.audit.log({
      userId,
      action: "PHYSICAL_FILE_QR_SCANNED",
      objectType: "PhysicalFile",
      objectId: physicalFile.id,
    });
    return physicalFile;
  }

  async updateLocation(id: string, dto: UpsertPhysicalFileLocationDto, actorUserId: string, ip?: string) {
    const before = await this.prisma.physicalFile.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Physical file not found");
    const physicalFile = await this.prisma.physicalFile.update({ where: { id }, data: dto, include: physicalFileInclude });
    await this.audit.log({
      userId: actorUserId,
      action: "PHYSICAL_FILE_LOCATION_UPDATED",
      objectType: "PhysicalFile",
      objectId: id,
      oldValue: {
        building: before.building,
        floor: before.floor,
        room: before.room,
        rack: before.rack,
        shelf: before.shelf,
        box: before.box,
      },
      newValue: dto,
      ipAddress: ip,
    });
    return physicalFile;
  }

  /** PNG data URL of a QR encoding only an opaque resolver URL - scanning it
   * opens the project file page after authentication (spec §26), never
   * exposes document content or a raw path. */
  async getQrCodeDataUrl(id: string, userId: string): Promise<string> {
    const physicalFile = await this.get(id, userId);
    const appUrl = this.config.get<string>("APP_URL") ?? "http://localhost:5173";
    const resolverUrl = `${appUrl}/pf/${physicalFile.qrToken}`;
    return QRCode.toDataURL(resolverUrl, { errorCorrectionLevel: "M", margin: 1, width: 300 });
  }

  async getLabelData(id: string, userId: string) {
    const physicalFile = await this.get(id, userId);
    const qrDataUrl = await this.getQrCodeDataUrl(id, userId);
    return {
      fileCode: physicalFile.fileCode,
      projectNo: physicalFile.project.projectNo,
      projectName: physicalFile.project.name,
      customerName: physicalFile.project.customer.name,
      confidentiality: physicalFile.confidentialityLevel.name,
      location: [physicalFile.building, physicalFile.floor, physicalFile.room, physicalFile.rack, physicalFile.shelf, physicalFile.box]
        .filter(Boolean)
        .join(" / "),
      qrDataUrl,
    };
  }
}
