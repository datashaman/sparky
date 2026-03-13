---
name: preview
description: Open the Sparky web preview in a browser (no Tauri, mock data). Use when the user wants to quickly see the UI without building the full desktop app.
allowed-tools: Bash
disable-model-invocation: true
---

Start the Vite dev server for web preview and open it in the browser.

Steps:
1. Check if port 1420 is already in use. If so, just open the browser.
2. Run `npx vite` in the background.
3. Wait a moment for the server to start.
4. Open `http://localhost:1420` in the default browser.

Note: In web preview mode, the app uses mock in-memory data (no SQLite, no Tauri APIs). GitHub login will show a "preview" user automatically. This is useful for rapidly iterating on UI changes without a full Tauri build.
