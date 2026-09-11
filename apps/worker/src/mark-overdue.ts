import { PrismaClient } from "@prisma/client";

/** Overdue detection (spec §31) - flips ISSUED file transactions past their
 * due date to OVERDUE. The reminder *notification* (email/WhatsApp the day
 * before due) is Phase 6; this is purely the detection half, which doesn't
 * depend on a notification channel existing yet. */
export async function runOverdueCheck(prisma: PrismaClient): Promise<void> {
  const result = await prisma.fileIssueTransaction.updateMany({
    where: { status: "ISSUED", dueDate: { lt: new Date() } },
    data: { status: "OVERDUE" },
  });
  if (result.count > 0) {
    // eslint-disable-next-line no-console
    console.log(`[worker] marked ${result.count} file issue transaction(s) OVERDUE`);
  }
}
