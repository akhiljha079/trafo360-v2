import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const prisma = new PrismaClient();

const roles = await prisma.role.findMany({
  include: { permissions: { include: { permission: true } } },
  orderBy: { name: "asc" },
});
const permissions = await prisma.permission.findMany({ orderBy: [{ category: "asc" }, { code: "asc" }] });

const roleNames = roles.map((r) => r.name);
const grantSet = new Map(roles.map((r) => [r.name, new Set(r.permissions.map((rp) => rp.permission.code))]));

let out = "# Permission Matrix (generated from seed data - do not hand-edit)\n\n";
out += `Generated ${new Date().toISOString()} from \`prisma/seed.ts\` via \`node scripts/gen-permission-matrix.mjs\`. `;
out += "Regenerate after any change to role/permission seed data or after admin-side edits in a real deployment's DB.\n\n";
out += "| Permission | " + roleNames.join(" | ") + " |\n";
out += "|---|" + roleNames.map(() => "---").join("|") + "|\n";

let currentCategory = "";
for (const perm of permissions) {
  if (perm.category !== currentCategory) {
    currentCategory = perm.category;
    out += `| **${currentCategory}** | ${roleNames.map(() => "").join(" | ")} |\n`;
  }
  const row = roleNames.map((name) => (grantSet.get(name)?.has(perm.code) ? "x" : ""));
  out += `| \`${perm.code}\` | ${row.join(" | ")} |\n`;
}

fs.writeFileSync(new URL("../docs/permission-matrix.md", import.meta.url), out);
console.log(`Wrote docs/permission-matrix.md (${permissions.length} permissions x ${roleNames.length} roles)`);
await prisma.$disconnect();
