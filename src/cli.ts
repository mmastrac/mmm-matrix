import { generateMatrix } from "./matrix.ts";
import YAML from "npm:yaml";
import process from "node:process";
import fs from "node:fs";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let input: string | undefined;
  let config: string | undefined;
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config") {
      config = args[++i];
      if (!config) fail("--config requires a file argument");
    } else if (args[i] === "--output") {
      output = args[++i];
      if (!output) fail("--output requires a file argument");
    } else if (args[i].startsWith("-")) {
      fail(`Unknown option: ${args[i]}`);
    } else {
      if (input) fail("Only one input file is allowed");
      input = args[i];
    }
  }

  if (!input) fail("Usage: mmm-matrix <input.yaml> [--config <config.yaml>] [--output <output.yaml>]");
  return { input, config, output };
}

const { input, config, output } = parseArgs(process.argv);

let inputData;
try {
  inputData = YAML.parse(fs.readFileSync(input, "utf-8"));
} catch (e) {
  fail(`Failed to read input file: ${e}`);
}

let configData;
if (config) {
  try {
    configData = YAML.parse(fs.readFileSync(config, "utf-8"));
  } catch (e) {
    fail(`Failed to read config file: ${e}`);
  }
}

let result;
try {
  result = generateMatrix(inputData, configData);
} catch (e) {
  fail(`Failed to generate matrix: ${e}`);
}

const yaml = YAML.stringify(result);

if (output) {
  fs.writeFileSync(output, yaml);
} else {
  process.stdout.write(yaml);
}
