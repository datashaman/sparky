import type { FrameworkResult, DiscoveredAgent, DiscoveredContextFile } from "../types.js";
import { safeRead } from "./safe-read.js";

/** Scan for MCP configuration: .mcp.json. */
export function scan(repoRoot: string): FrameworkResult {
  const agents: DiscoveredAgent[] = [];
  const context_files: DiscoveredContextFile[] = [];

  const mcpContent = safeRead(repoRoot, ".mcp.json");
  if (mcpContent !== null) {
    context_files.push({
      path: ".mcp.json",
      source: "mcp",
      role: "context",
    });

    try {
      const config = JSON.parse(mcpContent) as Record<string, unknown>;
      const servers = config.mcpServers ?? config.servers;
      if (servers && typeof servers === "object") {
        const serverNames = Object.keys(servers as Record<string, unknown>);
        if (serverNames.length > 0) {
          agents.push({
            name: "mcp-servers",
            source: "mcp",
            description: `MCP servers: ${serverNames.join(", ")}`,
            instructions: `This repository defines MCP servers in .mcp.json:\n${mcpContent}`,
            skills: [],
            tools: serverNames,
            delegation: { cli: "mcp", args: [], available: false },
          });
        }
      }
    } catch {
      // Invalid JSON — still tracked as context file
    }
  }

  return { framework: "mcp", agents, skills: [], commands: [], context_files };
}

