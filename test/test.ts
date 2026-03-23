/// <reference lib="deno.ns" />
import YAML from "npm:yaml";
import { printUnifiedDiff } from "npm:print-diff";
import { generateMatrix, indexMatrix } from "../src/matrix.ts";
import { OutputRecord } from "../src/types.ts";
import { logDebug, logError, setVerbosity, Verbosity } from "../src/log.ts";
import { parseYaml, parseJsonc } from "../src/parse.ts";

import {
  assertEquals,
  assertThrows,
  fail,
} from "https://deno.land/std@0.214.0/assert/mod.ts";

type Format = "JSON" | "JSONC" | "YAML";
try {
  if (Deno.env.get("VERBOSE") == "debug") {
    setVerbosity(Verbosity.Debugging);
  }
} catch {
  // No env permission — skip verbose check
}

Deno.chdir(new URL("./", import.meta.url));

function dirName(p: string): string {
  const lastSlash = p.lastIndexOf("/");
  return lastSlash >= 0 ? p.slice(0, lastSlash) : ".";
}

function makeResolve(dir: string) {
  return (file: string) => {
    const resolved = `${dir}/${file}`;
    const content = parseYaml(Deno.readTextFileSync(resolved));
    return { content, resolve: makeResolve(dirName(resolved)) };
  };
}
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
  return format == "JSON" || format == "JSONC"
    ? parseJsonc(inputText)
    : parseYaml(inputText);
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
    logDebug("Config:", config);
  }

  const outputFile = findTest(files, `${base}.out`);
  if (outputFile === undefined) {
    throw new Error(`Missing output file for ${base}`);
  }
  const output = loadTest(outputFile.test, outputFile.format);

  const input = loadTest(inputFile, format);

  const testResolve = makeResolve(dirName(inputFile) || ".");

  Deno.test(
    { name: `${success ? "" : "error "}${base} (${format})` },
    () => (success ? testGenerate : testGenerateError)(input, config, output, testResolve),
  );
}

// deno-lint-ignore no-explicit-any
function testGenerate(input: any, config: any, output: any, testResolve: ReturnType<typeof makeResolve>) {
  const generated = generateMatrix(input, config, testResolve);
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
function testGenerateError(input: any, config: any, output: any, testResolve: ReturnType<typeof makeResolve>) {
  try {
    const output = generateMatrix(input, config, testResolve);
    fail(
      "Test should not have succeeded, but it produced:" +
        YAML.stringify(output, { aliasDuplicateObjects: false }),
    );
  } catch (e: unknown) {
    const expected = YAML.stringify(output, { aliasDuplicateObjects: false });
    const actual = YAML.stringify((e as Error).message);
    if (actual != expected) {
      logError(e);
    }
    assertEquals(actual, expected);
  }
}

// --- indexMatrix tests ---

Deno.test("indexMatrix: basic indexing by a unique key", () => {
  const items = [
    { label: "linux", os: "ubuntu-latest" },
    { label: "macos", os: "macOS-latest" },
  ];
  const result = indexMatrix(items, ["label"]);
  assertEquals(result, {
    label: {
      linux: { label: "linux", os: "ubuntu-latest" },
      macos: { label: "macos", os: "macOS-latest" },
    },
  });
});

Deno.test("indexMatrix: multiple index keys", () => {
  const items = [
    { label: "linux", os: "ubuntu-latest" },
    { label: "macos", os: "macOS-latest" },
  ];
  const result = indexMatrix(items, ["label", "os"]);
  assertEquals(Object.keys(result), ["label", "os"]);
  assertEquals(result.label.linux, { label: "linux", os: "ubuntu-latest" });
  assertEquals(result.os["macOS-latest"], { label: "macos", os: "macOS-latest" });
});

Deno.test("indexMatrix: error on duplicate values", () => {
  const items = [
    { label: "linux", os: "ubuntu-latest", job: "build" },
    { label: "linux", os: "ubuntu-latest", job: "test" },
  ];
  assertThrows(
    () => indexMatrix(items, ["label"]),
    Error,
    "Duplicate value 'linux' for index key 'label'",
  );
});

Deno.test("indexMatrix: error on missing key", () => {
  const items: OutputRecord[] = [
    { label: "linux", os: "ubuntu-latest" },
    { os: "macOS-latest" },
  ];
  assertThrows(
    () => indexMatrix(items, ["label"]),
    Error,
    "Index key 'label' is missing from matrix item",
  );
});

Deno.test("indexMatrix: empty output", () => {
  const result = indexMatrix([], ["label"]);
  assertEquals(result, { label: {} });
});
