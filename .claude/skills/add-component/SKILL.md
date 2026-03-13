---
name: add-component
description: Scaffold a new React component for Sparky. Use when the user wants to create a new UI component.
argument-hint: <ComponentName>
allowed-tools: Read, Write, Edit, Glob, Grep
---

Create a new React component in `src/components/`.

Arguments: `$ARGUMENTS` is the component name (PascalCase).

Steps:
1. Verify the name is PascalCase. If not, convert it.
2. Check if `src/components/$ARGUMENTS.tsx` already exists. If so, warn and stop.
3. Create `src/components/$ARGUMENTS.tsx` following these conventions from the existing codebase:
   - Named export (not default): `export function ComponentName()`
   - Props interface defined above the component
   - Import React hooks from "react" as needed
   - No inline styles — all styling goes in `src/App.css`
4. Add a CSS section comment in `src/App.css` at the end (before any `@media` dark mode block): `/* $ARGUMENTS */`
5. Tell the user what was created and where to import it.

Reference the existing components (`WorkspaceList.tsx`, `WorkspaceDetail.tsx`, `ErrorMessage.tsx`) for patterns.
