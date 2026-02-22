import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "../..");
const releaseManifestPath = path.join(repoRoot, "release", "manifest.json");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--") || value === undefined) {
    continue;
  }
  args.set(key.slice(2), value);
}

const repo = args.get("repo") ?? process.env.GITHUB_REPOSITORY ?? "org/talk";
const tag = args.get("tag") ?? `v${JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version}`;
const outputPath = path.resolve(
  args.get("output") ?? path.join(repoRoot, "homebrew", "Formula", "spark-talk.rb")
);
const localTarball = args.get("local-tarball");

const manifest = JSON.parse(readFileSync(releaseManifestPath, "utf8"));

const url = localTarball
  ? `file://${path.resolve(localTarball)}`
  : `https://github.com/${repo}/releases/download/${tag}/${manifest.tarballName}`;

const formula = `class SparkTalk < Formula
  desc "SQLite-backed local broker CLI for relaying messages between Spark Talk threads"
  homepage "https://github.com/${repo}"
  url "${url}"
  sha256 "${manifest.sha256}"
  license "Apache-2.0"

  depends_on "node@22"

  def install
    libexec.install Dir["*"]

    cd libexec do
      system Formula["node@22"].opt_bin/"npm", "install", "--omit=dev"
    end

    (bin/"spark").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/dist/cli.js" "$@"
    EOS
  end

  test do
    assert_match "${manifest.version}", shell_output("#{bin}/spark --version").strip
  end
end
`;

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, formula);

console.log(`formula_output=${outputPath}`);
console.log(`formula_url=${url}`);
