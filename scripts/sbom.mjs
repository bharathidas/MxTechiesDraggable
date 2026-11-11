// CycloneDX 1.5 SBOM (JSON) of what the widget ships: node scripts/sbom.mjs (or npm run sbom)
// Reads dist/bundled-packages.json (written by scripts/check-licenses.mjs from the real module graph) and writes
// dist/<version>/sbom.cdx.json. No third-party SBOM tooling is used.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const input = join(root, "dist", "bundled-packages.json");
if (!existsSync(input)) {
    console.error("Run node scripts/check-licenses.mjs first.");
    process.exit(1);
}
const { bundled } = JSON.parse(readFileSync(input, "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const purl = (name, version) => `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;

const components = bundled.map(row => {
    const entry = lock.packages?.[`node_modules/${row.name}`];
    const component = {
        type: "library",
        "bom-ref": purl(row.name, row.version),
        name: row.name,
        version: row.version,
        purl: purl(row.name, row.version),
        licenses: [{ license: { id: row.licence } }],
        scope: "required"
    };
    if (entry?.integrity?.startsWith("sha512-")) {
        component.hashes = [{ alg: "SHA-512", content: Buffer.from(entry.integrity.slice(7), "base64").toString("hex") }];
    }
    if (row.url) {
        component.externalReferences = [{ type: "vcs", url: row.url.replace(/^git\+/, "") }];
    }
    return component;
});

// The widget's own source files (Apache-2.0), hashed so a reviewer can match the shipped build to the source.
function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            return name === "__tests__" ? [] : walk(full);
        }
        return /\.(tsx?|css|xml)$/.test(name) ? [full] : [];
    });
}
const own = walk(join(root, "src")).map(file => {
    const path = relative(root, file).replace(/\\/g, "/");
    return {
        type: "file",
        "bom-ref": `file:${path}`,
        name: path,
        licenses: [{ license: { id: pkg.license } }],
        hashes: [{ alg: "SHA-256", content: createHash("sha256").update(readFileSync(file)).digest("hex") }]
    };
});

const ref = `pkg:mendix/${pkg.packagePath}.${pkg.widgetName}@${pkg.version}`;
const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
        timestamp: new Date().toISOString(),
        tools: { components: [{ type: "application", name: "mxtechies-draggable-sbom", version: "1.0.0" }] },
        component: {
            type: "library",
            "bom-ref": ref,
            name: pkg.widgetName,
            version: pkg.version,
            description: pkg.description,
            licenses: [{ license: { id: pkg.license } }],
            supplier: { name: "MX Techies" }
        },
        properties: [
            { name: "mendix:externals", value: "react, react-dom, mendix, big.js (provided by the Mendix client, not bundled)" }
        ]
    },
    components: [...components, ...own],
    dependencies: [{ ref, dependsOn: components.map(c => c["bom-ref"]) }]
};
const dir = join(root, "dist", pkg.version);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "sbom.cdx.json"), JSON.stringify(bom, null, 2));
console.log(`SBOM with ${components.length} packages and ${own.length} source files -> dist/${pkg.version}/sbom.cdx.json`);
