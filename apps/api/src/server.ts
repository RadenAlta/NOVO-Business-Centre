import { app } from "./app.js";
import { prisma } from "./db.js";
import { env } from "./env.js";

const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`NOVO API listening on http://localhost:${env.PORT}`);
});

async function stop(signal: string): Promise<void> {
  console.log(`${signal} received; closing NOVO API.`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
