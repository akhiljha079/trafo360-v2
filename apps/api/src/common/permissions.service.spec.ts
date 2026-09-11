import { PrismaClient } from "@prisma/client";
import { PermissionsService } from "./permissions.service";

/** Integration test against a real database (see docs/BUILD_PROGRESS.md for
 * how to get one locally without a system Postgres install). Exercises the
 * one subtle rule in the permission model (architecture plan §5): a user
 * override REVOKE always wins over both the role's grant and an override
 * GRANT for the same permission. */
describe("PermissionsService", () => {
  const prisma = new PrismaClient();
  const service = new PermissionsService(prisma as unknown as never);
  const suffix = Date.now();

  let roleId: string;
  let userId: string;
  let grantedPermId: string;
  let revokedPermId: string;
  let rolePermId: string;

  beforeAll(async () => {
    const role = await prisma.role.create({ data: { name: `TestRole-${suffix}` } });
    roleId = role.id;

    const rolePerm = await prisma.permission.create({
      data: { code: `test.role_perm.${suffix}`, category: "test", description: "from role" },
    });
    rolePermId = rolePerm.id;
    await prisma.rolePermission.create({ data: { roleId, permissionId: rolePermId } });

    const grantedPerm = await prisma.permission.create({
      data: { code: `test.override_grant.${suffix}`, category: "test", description: "granted via override" },
    });
    grantedPermId = grantedPerm.id;

    const revokedPerm = await prisma.permission.create({
      data: { code: `test.override_revoke.${suffix}`, category: "test", description: "revoked via override" },
    });
    revokedPermId = revokedPerm.id;
    // The role also grants this permission directly, so the test proves the
    // REVOKE override removes it even though the role says yes.
    await prisma.rolePermission.create({ data: { roleId, permissionId: revokedPermId } });

    const user = await prisma.user.create({
      data: {
        username: `test-user-${suffix}`,
        name: "Test User",
        email: `test-user-${suffix}@example.com`,
        source: "LOCAL",
        roleId,
      },
    });
    userId = user.id;

    await prisma.userPermissionOverride.createMany({
      data: [
        { userId, permissionId: grantedPermId, effect: "GRANT" },
        { userId, permissionId: revokedPermId, effect: "REVOKE" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.userPermissionOverride.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.permission.deleteMany({ where: { id: { in: [rolePermId, grantedPermId, revokedPermId] } } });
    await prisma.role.delete({ where: { id: roleId } });
    await prisma.$disconnect();
  });

  it("includes permissions granted directly by the role", async () => {
    const permissions = await service.resolve(userId);
    expect(permissions).toContain(`test.role_perm.${suffix}`);
  });

  it("includes permissions granted only via a user override", async () => {
    const permissions = await service.resolve(userId);
    expect(permissions).toContain(`test.override_grant.${suffix}`);
  });

  it("excludes a permission the role grants but a user override revokes", async () => {
    const permissions = await service.resolve(userId);
    expect(permissions).not.toContain(`test.override_revoke.${suffix}`);
  });
});
