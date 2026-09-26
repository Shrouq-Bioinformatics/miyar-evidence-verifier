import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);

const testDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(testDir, "..");
const outputDir = path.join(artifactDir, "dist", "miyar-e2e-test-harness");

if (process.env.NODE_ENV !== "development") {
  throw new Error("The authenticated integration harness only builds in development.");
}

await rm(outputDir, { recursive: true, force: true });
try {
  await build({
    entryPoints: [path.join(testDir, "authenticated-integration-entry.ts")],
    absWorkingDir: artifactDir,
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    outExtension: { ".js": ".mjs" },
    external: ["*.node", "pg-native"],
    sourcemap: false,
    logLevel: "info",
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    // Match the API build's CommonJS compatibility without forcing a shared
    // entry name; the Pino plugin emits separate worker modules.
    banner: {
      js: `import { createRequire as __bannerCrReq } from "node:module";
import __bannerPath from "node:path";
import __bannerUrl from "node:url";
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`,
    },
  });
} catch (error) {
  await rm(outputDir, { recursive: true, force: true });
  throw error;
}