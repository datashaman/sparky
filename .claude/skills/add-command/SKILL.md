---
name: add-command
description: Add a new Tauri command (Rust backend callable from TypeScript frontend). Use when the user needs to add backend functionality.
argument-hint: <command_name> <description>
allowed-tools: Read, Edit, Write, Grep, Glob
---

Add a new Tauri command that the frontend can call via `invoke()`.

The user wants: $ARGUMENTS

Steps:

1. Read `src-tauri/src/lib.rs` to understand the current command registration pattern.
2. Add the new command function in `src-tauri/src/lib.rs` (or a new module if it's complex):
   - Use `#[tauri::command]` attribute
   - Use snake_case for the Rust function name
   - Return `Result<T, String>` for fallible operations
   - Use `async` if the command does I/O
3. Register the command in the `.invoke_handler(tauri::generate_handler![...])` call.
4. On the frontend, show how to call it:
   ```typescript
   import { invoke } from "@tauri-apps/api/core";
   const result = await invoke<ReturnType>("command_name", { paramName: value });
   ```

Note: Tauri automatically converts snake_case Rust params to camelCase in TypeScript. So `access_token: String` becomes `{ accessToken: string }` on the frontend.
