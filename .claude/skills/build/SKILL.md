---
name: build
description: Build and type-check the Sparky project. Use when the user wants to verify the build or check for errors.
allowed-tools: Bash
disable-model-invocation: true
---

Build and validate the Sparky project. Run these checks in parallel:

1. **TypeScript type-check**: `npx tsc --noEmit`
2. **Vite production build**: `npx vite build`

Report results clearly. For type errors, show the file, line, and error message. Ignore these known pre-existing errors:
- `setMaximized` on Window (App.tsx)
- `isVisible` unused/missing (App.tsx)
- Errors in `AgentsList.tsx` (work in progress)

If both pass (ignoring the above), confirm the build is clean.
