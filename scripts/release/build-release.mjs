import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "../..");
const releaseDir = path.join(repoRoot, "release");
const packageJsonPath = path.join(repoRoot, "package.json");

const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = pkg.version;
const tarballName = `${pkg.name}-${version}.tgz`;
const tarballPath = path.join(releaseDir, tarballName);

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
execFileSync("npm", ["pack", "--pack-destination", releaseDir], {
  cwd: repoRoot,
  stdio: "inherit"
});

const sha256 = createHash("sha256")
  .update(readFileSync(tarballPath))
  .digest("hex");

const manifest = {
  name: pkg.name,
  version,
  tarballName,
  tarballPath,
  sha256,
  generatedAt: new Date().toISOString()
};

writeFileSync(
  path.join(releaseDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(`release_tarball=${tarballPath}`);
console.log(`release_sha256=${sha256}`);
console.log(`release_manifest=${path.join(releaseDir, "manifest.json")}`);
