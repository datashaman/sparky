import { parseConfig } from "./config.js";
import { initDb } from "./db.js";
import { startIPCServer } from "./ipc.js";
import { handleCommand, resumeRunningSessions } from "./session-manager.js";

async function main(): Promise<void> {
  console.log("[worker] sparky-worker starting...");

  const config = parseConfig();
  console.log(`[worker] db: ${config.dbPath}`);
  console.log(`[worker] socket: ${config.socketPath}`);

  // Initialize database
  initDb(config.dbPath);
  console.log("[worker] database initialized");

  // Start IPC server
  startIPCServer(config.socketPath, handleCommand);

  // Resume any sessions that were running when we last stopped
  await resumeRunningSessions();

  // Keep process alive
  console.log("[worker] ready");

  // Handle graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[worker] received SIGTERM, shutting down");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("[worker] received SIGINT, shutting down");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
