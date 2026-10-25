// Fails when a file shared by every plugin has drifted between packages.
import fs from "node:fs";
import path from "node:path";

const SHARED = ["src/log.ts", "src/registry.ts", "test/shared.test.mjs"];
const root = path.join(import.meta.dirname, "..", "packages");
const packages = fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, "package.json"))).sort();
let failed = false;

for (const file of SHARED) {
  const [first, ...rest] = packages;
  const expected = fs.readFileSync(path.join(root, first, file), "utf8");
  for (const name of rest) {
    const target = path.join(root, name, file);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== expected) {
      console.error(`packages/${name}/${file} differs from packages/${first}/${file}`);
      failed = true;
    }
  }
}

process.exitCode = failed ? 1 : 0;
