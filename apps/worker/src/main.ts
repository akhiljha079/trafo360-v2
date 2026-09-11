import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import * as path from "node:path";
import { runCertificateExpiryCheck } from "./check-certificate-expiry";
import { runOverdueCheck } from "./mark-overdue";
import { runSyncCycle } from "./sync-storage";

// Background worker process (spec §61). Storage sync (spec §37) and
// overdue-file detection (spec §31) are the first real jobs here;
// email/whatsapp/ad-sync land in Phase 6 alongside the rest of the
// notification system, once there's something for them to notify through.

// Unlike apps/api (whose @nestjs/config ConfigModule loads .env from CWD
// automatically), this plain script never loaded .env in production at all
// - fine under Docker Compose, where env_file injects real env vars
// directly into the container, but silently unconfigured under any
// process manager that just runs `node dist/main.js` without setting the
// environment itself (PM2/aaPanel, most bare-metal deployments). Resolved
// relative to this compiled file's own location, not CWD, so it works
// regardless of what directory the process manager launches from.
// dotenv never overwrites a variable that's already set, so this is a
// no-op (not a conflict) anywhere the environment is already provided -
// e.g. Docker, where this file won't even exist in the image.
// quiet: true - newer dotenv versions print a random self-promotional
// "tip" line to stdout on every config() call otherwise, which has no
// place in a production server's logs.
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

const SYNC_INTERVAL_MS = 10_000;
const OVERDUE_CHECK_INTERVAL_MS = 60_000;
const CERTIFICATE_EXPIRY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h - the 4-day reminder cadence is enforced server-side, not by this interval

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();
  // eslint-disable-next-line no-console
  console.log(
    `[worker] connected to database, storage sync every ${SYNC_INTERVAL_MS / 1000}s, overdue check every ${OVERDUE_CHECK_INTERVAL_MS / 1000}s`,
  );

  const syncTick = async () => {
    try {
      await runSyncCycle(prisma);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[worker] sync cycle error", err);
    }
  };
  const overdueTick = async () => {
    try {
      await runOverdueCheck(prisma);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[worker] overdue check error", err);
    }
  };
  const certificateExpiryTick = async () => {
    try {
      await runCertificateExpiryCheck();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[worker] certificate expiry check error", err);
    }
  };

  await syncTick();
  await overdueTick();
  await certificateExpiryTick();
  setInterval(syncTick, SYNC_INTERVAL_MS);
  setInterval(overdueTick, OVERDUE_CHECK_INTERVAL_MS);
  setInterval(certificateExpiryTick, CERTIFICATE_EXPIRY_CHECK_INTERVAL_MS);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal startup error", err);
  process.exit(1);
});
