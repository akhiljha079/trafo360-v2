import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as QRCode from "qrcode";
import { PrismaService } from "../prisma/prisma.service";

/** WhatsApp Web integration (spec §35). Deliberately isolated behind this
 * one service - the rest of the app only ever calls send()/connect()/
 * disconnect()/status(), never touches whatsapp-web.js directly, so a
 * Puppeteer/Chromium crash in here can't take down the API process. In a
 * real deployment this whole service's *process* should be the dedicated
 * worker described in the architecture plan, not the API - see
 * docs/BUILD_PROGRESS.md for why that split isn't done yet.
 *
 * whatsapp-web.js's `Client` needs a real Chromium binary
 * (`puppeteer`'s bundled one, or a system Chrome via `executablePath`) to
 * actually launch. This dev sandbox has the package installed but no
 * browser binary (see BUILD_PROGRESS.md) and no phone to scan a pairing QR
 * with, so `connect()` is written correctly against the real API but has
 * never been exercised end-to-end - unlike everything else built so far in
 * this project, this one module is unverified beyond "it type-checks and
 * the non-WhatsApp-specific parts (session status persistence, the admin
 * API, never storing credentials) are sound." */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private lastQrDataUrl: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async getSessionRow() {
    const existing = await this.prisma.whatsappSession.findFirst();
    if (existing) return existing;
    return this.prisma.whatsappSession.create({ data: { status: "DISCONNECTED" } });
  }

  async status() {
    const session = await this.getSessionRow();
    return { status: session.status, connectedAt: session.connectedAt, lastSeenAt: session.lastSeenAt, qrDataUrl: this.lastQrDataUrl };
  }

  /** Starts a whatsapp-web.js client and returns a QR pairing code as a
   * data URL once one is emitted. Session persisted to
   * WHATSAPP_SESSION_PATH via LocalAuth - filesystem-permission restricted,
   * never returned by any API response (only connection *status* is). */
  async connect(): Promise<{ qrDataUrl: string | null; status: string }> {
    const session = await this.getSessionRow();
    if (session.status === "CONNECTED") return { qrDataUrl: null, status: "CONNECTED" };

    await this.prisma.whatsappSession.update({ where: { id: session.id }, data: { status: "CONNECTING" } });

    try {
      // Lazy require: keeps whatsapp-web.js (and its Puppeteer dependency)
      // out of the module graph entirely for anyone not using this feature,
      // and avoids a hard crash at process boot if the browser binary is
      // missing (see class doc comment).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Client, LocalAuth } = require("whatsapp-web.js");
      const sessionPath = this.config.get<string>("WHATSAPP_SESSION_PATH") ?? "./storage/whatsapp-session";

      this.client = new Client({
        authStrategy: new LocalAuth({ dataPath: sessionPath }),
        // Chromium's own internal sandbox needs a privileged user namespace
        // setup that a dedicated unprivileged service account doesn't have
        // (fails outright on Ubuntu 23.10+'s AppArmor-restricted unprivileged
        // user namespaces: "No usable sandbox!"). --no-sandbox is the
        // standard trade-off for headless Chromium run by its own dedicated,
        // otherwise-unprivileged OS user - isolation comes from that account
        // having no other access, not from Chromium's internal sandbox.
        puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
      });

      // Explicit outcome tracking - do NOT infer "connected" from "no QR",
      // since "timed out waiting" and "already ready" both produce a null
      // QR and are very different outcomes. Found and fixed after this
      // exact conflation reported CONNECTED on a timeout in a sandbox with
      // no Chromium binary available - see docs/BUILD_PROGRESS.md.
      const outcome = await new Promise<{ qrDataUrl: string | null; status: "CONNECTED" | "CONNECTING" | "TIMED_OUT" }>(
        (resolve) => {
          this.client.on("qr", async (qr: string) => {
            this.lastQrDataUrl = await QRCode.toDataURL(qr);
            resolve({ qrDataUrl: this.lastQrDataUrl, status: "CONNECTING" });
          });
          this.client.on("ready", async () => {
            this.lastQrDataUrl = null;
            await this.prisma.whatsappSession.update({
              where: { id: session.id },
              data: { status: "CONNECTED", connectedAt: new Date(), lastSeenAt: new Date() },
            });
            resolve({ qrDataUrl: null, status: "CONNECTED" });
          });
          this.client.on("disconnected", async () => {
            await this.prisma.whatsappSession.update({ where: { id: session.id }, data: { status: "DISCONNECTED" } });
          });
          // Give up waiting for a QR/ready event rather than hanging forever
          // if the browser fails to launch at all - this is its own
          // distinct outcome, never silently reported as success.
          setTimeout(() => resolve({ qrDataUrl: null, status: "TIMED_OUT" }), 15000);
          this.client.initialize().catch((err: Error) => {
            this.logger.error(`WhatsApp client.initialize() rejected: ${err.message}`);
            resolve({ qrDataUrl: null, status: "TIMED_OUT" });
          });
        },
      );

      if (outcome.status === "TIMED_OUT") {
        await this.prisma.whatsappSession.update({ where: { id: session.id }, data: { status: "DISCONNECTED" } });
        throw new Error("WhatsApp Web did not respond with a QR code or ready event within 15s - the browser likely failed to launch");
      }
      return outcome;
    } catch (err) {
      this.logger.error(`WhatsApp connect failed: ${(err as Error).message}`);
      await this.prisma.whatsappSession.update({ where: { id: session.id }, data: { status: "DISCONNECTED" } });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const session = await this.getSessionRow();
    try {
      await this.client?.destroy();
    } catch (err) {
      this.logger.warn(`WhatsApp destroy() failed (ignoring): ${(err as Error).message}`);
    }
    this.client = null;
    this.lastQrDataUrl = null;
    await this.prisma.whatsappSession.update({ where: { id: session.id }, data: { status: "DISCONNECTED" } });
  }

  /** Never throws - a WhatsApp send failure must never break the caller's
   * flow (email is the authoritative channel per spec §35). Always logs to
   * WhatsappLog regardless of outcome. */
  async send(toPhone: string, message: string, eventKey?: string): Promise<boolean> {
    const session = await this.getSessionRow();
    if (session.status !== "CONNECTED" || !this.client) {
      await this.prisma.whatsappLog.create({
        data: { toNumber: toPhone, message, status: "FAILED", error: "WhatsApp Web is not connected", eventKey },
      });
      return false;
    }
    try {
      const chatId = `${toPhone.replace(/[^\d]/g, "")}@c.us`;
      await this.client.sendMessage(chatId, message);
      await this.prisma.whatsappLog.create({ data: { toNumber: toPhone, message, status: "SENT", eventKey } });
      return true;
    } catch (err) {
      const errorMessage = (err as Error).message;
      await this.prisma.whatsappLog.create({ data: { toNumber: toPhone, message, status: "FAILED", error: errorMessage, eventKey } });
      return false;
    }
  }
}
