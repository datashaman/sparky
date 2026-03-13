import { getDb } from "../db";
import type { StepExecutionStatus } from "./types";

interface StepResultRow {
  plan_id: string;
  step_order: number;
  status: string;
  output: string | null;
  error: string | null;
  updated_at: string;
}

export async function saveStepResult(
  planId: string,
  stepOrder: number,
  status: StepExecutionStatus,
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO execution_step_results (plan_id, step_order, status, output, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (plan_id, step_order) DO UPDATE SET
       status = excluded.status,
       output = excluded.output,
       error = excluded.error,
       updated_at = excluded.updated_at`,
    [planId, stepOrder, status.status, status.output ?? null, status.error ?? null, now],
  );
}

export async function getStepResultsForPlan(
  planId: string,
): Promise<Map<number, StepExecutionStatus>> {
  const db = await getDb();
  const rows = await db.select<StepResultRow[]>(
    "SELECT * FROM execution_step_results WHERE plan_id = ? ORDER BY step_order",
    [planId],
  );
  const map = new Map<number, StepExecutionStatus>();
  for (const row of rows) {
    const entry: StepExecutionStatus = {
      status: row.status as StepExecutionStatus["status"],
    };
    if (row.output) entry.output = row.output;
    if (row.error) entry.error = row.error;
    map.set(row.step_order, entry);
  }
  return map;
}

export async function deleteStepResultsForPlan(planId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM execution_step_results WHERE plan_id = ?", [planId]);
}
