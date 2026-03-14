import { getDb } from "../db";

/**
 * Build and execute a dynamic UPDATE statement from a partial object.
 * Automatically appends `updated_at = NOW()` and uses parameterized queries.
 */
export async function dynamicUpdate(
  table: string,
  id: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, val] of Object.entries(updates)) {
    sets.push(`${key} = $${i++}`);
    values.push(val);
  }
  sets.push(`updated_at = $${i++}`);
  values.push(new Date().toISOString());
  values.push(id);
  await db.execute(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${i}`, values);
}
