/**
 * Copy better-sqlite3 native addon and its node_modules dependency
 * into dist/ so the bundled worker can find it at runtime.
 */
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

// Copy the better-sqlite3 package (includes prebuilt native addon)
const src = join(root, "node_modules", "better-sqlite3");
const dest = join(dist, "node_modules", "better-sqlite3");

mkdirSync(join(dist, "node_modules"), { recursive: true });
cpSync(src, dest, { recursive: true });

// Copy bindings dependency
const bindingsSrc = join(root, "node_modules", "bindings");
const bindingsDest = join(dist, "node_modules", "bindings");
cpSync(bindingsSrc, bindingsDest, { recursive: true });

// Copy file-uri-to-path dependency (used by bindings)
try {
  const furiSrc = join(root, "node_modules", "file-uri-to-path");
  const furiDest = join(dist, "node_modules", "file-uri-to-path");
  cpSync(furiSrc, furiDest, { recursive: true });
} catch {
  // Optional dependency, may not exist
}

console.log("[copy-native] better-sqlite3 native addon copied to dist/");
