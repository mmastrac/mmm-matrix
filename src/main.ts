/// Entrypoint for the GitHub Action.
import { generateMatrix, indexMatrix } from "./matrix.ts";
import * as core from "npm:@actions/core";
import YAML from "npm:yaml";
import { highlight } from "npm:cli-highlight";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import { parseYaml } from "./parse.ts";

function parseArg(name: string) {
  try {
    const output = parseYaml(core.getInput(name));
    if (output === null || output === undefined) {
      return null;
    }
    return output;
  } catch (e) {
    core.setFailed(e as string);
    process.exit(1);
  }
}

// For JavaScript actions, process.cwd() is always GITHUB_WORKSPACE (the repo root)
function makeResolve(dir: string) {
  return (file: string) => {
    const resolved = path.resolve(dir, file);
    return { content: parseYaml(fs.readFileSync(resolved, "utf-8")), resolve: makeResolve(path.dirname(resolved)) };
  };
}

const input = parseArg("input");

core.startGroup("Input matrix");
core.info(highlight(YAML.stringify(input), { language: "yaml" }));
core.endGroup();

if (input === null) {
  core.setFailed("Input is required.");
  process.exit(1);
}

const defaultMatrix = parseArg("default");
if (defaultMatrix) {
  core.startGroup("Default matrix");
  core.info(highlight(YAML.stringify(defaultMatrix), { language: "yaml" }));
  core.endGroup();
}

const config = parseArg("config");

function parseIndexKeys(): string[] {
  const raw = core.getInput("index");
  if (!raw) return [];
  const parsed = parseYaml(raw);
  if (Array.isArray(parsed)) return parsed.map(String);
  if (typeof parsed === "string") return parsed.split(",").map((s: string) => s.trim()).filter(Boolean);
  return [];
}
const indexKeys = parseIndexKeys();

core.startGroup("Config object");
core.info(highlight(YAML.stringify(config), { language: "yaml" }));
core.endGroup();

const resolve = makeResolve(process.cwd());

let output;
try {
  output = generateMatrix(input, config, resolve);
} catch (e) {
  core.setFailed(e as string);
  process.exit(1);
}

if (output.length == 0) {
  if (defaultMatrix) {
    core.info("No matrix items were generated, using default");
    output = defaultMatrix;
  } else {
    core.setFailed("Failed to generate any matrix items");
    process.exit(1);
  }
}

core.startGroup("Generated matrix");
core.info(highlight(YAML.stringify(output), { language: "yaml" }));
core.endGroup();

core.setOutput("matrix", JSON.stringify(output));

if (indexKeys.length > 0) {
  try {
    const indexed = indexMatrix(output, indexKeys);
    for (const [key, dict] of Object.entries(indexed)) {
      core.startGroup(`Indexed by '${key}'`);
      core.info(highlight(YAML.stringify(dict), { language: "yaml" }));
      core.endGroup();
      core.setOutput(`matrix_${key}`, JSON.stringify(dict));
    }
  } catch (e) {
    core.setFailed(e as string);
    process.exit(1);
  }
}

core.info("Success.");
