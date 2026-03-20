/// Parsing for YAML and JSON/JSONC input.

import YAML from "npm:yaml";
import { parse as jsoncParse } from "npm:jsonc-parser";

// deno-lint-ignore no-explicit-any
export function parseYaml(source: string): any {
  return YAML.parse(source);
}

// deno-lint-ignore no-explicit-any
export function parseJsonc(source: string): any {
  return jsoncParse(source);
}
