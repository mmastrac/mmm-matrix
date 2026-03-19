import { generateMatrix } from "./matrix.ts";
import * as core from "npm:@actions/core";
import YAML from "npm:yaml";
import { highlight } from "npm:cli-highlight";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";

function parseArg(name: string) {
  try {
    const output = YAML.parse(core.getInput(name));
    if (output === null || output === undefined) {
      return null;
    }
    return output;
  } catch (e) {
    core.setFailed(e);
    process.exit(1);
  }
}

// For JavaScript actions, process.cwd() is always GITHUB_WORKSPACE (the repo root)
function makeResolve(dir: string) {
  return (file: string) => {
    const resolved = path.resolve(dir, file);
    return { content: YAML.parse(fs.readFileSync(resolved, "utf-8")), resolve: makeResolve(path.dirname(resolved)) };
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

core.startGroup("Config object");
core.info(highlight(YAML.stringify(config), { language: "yaml" }));
core.endGroup();

const resolve = makeResolve(process.cwd());

let output;
try {
  output = generateMatrix(input, config, resolve);
} catch (e) {
  core.setFailed(e);
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
core.info("Success.");
