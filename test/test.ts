import YAML from "npm:yaml";
import { printUnifiedDiff } from "npm:print-diff";
import { generateMatrix } from "../src/matrix.ts";

import {
  assertEquals,
  fail,
} from "https://deno.land/std@0.214.0/assert/mod.ts";

Deno.chdir(new URL("./", import.meta.url));

const files = new Set(
  Array.from(Deno.readDirSync("."))
    .filter((f) => f.isFile)
    .map((f) => f.name),
);

for (const name of files) {
  if (!name.endsWith("out.yaml")) {
    continue;
  }
  const base = name.replaceAll(".out.yaml", "");
  const { format, test } = findTest(files, base);
  Deno.test(
    { name: `${base} (${format})` },
    generateTestFunction(
      `${test}`,
      format,
      `${name}`,
      `${base}.config.json`,
      true,
    ),
  );
}

const errorFiles = new Set(
  Array.from(Deno.readDirSync("./errors"))
    .filter((f) => f.isFile)
    .map((f) => `errors/${f.name}`),
);

for (const name of errorFiles) {
  if (!name.endsWith("out.yaml")) {
    continue;
  }
  const base = name.replaceAll(".out.yaml", "");
  const { format, test } = findTest(errorFiles, base);
  Deno.test(
    { name: `error ${base} (${format})` },
    generateTestFunction(
      `${test}`,
      format,
      `${name}`,
      `${base}.config.json`,
      false,
    ),
  );
}

function findTest(
  files: Set<string>,
  base: string,
): { format: "JSON" | "JSONC" | "YAML"; test: string } {
  let test, format: "JSON" | "JSONC" | "YAML";

  test = `${base}.json`;
  format = "JSON";
  if (!files.has(test)) {
    test = `${base}.jsonc`;
    format = "JSONC";
    if (!files.has(test)) {
      test = `${base}.yaml`;
      format = "YAML";
      if (!files.has(test)) {
        throw `Missing input file for ${base}`;
      }
    }
  }
  return { format, test };
}

function generateTestFunction(
  inputFile: string,
  format: "JSON" | "JSONC" | "YAML",
  outputFile: string,
  configFile: string,
  success: boolean,
) {
  let configText = "{}";
  try {
    configText = Deno.readTextFileSync(configFile);
  } catch {
    /* pass */
  }
  const config = JSON.parse(configText);
  const output = YAML.parse(Deno.readTextFileSync(outputFile));
  const inputText = Deno.readTextFileSync(inputFile);
  const input = format == "JSON"
    ? JSON.parse(inputText)
    : (format == "JSONC" ? eval(`(${inputText})`) : YAML.parse(inputText));

  return () => {
    (success ? testGenerate : testGenerateError)(input, config, output);
  };
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
