import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "node:crypto";

const ALGO = "aes-256-gcm";

/** Encrypts secrets-at-rest (AD bind password, SMTP password, ...) stored in
 * SystemSetting.value. Key comes from SECRETS_ENCRYPTION_KEY (env only —
 * never stored in the DB itself). See architecture plan §3/§10. */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>("SECRETS_ENCRYPTION_KEY") ?? "";
    // Accept any passphrase length in dev; derive a stable 32-byte key so a
    // human-readable placeholder in .env still works, while production
    // deployments are told (docs/ad-ldap-setup.md, .env.example) to generate
    // a real 32-byte random value.
    this.key = crypto.createHash("sha256").update(raw).digest();
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return ["v1", iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split(":");
    if (version !== "v1") throw new Error("Unsupported secret encryption version");
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = crypto.createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
}
