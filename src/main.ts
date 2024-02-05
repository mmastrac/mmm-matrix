import { generateMatrix } from "./matrix.ts";
import * as core from "npm:@actions/core";
import YAML from "npm:yaml";
import { highlight } from "npm:cli-highlight";
import process from "node:process";

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

const input = parseArg("input");

core.startGroup("Input matrix");
core.info(highlight(YAML.stringify(input), { language: "yaml" }));
core.endGroup();

if (input === null) {
  core.setFailed("Input is required.");
  process.exit(1);
}

const config = parseArg("config");

core.startGroup("Config object");
core.info(highlight(YAML.stringify(config), { language: "yaml" }));
core.endGroup();

let output;
try {
  output = generateMatrix(input, config);
} catch (e) {
  core.setFailed(e);
  process.exit(1);
}

if (output.length == 0) {
  core.setFailed("Failed to generate any configurations");
  process.exit(1);
}

core.startGroup("Generated matrix");
core.info(highlight(YAML.stringify(output), { language: "yaml" }));
core.endGroup();

core.setOutput("matrix", JSON.stringify(output));
core.info("Success.");
