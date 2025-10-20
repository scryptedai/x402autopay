import { mkdir, rm, cp, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

const projectRoot = dirname(new URL(import.meta.url).pathname);
const root = join(projectRoot, "..");
const distDir = join(root, "dist");

async function clean() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

async function buildScripts() {
  const entrypoints = [
    join(root, "src/background.ts"),
    join(root, "src/content.main.ts"),
    join(root, "src/content.bridge.ts"),
    join(root, "src/popup.ts"),
    join(root, "src/prompt.ts"),
  ];

  const result = await Bun.build({
    entrypoints,
    outdir: distDir,
    target: "browser",
    format: "esm",
    splitting: false,
    minify: false,
    sourcemap: "inline",
  });

  if (!result.success) {
    for (const message of result.logs) {
      console.error(message);
    }
    throw new Error("Bun build failed");
  }
}

async function copyStatic() {
  const staticFiles = [
    "manifest.json",
    "popup.html",
    "popup.css",
    "prompt.html",
    "prompt.css",
  ];

  for (const file of staticFiles) {
    await cp(join(root, file), join(distDir, file));
  }

  const iconSizes = ["16", "32", "128"];
  await mkdir(join(distDir, "icons"), { recursive: true });
  for (const size of iconSizes) {
    await cp(
      join(root, "src/assets/icons", `icon-${size}.png`),
      join(distDir, "icons", `icon-${size}.png`),
    );
  }
}

async function writeVersionFile() {
  const timestamp = new Date().toISOString();
  await writeFile(join(distDir, ".built-at"), `${timestamp}\n`);
}

async function main() {
  await clean();
  await buildScripts();
  await copyStatic();
  await writeVersionFile();
  console.log("Built extension into", distDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
