import { isTauri } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { Workspace } from "./types";

// In-browser preview: mock workspaces (session only)
let mockWorkspaces: Workspace[] = [];

export async function listWorkspaces(): Promise<Workspace[]> {
  if (!isTauri()) return [...mockWorkspaces];
  const db = await getDb();
  const rows = await db.select<Workspace[]>("SELECT id, name, created_at FROM workspaces ORDER BY created_at DESC");
  return rows;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  if (!isTauri()) {
    const w: Workspace = { id: crypto.randomUUID(), name, created_at: new Date().toISOString() };
    mockWorkspaces = [w, ...mockWorkspaces];
    return w;
  }
  const db = await getDb();
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  await db.execute("INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3)", [
    id,
    name,
    created_at,
  ]);
  return { id, name, created_at };
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  if (!isTauri()) return mockWorkspaces.find((w) => w.id === id) ?? null;
  const db = await getDb();
  const rows = await db.select<Workspace[]>("SELECT id, name, created_at FROM workspaces WHERE id = $1", [
    id,
  ]);
  return rows[0] ?? null;
}

export async function updateWorkspaceName(id: string, name: string): Promise<Workspace | null> {
  if (!isTauri()) {
    mockWorkspaces = mockWorkspaces.map((w) => (w.id === id ? { ...w, name } : w));
    return mockWorkspaces.find((w) => w.id === id) ?? null;
  }
  const db = await getDb();
  await db.execute("UPDATE workspaces SET name = $1 WHERE id = $2", [name, id]);
  return getWorkspace(id);
}

export async function deleteWorkspace(id: string): Promise<void> {
  if (!isTauri()) {
    mockWorkspaces = mockWorkspaces.filter((w) => w.id !== id);
    return;
  }
  const db = await getDb();
  await db.execute("DELETE FROM workspaces WHERE id = $1", [id]);
}
