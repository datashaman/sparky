---
name: add-migration
description: Add a new SQLite migration to the Sparky database. Use when the user needs to add/modify database tables or columns.
argument-hint: <description of schema change>
allowed-tools: Read, Edit, Grep
---

Add a new SQLite migration to the Sparky app.

The user wants: $ARGUMENTS

Sparky uses inline migrations in `src/db.ts`. The pattern is:

1. Read `src/db.ts` to understand the current migration setup.
2. Migrations are run sequentially in the `initDb()` function using `db.execute()`.
3. Add the new migration at the end of the existing migrations, following the same pattern.
4. If adding a new table, also create the corresponding TypeScript interface in `src/data/types.ts`.
5. If adding a new table, create or update the data module in `src/data/` following the CRUD pattern from `workspaces.ts` or `repos.ts`:
   - Export async functions for list, get, create, update, delete
   - Include both Tauri (real DB) and non-Tauri (mock) code paths
   - Use parameterized queries ($1, $2, etc.)

Important:
- SQLite: use TEXT for UUIDs, TEXT for ISO dates, INTEGER for booleans (0/1)
- Always add `IF NOT EXISTS` for CREATE TABLE
- Add indexes for foreign keys
- Use CASCADE on foreign key deletes where appropriate
