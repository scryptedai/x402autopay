import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join, dirname } from "node:path";

function exec(
  command: string,
  args: string[],
  options?: Parameters<typeof execFile>[2],
) {
  return new Promise<void>((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

const projectRoot = dirname(new URL(import.meta.url).pathname);
const root = join(projectRoot, "..");
const distDir = join(root, "dist");
const outZip = join(root, "x402-autopay.zip");

async function main() {
  await exec("bun", ["run", "build"]);
  await rm(outZip, { force: true });
  await exec("zip", ["-r", outZip, "."], { cwd: distDir });
  console.log("Packaged extension to", outZip);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

