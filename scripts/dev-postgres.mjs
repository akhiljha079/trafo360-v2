import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";

const pg = new EmbeddedPostgres({
  databaseDir: path.resolve("./.devdb/pgdata"),
  user: "trafo360",
  password: "trafo360",
  port: 5432,
  persistent: true,
});

const cmd = process.argv[2] ?? "start";

if (cmd === "start") {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("trafo360");
  console.log("embedded postgres ready on port 5432, db=trafo360");
} else if (cmd === "stop") {
  await pg.start().catch(() => {});
  await pg.stop();
  console.log("embedded postgres stopped");
}
