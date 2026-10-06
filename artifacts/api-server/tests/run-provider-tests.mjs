import { build } from "esbuild";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(apiDir, "tests");
const outputDir = path.join(testsDir, ".provider-test-dist");

try {
  await rm(outputDir, { recursive: true, force: true });
  await build({
    entryPoints: [
      path.join(testsDir, "quranenc-tafsir.test.ts"),
      path.join(testsDir, "quranenc-tafsir-provider.test.ts"),
      path.join(testsDir, "alifta-hadith-provider.test.ts"),
      path.join(testsDir, "ibn-hisham-seerah-provider.test.ts"),
      path.join(testsDir, "source-safety.test.ts"),
      path.join(testsDir, "evidence-providers.test.ts"),
      path.join(testsDir, "public-verifier-extraction.test.ts"),
    ],
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    outExtension: { ".js": ".mjs" },
    external: ["node:*"],
  });

  const files = (await readdir(outputDir))
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => path.join(outputDir, file));
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: apiDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
