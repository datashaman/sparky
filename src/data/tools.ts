export interface ToolDef {
  id: string;
  name: string;
  description: string;
  dangerous: boolean;
}

export const TOOLS: ToolDef[] = [
  { id: "read", name: "Read", description: "Read a file's contents", dangerous: false },
  { id: "write", name: "Write", description: "Create or overwrite a file", dangerous: true },
  { id: "edit", name: "Edit", description: "Find-and-replace text in a file", dangerous: true },
  { id: "glob", name: "Glob", description: "Find files matching a pattern", dangerous: false },
  { id: "grep", name: "Grep", description: "Search file contents with regex", dangerous: false },
  { id: "bash", name: "Bash", description: "Run a shell command", dangerous: true },
];
