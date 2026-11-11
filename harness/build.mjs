// Bundles the widget with mocked Mendix props for the browser harness: node harness/build.mjs
// Property defaults are read from the widget XML, so the harness renders a fresh Studio Pro instance.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const xml = readFileSync(here + "../src/MxTechiesDraggable.xml", "utf8");
const defaults = {};
const texts = {};
for (const match of xml.matchAll(/<property key="(\w+)" type="(\w+)"([^>]*)>([\s\S]*?)<\/property>/g)) {
    const [, key, type, attrs, body] = match;
    const def = /defaultValue="([^"]*)"/.exec(attrs)?.[1];
    if (type === "boolean") {
        defaults[key] = def === "true";
    } else if (type === "integer" || type === "decimal") {
        defaults[key] = Number(def ?? 0);
    } else if (type === "enumeration" || type === "string") {
        defaults[key] = def ?? "";
    } else if (type === "textTemplate") {
        texts[key] = /<translation lang="en_US">([\s\S]*?)<\/translation>/.exec(body)?.[1] ?? "";
    }
}
mkdirSync(here + "dist", { recursive: true });
writeFileSync(here + "dist/defaults.json", JSON.stringify({ defaults, texts }, null, 2));

await build({
    entryPoints: [here + "entry.tsx"],
    outdir: here + "dist",
    bundle: true,
    format: "iife",
    jsx: "automatic",
    target: "es2020",
    alias: { mendix: here + "shim-mendix.ts" },
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "warning"
});
console.log("harness bundle written");
