---
name: dev
description: Start the Sparky dev environment (Vite + Tauri). Use when the user wants to run, start, or launch the app locally.
allowed-tools: Bash
disable-model-invocation: true
---

Start the Sparky development environment. This runs the Tauri dev server which starts both Vite (frontend) and the Rust backend.

Steps:
1. Check if port 1420 is already in use. If so, inform the user and stop.
2. Run `bun run tauri dev` in the background.
3. Tell the user the app is starting and they should see the window appear shortly.

Note: The `.env` file must contain `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for OAuth to work.
