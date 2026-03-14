import { parseArgs } from "node:util";

export interface WorkerConfig {
  dbPath: string;
  socketPath: string;
}

export function parseConfig(): WorkerConfig {
  const { values } = parseArgs({
    options: {
      db: { type: "string" },
      socket: { type: "string" },
    },
    strict: false,
  });

  if (!values.db || typeof values.db !== "string") {
    throw new Error("--db <path> is required");
  }
  if (!values.socket || typeof values.socket !== "string") {
    throw new Error("--socket <path> is required");
  }

  return {
    dbPath: values.db,
    socketPath: values.socket,
  };
}
