// Lets Node run the app's TypeScript directly: resolves extensionless imports to .ts and loads .json as a module.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith(".") || spec.startsWith("/")) && !/\.(ts|mjs|js|json)$/.test(spec)) {
    const u = new URL(spec + ".ts", ctx.parentURL);
    if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith(".json")) {
    const src = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${src};`, shortCircuit: true };
  }
  return next(url, ctx);
}
