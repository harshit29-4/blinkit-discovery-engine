// Registers hooks.mjs (used with node --import).
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
