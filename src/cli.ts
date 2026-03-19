import { generateMatrix } from "./matrix.ts";
import YAML from "npm:yaml";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const fetchSchemes = new Set(["http:", "https:", "file:", "data:"]);

function isFilePath(source: string): boolean {
  if (source.startsWith("{") || source.startsWith("[")) return false;
  try {
    const url = new URL(source);
    if (fetchSchemes.has(url.protocol)) return false;
  } catch {
    // Not a valid URL — it's a file path
  }
  return true;
}

async function loadInput(source: string): Promise<string> {
  // Inline JSON/YAML
  if (source.startsWith("{") || source.startsWith("[")) {
    return source;
  }
  // URL with a supported scheme
  try {
    const url = new URL(source);
    if (fetchSchemes.has(url.protocol)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    }
  } catch (e) {
    if (e instanceof TypeError) {
      // Not a valid URL — fall through to file read
    } else {
      throw e;
    }
  }
  // File path
  return fs.readFileSync(source, "utf-8");
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let input: string | undefined;
  let config: string | undefined;
  let output: string | undefined;
  let outputFormat: "yaml" | "json" = "yaml";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config") {
      config = args[++i];
      if (!config) fail("--config requires a file argument");
    } else if (args[i] === "--output") {
      output = args[++i];
      if (!output) fail("--output requires a file argument");
    } else if (args[i] === "--output-format") {
      const fmt = args[++i];
      if (fmt !== "yaml" && fmt !== "json") fail("--output-format must be 'yaml' or 'json'");
      outputFormat = fmt;
    } else if (args[i].startsWith("-")) {
      fail(`Unknown option: ${args[i]}`);
    } else {
      if (input) fail("Only one input file is allowed");
      input = args[i];
    }
  }

  if (!input) fail("Usage: mmm-matrix <input.{yaml,json} | url> [--config <config.{yaml,json} | url>] [--output <output>] [--output-format yaml|json]");
  return { input, config, output, outputFormat };
}

async function main() {
  const { input, config, output, outputFormat } = parseArgs(process.argv);

  let inputData;
  try {
    inputData = YAML.parse(await loadInput(input));
  } catch (e) {
    fail(`Failed to read input: ${e}`);
  }

  let configData;
  if (config) {
    try {
      configData = YAML.parse(await loadInput(config));
    } catch (e) {
      fail(`Failed to read config: ${e}`);
    }
  }

  const baseDir = isFilePath(input) ? path.dirname(path.resolve(input)) : process.cwd();
  const resolve = (file: string) => {
    const resolved = path.resolve(baseDir, file);
    return YAML.parse(fs.readFileSync(resolved, "utf-8"));
  };

  let result;
  try {
    result = generateMatrix(inputData, configData, resolve);
  } catch (e) {
    fail(`Failed to generate matrix: ${e}`);
  }

  const text = outputFormat === "json"
    ? JSON.stringify(result, null, 2) + "\n"
    : YAML.stringify(result);

  if (output) {
    fs.writeFileSync(output, text);
  } else {
    process.stdout.write(text);
  }
}

main();
