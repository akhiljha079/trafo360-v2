import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import * as ldap from "ldapjs";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { UpdateAdConfigDto } from "./dto/update-ad-config.dto";

const KEYS = {
  enabled: "ad.enabled",
  host: "ad.host",
  port: "ad.port",
  protocol: "ad.protocol",
  baseDn: "ad.baseDn",
  userSearchDn: "ad.userSearchDn",
  bindUser: "ad.bindUser",
  bindPassword: "ad.bindPassword",
  userSearchFilter: "ad.userSearchFilter",
  groupSearchBase: "ad.groupSearchBase",
  domain: "ad.domain",
  connectTimeoutMs: "ad.connectTimeoutMs",
} as const;

export interface AdConfig {
  enabled: boolean;
  host: string;
  port: number;
  protocol: "ldap" | "ldaps";
  baseDn: string;
  userSearchDn: string;
  bindUser: string;
  bindPasswordSet: boolean;
  userSearchFilter: string;
  groupSearchBase: string;
  domain: string;
  connectTimeoutMs: number;
}

interface LdapUserAttributes {
  dn: string;
  username: string;
  name: string;
  email: string;
  mobile?: string;
  department?: string;
  memberOf: string[];
}

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getConfig(): Promise<AdConfig> {
    const values = await this.settings.getMany(Object.values(KEYS));
    return {
      enabled: values[KEYS.enabled] === "true",
      host: values[KEYS.host] ?? "",
      port: Number(values[KEYS.port] ?? 636),
      protocol: (values[KEYS.protocol] as "ldap" | "ldaps") ?? "ldaps",
      baseDn: values[KEYS.baseDn] ?? "",
      userSearchDn: values[KEYS.userSearchDn] ?? values[KEYS.baseDn] ?? "",
      bindUser: values[KEYS.bindUser] ?? "",
      bindPasswordSet: !!values[KEYS.bindPassword],
      userSearchFilter: values[KEYS.userSearchFilter] ?? "(sAMAccountName={{username}})",
      groupSearchBase: values[KEYS.groupSearchBase] ?? "",
      domain: values[KEYS.domain] ?? "",
      connectTimeoutMs: Number(values[KEYS.connectTimeoutMs] ?? 5000),
    };
  }

  private async getFullConfig() {
    const values = await this.settings.getMany(Object.values(KEYS));
    return values;
  }

  async updateConfig(dto: UpdateAdConfigDto, actorUserId: string, ip?: string): Promise<AdConfig> {
    await this.settings.setMany([
      { key: KEYS.enabled, value: String(dto.enabled) },
      { key: KEYS.host, value: dto.host },
      { key: KEYS.port, value: String(dto.port) },
      { key: KEYS.protocol, value: dto.protocol },
      { key: KEYS.baseDn, value: dto.baseDn },
      { key: KEYS.userSearchDn, value: dto.userSearchDn ?? dto.baseDn },
      { key: KEYS.bindUser, value: dto.bindUser },
      { key: KEYS.bindPassword, value: dto.bindPassword, isSecret: true },
      { key: KEYS.userSearchFilter, value: dto.userSearchFilter },
      { key: KEYS.groupSearchBase, value: dto.groupSearchBase ?? "" },
      { key: KEYS.domain, value: dto.domain ?? "" },
      { key: KEYS.connectTimeoutMs, value: String(dto.connectTimeoutMs) },
    ]);
    await this.audit.log({
      userId: actorUserId,
      action: "AD_CONFIG_UPDATED",
      objectType: "SystemSetting",
      objectId: "ad-config",
      ipAddress: ip,
      newValue: { ...dto, bindPassword: dto.bindPassword ? "[redacted]" : undefined },
    });
    return this.getConfig();
  }

  private buildClient(config: { host: string; port: number; protocol: string; connectTimeoutMs: number }) {
    const client = ldap.createClient({
      url: `${config.protocol}://${config.host}:${config.port}`,
      timeout: config.connectTimeoutMs,
      connectTimeout: config.connectTimeoutMs,
      tlsOptions: { rejectUnauthorized: true },
    });
    // ldapjs's underlying socket emits 'error' independently of the bind()/
    // search() callbacks (e.g. on connect timeout). An EventEmitter's
    // unhandled 'error' event is fatal to the Node process, so this listener
    // must exist even though callers already handle failures via their own
    // try/catch around bind()/search() promises.
    client.on("error", (err) => this.logger.warn(`AD/LDAP socket error: ${err.message}`));
    return client;
  }

  private bind(client: ldap.Client, dn: string, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.bind(dn, password, (err) => (err ? reject(err) : resolve()));
    });
  }

  private unbind(client: ldap.Client) {
    client.unbind(() => undefined);
  }

  private search(client: ldap.Client, base: string, options: ldap.SearchOptions): Promise<LdapUserAttributes[]> {
    return new Promise((resolve, reject) => {
      const results: LdapUserAttributes[] = [];
      client.search(base, options, (err, res) => {
        if (err) return reject(err);
        res.on("searchEntry", (entry) => {
          const obj = entry.pojo.attributes.reduce<Record<string, string[]>>((acc, attr) => {
            acc[attr.type] = attr.values;
            return acc;
          }, {});
          results.push({
            dn: entry.pojo.objectName ?? "",
            username: obj.sAMAccountName?.[0] ?? "",
            name: obj.displayName?.[0] ?? obj.cn?.[0] ?? "",
            email: obj.mail?.[0] ?? "",
            mobile: obj.mobile?.[0] ?? obj.telephoneNumber?.[0],
            department: obj.department?.[0],
            memberOf: obj.memberOf ?? [],
          });
        });
        res.on("error", (searchErr) => reject(searchErr));
        res.on("end", () => resolve(results));
      });
    });
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const values = await this.getFullConfig();
    const host = values[KEYS.host];
    const bindUser = values[KEYS.bindUser];
    const bindPassword = values[KEYS.bindPassword];
    if (!host || !bindUser || !bindPassword) {
      return { success: false, message: "Host, bind user, and bind password must all be configured first." };
    }
    const client = this.buildClient({
      host,
      port: Number(values[KEYS.port] ?? 636),
      protocol: values[KEYS.protocol] ?? "ldaps",
      connectTimeoutMs: Number(values[KEYS.connectTimeoutMs] ?? 5000),
    });
    try {
      await this.bind(client, bindUser, bindPassword);
      return { success: true, message: "Bind succeeded with the configured service account." };
    } catch (err) {
      this.logger.warn(`AD test connection failed: ${(err as Error).message}`);
      return { success: false, message: `Bind failed: ${(err as Error).message}` };
    } finally {
      this.unbind(client);
    }
  }

  /** Binds as the user attempting to log in (never stores the password). */
  async authenticate(username: string, password: string): Promise<LdapUserAttributes> {
    const values = await this.getFullConfig();
    if (values[KEYS.enabled] !== "true") {
      throw new UnauthorizedException("AD/LDAP authentication is not enabled");
    }
    const host = values[KEYS.host]!;
    const serviceClient = this.buildClient({
      host,
      port: Number(values[KEYS.port] ?? 636),
      protocol: values[KEYS.protocol] ?? "ldaps",
      connectTimeoutMs: Number(values[KEYS.connectTimeoutMs] ?? 5000),
    });
    try {
      await this.bind(serviceClient, values[KEYS.bindUser]!, values[KEYS.bindPassword]!);
      const filter = (values[KEYS.userSearchFilter] ?? "(sAMAccountName={{username}})").replace(
        "{{username}}",
        username.replace(/[()\\*\0]/g, ""), // basic LDAP filter injection guard
      );
      const found = await this.search(serviceClient, values[KEYS.userSearchDn] || values[KEYS.baseDn]!, {
        filter,
        scope: "sub",
        attributes: ["sAMAccountName", "displayName", "cn", "mail", "mobile", "telephoneNumber", "department", "memberOf"],
      });
      if (found.length === 0) throw new UnauthorizedException("No such AD user");
      const user = found[0];

      const userClient = this.buildClient({
        host,
        port: Number(values[KEYS.port] ?? 636),
        protocol: values[KEYS.protocol] ?? "ldaps",
        connectTimeoutMs: Number(values[KEYS.connectTimeoutMs] ?? 5000),
      });
      try {
        await this.bind(userClient, user.dn, password);
      } finally {
        this.unbind(userClient);
      }
      return user;
    } finally {
      this.unbind(serviceClient);
    }
  }

  /** Walks the configured search base and upserts User/AdGroup rows.
   * On-demand for now (admin clicks "Sync Now"); scheduled sync is added
   * alongside the rest of BullMQ in a later phase. */
  async syncNow(actorUserId: string, ip?: string): Promise<{ created: number; updated: number; total: number }> {
    const values = await this.getFullConfig();
    if (!values[KEYS.host] || !values[KEYS.bindUser] || !values[KEYS.bindPassword]) {
      throw new Error("AD is not fully configured");
    }
    const client = this.buildClient({
      host: values[KEYS.host]!,
      port: Number(values[KEYS.port] ?? 636),
      protocol: values[KEYS.protocol] ?? "ldaps",
      connectTimeoutMs: Number(values[KEYS.connectTimeoutMs] ?? 5000),
    });

    let created = 0;
    let updated = 0;
    try {
      await this.bind(client, values[KEYS.bindUser]!, values[KEYS.bindPassword]!);
      const users = await this.search(client, values[KEYS.userSearchDn] || values[KEYS.baseDn]!, {
        // objectClass=computer is a *subclass* of objectClass=user in AD's
        // schema, so machine accounts (SOMEHOST$) match "objectClass=user"
        // too and would otherwise get synced in as noise "people" -
        // reproduced live against a real AD server, ~40% of the raw
        // results were computer accounts.
        filter: "(&(objectClass=user)(sAMAccountName=*)(!(objectClass=computer)))",
        scope: "sub",
        attributes: ["sAMAccountName", "displayName", "cn", "mail", "mobile", "telephoneNumber", "department", "memberOf"],
      });
      // Real AD deployments very often don't populate the `mail` attribute
      // at all unless Exchange/O365 is in the mix (confirmed live: a real
      // customer's AD had zero users with `mail` set) - requiring it made
      // every single sync a no-op. User.email is NOT NULL + unique, so
      // some value is required either way; synthesize the conventional
      // <username>@<domain> UPN-style address rather than silently
      // dropping every real person from the sync.
      const emailDomain = values[KEYS.domain] || values[KEYS.host] || "local";

      for (const entry of users) {
        if (!entry.username) continue;
        const hasRealEmail = !!entry.email;
        if (!entry.email) entry.email = `${entry.username}@${emailDomain}`.toLowerCase();
        for (const groupDn of entry.memberOf) {
          await this.prisma.adGroup.upsert({
            where: { dn: groupDn },
            update: {},
            create: { dn: groupDn, name: groupDn.split(",")[0]?.replace(/^CN=/i, "") ?? groupDn },
          });
        }

        const existing = await this.prisma.user.findUnique({ where: { username: entry.username } });
        if (existing) {
          await this.prisma.user.update({
            where: { id: existing.id },
            data: {
              name: entry.name || existing.name,
              // Only overwrite a stored email when AD actually has a real
              // `mail` value this time. Otherwise a resync would silently
              // stomp an admin's manual correction of the synthesized
              // placeholder back to that same placeholder every time -
              // there'd be no way to fix an AD-synced user's email that
              // survives past the next "Sync Now" click.
              email: hasRealEmail ? entry.email : existing.email,
              mobile: entry.mobile,
              source: "AD",
            },
          });
          updated += 1;
        } else {
          await this.prisma.user.create({
            data: {
              username: entry.username,
              name: entry.name || entry.username,
              email: entry.email,
              mobile: entry.mobile,
              source: "AD",
              status: "ACTIVE",
            },
          });
          created += 1;
        }
      }
    } finally {
      this.unbind(client);
    }

    const total = created + updated;
    await this.audit.log({
      userId: actorUserId,
      action: "AD_SYNC_RUN",
      objectType: "User",
      ipAddress: ip,
      newValue: { created, updated, total },
    });
    return { created, updated, total };
  }
}
