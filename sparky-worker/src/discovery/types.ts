// ─── Discovery Types ───

export interface DiscoveredAgent {
  name: string;
  source: string;
  description: string;
  instructions: string;
  skills: string[];
  tools: string[];
  delegation: AgentDelegation;
}

export interface DiscoveredSkill {
  name: string;
  source: string;
  description: string;
  content: string;
  file_path: string;
}

export interface DiscoveredCommand {
  name: string;
  source: string;
  description: string;
  command: string;
}

export interface DiscoveredContextFile {
  path: string;
  source: string;
  role: "instructions" | "context" | "rules";
}

export interface AgentDelegation {
  cli: string;
  args: string[];
  available: boolean;
}

export interface DiscoveredManifest {
  version: 1;
  scanned_at: string;
  frameworks: string[];
  agents: DiscoveredAgent[];
  skills: DiscoveredSkill[];
  commands: DiscoveredCommand[];
  context_files: DiscoveredContextFile[];
}

// ─── User Manifest (committed .sparky/manifest.json) ───

export interface ManifestAgentOverride {
  provider?: string;
  model?: string;
  max_turns?: number;
}

export interface ManifestOverrides {
  version: 1;
  overrides?: {
    agents?: Record<string, ManifestAgentOverride>;
    ignore?: string[];
  };
  extra_context_files?: string[];
}

// ─── Framework Scanner Result ───

export interface FrameworkResult {
  framework: string;
  agents: DiscoveredAgent[];
  skills: DiscoveredSkill[];
  commands: DiscoveredCommand[];
  context_files: DiscoveredContextFile[];
}
