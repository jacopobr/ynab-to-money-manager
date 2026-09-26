import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "dist/index.html",
  "dist/styles.css",
  "dist/app.js",
  "dist/vendor/xlsx.full.min.js",
  "dist/vendor/SHEETJS-LICENSE.txt",
  ".github/CODEOWNERS",
  ".github/workflows/pages.yml",
  ".github/workflows/release.yml",
];

const errors = [];
for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) errors.push(`Missing required file: ${file}`);
}

try {
  execFileSync(process.execPath, ["--check", resolve(root, "dist/app.js")], { stdio: "pipe" });
} catch (error) {
  errors.push(`JavaScript syntax check failed:\n${error.stderr?.toString() || error.message}`);
}

const htmlPath = resolve(root, "dist/index.html");
const html = readFileSync(htmlPath, "utf8");
const js = readFileSync(resolve(root, "dist/app.js"), "utf8");

if (/cdn\.sheetjs\.com/i.test(html)) errors.push("SheetJS must be loaded from the vendored local copy, not a CDN");

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) errors.push(`Duplicate HTML IDs: ${duplicateIds.join(", ")}`);

const idSet = new Set(ids);
const referencedIds = [...js.matchAll(/\$\(["']#([A-Za-z][\w:.-]*)/g)].map((match) => match[1]);
const missingIds = [...new Set(referencedIds.filter((id) => !idSet.has(id)))];
if (missingIds.length) errors.push(`JavaScript references missing HTML IDs: ${missingIds.join(", ")}`);

for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
  const reference = match[1];
  if (/^(?:https?:|mailto:|#|data:)/.test(reference)) continue;
  const cleanReference = reference.split(/[?#]/, 1)[0];
  if (!cleanReference) continue;
  const assetPath = resolve(dirname(htmlPath), cleanReference);
  if (!existsSync(assetPath)) errors.push(`Missing local asset: ${reference}`);
}

const publicationFiles = ["README.md", "dist/index.html", "dist/app.js", "dist/styles.css"];
for (const file of publicationFiles) {
  const contents = readFileSync(resolve(root, file), "utf8");
  if (/file:\/\//i.test(contents)) errors.push(`Local file URL found in ${file}`);
  if (/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i.test(contents) && file !== "README.md") {
    errors.push(`Localhost URL found in public application file: ${file}`);
  }
}

if (existsSync(resolve(root, "dist/designs.html"))) {
  errors.push("Obsolete design comparison page is still present: dist/designs.html");
}

if (errors.length) {
  console.error(`Checks failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Checks passed: syntax, repository files, HTML IDs, assets, and publication hygiene.");
