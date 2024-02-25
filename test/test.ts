import YAML from "npm:yaml";
import { printUnifiedDiff } from "npm:print-diff";
import { generateMatrix, setVerbosity, Verbosity } from "../src/matrix.ts";

import {
  assertEquals,
  fail,
} from "https://deno.land/std@0.214.0/assert/mod.ts";

type Format = "JSON" | "JSONC" | "YAML";

let verbosity = Verbosity.Normal;
if (Deno.env.get("VERBOSE") == "debug") {
  setVerbosity(verbosity = Verbosity.Debugging);
}

Deno.chdir(new URL("./", import.meta.url));

const files = new Set(
  Array.from(Deno.readDirSync("."))
    .filter((f) => f.isFile)
    .map((f) => f.name),
);

function getTestFileType(
  file: string,
): { base: string; format: Format } | undefined {
  let format: Format;
  let base;
  if (file.endsWith(".yaml")) {
    format = "YAML";
    base = file.replaceAll(".yaml", "");
  } else if (file.endsWith(".json")) {
    format = "JSON";
    base = file.replaceAll(".json", "");
  } else if (file.endsWith(".jsonc")) {
    format = "JSONC";
    base = file.replaceAll(".jsonc", "");
  } else {
    return undefined;
  }

  if (base.endsWith(".out") || base.endsWith(".config")) {
    return undefined;
  }

  return { base, format };
}

for (const name of files) {
  const test = getTestFileType(name);
  if (test === undefined) {
    continue;
  }

  generateTestFunction(
    files,
    `${test.base}`,
    test.format,
    `${test.base}`,
    true,
  );
}

const errorFiles = new Set(
  Array.from(Deno.readDirSync("./errors"))
    .filter((f) => f.isFile)
    .map((f) => `errors/${f.name}`),
);

for (const name of errorFiles) {
  const test = getTestFileType(name);
  if (test === undefined) {
    continue;
  }

  generateTestFunction(
    errorFiles,
    `${test.base}`,
    test.format,
    `${test.base}`,
    false,
  );
}

function findTest(
  files: Set<string>,
  test: string,
): { format: Format; test: string } | undefined {
  let format: Format;

  format = "JSON";
  if (!files.has(`${test}.json`)) {
    format = "JSONC";
    if (!files.has(`${test}.jsonc`)) {
      format = "YAML";
      if (!files.has(`${test}.yaml`)) {
        return undefined;
      }
    }
  }
  return { format, test };
}

function loadTest(file: string, format: Format) {
  const inputText = Deno.readTextFileSync(`${file}.${format.toLowerCase()}`);
  return format == "JSON"
    ? JSON.parse(inputText)
    : (format == "JSONC" ? eval(`(${inputText})`) : YAML.parse(inputText));
}

function generateTestFunction(
  files: Set<string>,
  inputFile: string,
  format: Format,
  base: string,
  success: boolean,
) {
  if (findTest(files, `${base}-1.config`) !== undefined) {
    for (let i = 1; findTest(files, `${base}-${i}.config`); i++) {
      generateTestFunction(files, inputFile, format, `${base}-${i}`, success);
    }
    return;
  }

  const configFile = findTest(files, `${base}.config`);
  let config = {};
  if (configFile !== undefined) {
    config = loadTest(configFile.test, configFile.format);
    if (verbosity >= Verbosity.Debugging) {
      console.log("Config:", config);
    }
  }

  const outputFile = findTest(files, `${base}.out`);
  if (outputFile === undefined) {
    throw new Error(`Missing output file for ${base}`);
  }
  const output = loadTest(outputFile.test, outputFile.format);

  const input = loadTest(inputFile, format);

  Deno.test(
    { name: `${success ? "" : "error "}${base} (${format})` },
    () => (success ? testGenerate : testGenerateError)(input, config, output),
  );
}

// deno-lint-ignore no-explicit-any
function testGenerate(input: any, config: any, output: any) {
  const generated = generateMatrix(input, config);
  const testOutput = YAML.stringify(generated, {
    aliasDuplicateObjects: false,
  });
  const expected = YAML.stringify(output, { aliasDuplicateObjects: false });

  if (testOutput != expected) {
    printUnifiedDiff(testOutput, expected);
    fail("Failed to match output");
  }
}

// deno-lint-ignore no-explicit-any
function testGenerateError(input: any, config: any, output: any) {
  try {
    const output = generateMatrix(input, config);
    fail(
      "Test should not have succeeded, but it produced:" +
        YAML.stringify(output, { aliasDuplicateObjects: false }),
    );
  } catch (e) {
    const expected = YAML.stringify(output, { aliasDuplicateObjects: false });
    const actual = YAML.stringify(e.message);
    if (actual != expected) {
      console.error(e);
    }
    assertEquals(actual, expected);
  }
}
