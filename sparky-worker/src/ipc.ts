import { createServer, type Server } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import type { IPCCommand, IPCEvent } from "./types.js";

export type CommandHandler = (command: IPCCommand, send: (event: IPCEvent) => void) => void;

interface Client {
  id: number;
  buffer: string;
  send: (event: IPCEvent) => void;
}

let server: Server | null = null;
const clients = new Map<number, Client>();
let nextClientId = 1;

export function startIPCServer(socketPath: string, onCommand: CommandHandler): Server {
  // Remove stale socket file
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  server = createServer((socket) => {
    const clientId = nextClientId++;
    const client: Client = {
      id: clientId,
      buffer: "",
      send: (event) => {
        try {
          socket.write(JSON.stringify(event) + "\n");
        } catch {
          // Client disconnected
        }
      },
    };
    clients.set(clientId, client);
    console.log(`[ipc] client ${clientId} connected`);

    socket.on("data", (data) => {
      client.buffer += data.toString();
      const lines = client.buffer.split("\n");
      // Keep incomplete last line in buffer
      client.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const command = JSON.parse(trimmed) as IPCCommand;
          onCommand(command, client.send);
        } catch (e) {
          client.send({ type: "error", error: `Invalid JSON: ${e}` });
        }
      }
    });

    socket.on("close", () => {
      clients.delete(clientId);
      console.log(`[ipc] client ${clientId} disconnected`);
    });

    socket.on("error", (err) => {
      console.error(`[ipc] client ${clientId} error:`, err.message);
      clients.delete(clientId);
    });
  });

  server.listen(socketPath, () => {
    console.log(`[ipc] listening on ${socketPath}`);
  });

  server.on("error", (err) => {
    console.error("[ipc] server error:", err);
  });

  return server;
}

/** Broadcast an event to all connected clients. */
export function broadcast(event: IPCEvent): void {
  for (const client of clients.values()) {
    client.send(event);
  }
}

export function stopIPCServer(): void {
  if (server) {
    server.close();
    server = null;
  }
  clients.clear();
}
