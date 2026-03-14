import { getDb } from "../db";

/** Tables that support dynamic updates. */
type UpdatableTable = "issue_analyses" | "execution_plans" | "issue_worktrees";

/** Allowed column names per table, used to validate update keys. */
const ALLOWED_COLUMNS: Record<UpdatableTable, Set<string>> = {
  issue_analyses: new Set(["status", "result", "error"]),
  execution_plans: new Set(["status", "result", "error"]),
  issue_worktrees: new Set(["status", "branch_name", "path", "error"]),
};

/**
 * Build and execute a dynamic UPDATE statement from a partial object.
 * Automatically appends `updated_at` with an ISO timestamp and uses parameterized queries.
 * Only allows known tables and validated column names.
 */
export async function dynamicUpdate(
  table: UpdatableTable,
  id: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const allowed = ALLOWED_COLUMNS[table];
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(updates)) {
    if (!allowed.has(key)) {
      throw new Error(`Column "${key}" is not allowed for table "${table}"`);
    }
    sets.push(`${key} = $${i++}`);
    values.push(val);
  }
  sets.push(`updated_at = $${i++}`);
  values.push(new Date().toISOString());
  values.push(id);
  await db.execute(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${i}`, values);
}
