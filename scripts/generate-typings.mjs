// Regenerates typings/the widget props.d.ts from the widget XML without running a full build:
//   node scripts/generate-typings.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const tools = join(root, "node_modules/@mendix/pluggable-widgets-tools/dist/typings-generator/index.js");
const { transformPackage } = await import(pathToFileURL(tools).href);
const sourceDir = join(root, "src");
await transformPackage(readFileSync(join(sourceDir, "package.xml"), "utf8"), sourceDir);
console.log("typings regenerated");
