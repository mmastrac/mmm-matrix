import { isRegularKey, isSpecialKey } from "./types.ts";
import { RegularKey } from "./types.ts";
import { isDebugging, logDebug, logDetailed } from "./log.ts";

const ifKey = "$if";
const matchKey = "$match";
const valueKey = "$value";
const dynamicKey = "$dynamic";
const arrayKey = "$array";
const arraysKey = "$arrays";
const includeKey = "$include";

const maxIncludeDepth = 10;

// deno-lint-ignore no-explicit-any
type ResolveResult = { content: any; resolve: ResolveFunction };
// deno-lint-ignore no-explicit-any
type AsyncResolveResult = { content: any; resolve: AsyncResolveFunction };

export type ResolveFunction = (path: string) => ResolveResult;
export type AsyncResolveFunction = (path: string) => AsyncResolveResult | Promise<AsyncResolveResult>;

// Helper to chain sync-or-async values without forcing everything async
function then<T, U>(value: T | Promise<T>, fn: (v: T) => U | Promise<U>): U | Promise<U> {
  if (value instanceof Promise) {
    return value.then(fn);
  }
  return fn(value);
}

// "Colorless" resolveIncludes: returns sync if resolve is sync, Promise if resolve is async
// deno-lint-ignore no-explicit-any
function resolveIncludes(input: any, resolve: ResolveFunction | AsyncResolveFunction, depth: number): any {
  if (depth > maxIncludeDepth) {
    throw new Error(`$include depth exceeded ${maxIncludeDepth} levels`);
  }
  if (Array.isArray(input)) {
    const results = input.map((item: unknown) => resolveIncludes(item, resolve, depth));
    return results.some((r: unknown) => r instanceof Promise) ? Promise.all(results) : results;
  }
  if (typeof input === "object" && input !== null) {
    if (includeKey in input) {
      const includePath = input[includeKey];
      if (typeof includePath !== "string") {
        throw new Error(`$include value must be a string, got ${friendlyTypeOf(includePath)}`);
      }
      logDebug("$include:", includePath);
      // deno-lint-ignore no-explicit-any
      return then(resolve(includePath), ({ content, resolve: childResolve }: any) => {
        logDebug("$include resolved:", includePath, "->", content);
        return then(resolveIncludes(content, childResolve, depth + 1), (resolved: unknown) => {
          const siblings: Record<string, unknown> = {};
          for (const key of Object.keys(input)) {
            if (key !== includeKey) {
              siblings[key] = input[key];
            }
          }
          const hasSiblings = Object.keys(siblings).length > 0;
          if (hasSiblings) {
            if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
              throw new Error(`$include resolved to ${friendlyTypeOf(resolved)} but has sibling keys`);
            }
            for (const key of Object.keys(siblings)) {
              if (key in (resolved as Record<string, unknown>)) {
                throw new Error(`$include resolved object has duplicate key '${key}'`);
              }
            }
            const merged = { ...resolved as Record<string, unknown>, ...siblings };
            return resolveIncludes(merged, childResolve, depth);
          }
          return resolved;
        });
      });
    }
    const entries = Object.entries(input);
    const values = entries.map(([, value]) => resolveIncludes(value, resolve, depth));
    if (values.some((r: unknown) => r instanceof Promise)) {
      return Promise.all(values).then((resolvedValues: unknown[]) => {
        const result: Record<string, unknown> = {};
        entries.forEach(([key], i) => { result[key] = resolvedValues[i]; });
        return result;
      });
    }
    const result: Record<string, unknown> = {};
    entries.forEach(([key], i) => { result[key] = values[i]; });
    return result;
  }
  return input;
}

// Workaround for https://github.com/microsoft/TypeScript/issues/17867
// OutputRecord needs [key: string] + a differently-typed $if property,
// which TS doesn't allow with string keys. A unique symbol sidesteps this.
// deno-lint-ignore no-explicit-any
const ifSymbol: unique symbol = ifKey as any;

// NOTE: Verbosity + logging are centralized in `log.ts`.

type OutputValue = string | boolean | { [dynamicKey]: string };
type IfValue = string | string[];
type OutputRecord = { [key: string]: OutputValue; [ifSymbol]?: IfValue };

// The top-level object
type Input = Input[] | InputObject;

type InputObject = {
  [key: RegularKey]: InputObjectValue | {
    [matchKey]: MatchObject<InputObjectValue>;
    [ifKey]?: IfValue;
  };
  [ifKey]?: string;
  [arrayKey]?: Input[] | { [key: `${number}`]: Input };
  [arraysKey]?: Input[][] | { [key: `${number}`]: Input[] };
  [matchKey]?: MatchObject<Input>;
};

type InputObjectValue = InputValue | NestedInputObject | {
  [dynamicKey]: string;
};

// eg: the "mac: ..." in label: mac: os: osx
type NestedInputObject = { [key: string]: Input };

function isNestedInputObject(
  input: InputObjectValue,
): input is NestedInputObject {
  return typeof input === "object" && !Array.isArray(input) &&
    !(dynamicKey in input);
}

type InputValue = string | boolean | InputValue[];
type NestedInputValue = InputValue | InputValueObject;

type InputValueObject =
  & { [key: RegularKey]: InputValue; [ifKey]?: IfValue }
  & (
    | { [matchKey]?: MatchObject<InputValue> }
    | { [valueKey]?: InputValue }
    | { [dynamicKey]?: string }
    | Record<string, never>
  );
type MatchObject<T> = { [key: string]: T };

type SplitValueObject<T = unknown> = {
  match?: MatchObject<T>;
  dynamic?: string;
  value?: T;
  if?: IfValue;
  regular: { [key: string]: T };
};

function splitValueObject<T>(input: object): SplitValueObject<T> {
  const result: SplitValueObject<T> = { regular: {} };
  for (const [key, val] of Object.entries(input)) {
    if (key === matchKey) result.match = val;
    else if (key === dynamicKey) result.dynamic = val;
    else if (key === valueKey) result.value = val;
    else if (key === ifKey) result.if = val;
    else result.regular[key] = val;
  }
  const specials = [
    result.match !== undefined && matchKey,
    result.dynamic !== undefined && dynamicKey,
    result.value !== undefined && valueKey,
  ].filter(Boolean);
  if (specials.length > 1) {
    throw new Error(`${specials.join(", ")} cannot be combined in the same object`);
  }
  return result;
}

// https://stackoverflow.com/questions/12303989/cartesian-product-of-multiple-arrays-in-javascript
function cartesian<T>(...arr: T[][]): T[][] {
  // Eliminate any empty arrays
  const arrays = arr.flatMap((arr) => arr.length == 0 ? [] : [arr]);
  return arrays.reduce(function (a: T[][], b: T[]) {
    return a.map(function (x: T[]) {
      return b.map(function (y: T) {
        return x.concat([y]);
      });
    }).reduce(function (a, b) {
      return a.concat(b);
    }, []);
  }, [[]]);
}

function isArray<T>(input: T[] | object): input is T[] {
  return Array.isArray(input);
}

function isObject(input: unknown): input is object {
  return typeof input == "object" && input !== null;
}

function friendlyTypeOf(input: unknown): string {
  if (input === null) return "null";
  if (input === undefined) return "undefined";
  if (Array.isArray(input)) return "array";
  return typeof input;
}

function isDynamicObject(
  input: unknown,
): input is { [dynamicKey]: string } {
  return typeof input == "object" && input !== null && !Array.isArray(input) &&
    dynamicKey in input;
}

function arrayify(s?: IfValue): string[] {
  if (s === undefined) {
    return [];
  }
  if (Array.isArray(s)) {
    return s;
  }
  return [s];
}

function mergeIf(target: OutputRecord, ifStatement?: string | string[]) {
  if (!(ifKey in target) && ifStatement === undefined) {
    return;
  }

  target[ifSymbol] = arrayify(target[ifSymbol]).concat(arrayify(ifStatement));
}

function merge(partials: OutputRecord[]): OutputRecord {
  if (partials.length == 0) {
    return {};
  }
  let output: OutputRecord = {};
  for (const partial of partials) {
    const ifStatement = partial[ifSymbol];
    delete partial[ifSymbol];
    output = { ...output, ...partial };
    mergeIf(output, ifStatement);
    partial[ifSymbol] = ifStatement;
  }
  return output;
}

function cartesianMerge(...partials: OutputRecord[][]): OutputRecord[] {
  let input;
  if (isDebugging()) {
    input = structuredClone(partials);
  }

  const nonEmptyPartials = partials.filter((partial) => partial.length > 0);
  const output = cartesian(...nonEmptyPartials).map(merge);
  logDebug("Merge:", input, "->", output);

  return output;
}

/**
 * Flatten an array recursively, filtering out any empty items or items
 * that consist of nothing but an `if` key.
 */
function flattenArray(input: Input[]): OutputRecord[] {
  const flattened = input.flatMap(flatten);
  logDebug("Flatten array:", input, "->", flattened);
  return flattened.filter((item) => {
    const keys = Object.keys(item);
    if (keys.length == 0) {
      logDebug("Removing item with no content", item);
      return false;
    }
    if (keys.length == 1 && keys[0] == ifKey) {
      logDebug("Removing item with no content", item);
      return false;
    }
    return true;
  });
}

function parseMatch<T>(
  match: MatchObject<T>,
): { cases: { condition: string[]; output: T }[]; default: string[] } {
  const keys = Object.keys(match);
  const ifAccum = [];
  const cases = [];
  // Push a set for all cases of this $match, adding a negation for previous cases
  for (const key of keys) {
    const condition = structuredClone(ifAccum);
    condition.push(key);
    ifAccum.push(`!(${key})`);
    cases.push({ condition, output: match[key] });
  }

  // Finally, push an empty set if all items failed
  return { cases, default: ifAccum };
}

/**
 * This can be:
 *
 *  - an array, in which we recursively flatten
 *  - an object, in which we extract the keys and then flattenWithKeyInput.
 */
function flatten(input: Input): OutputRecord[] {
  if (isArray(input)) {
    return flattenArray(input);
  }
  if (isObject(input)) {
    if (valueKey in input || dynamicKey in input) {
      throw new Error("Illegal $value or $dynamic key in object context");
    }
    const keys = Object.keys(input);
    if (keys.length == 0) {
      return [];
    } else {
      const outputs = [];
      // label: [a, b, c] + os: [mac, linux] = label a, os mac, label a, os linux, etc...
      for (const key of keys) {
        if (key == matchKey) {
          const matchObj = input[matchKey];
          if (matchObj !== undefined) {
            const match = parseMatch(matchObj);
            const nestedOutputs = [];
            // Push a set for all cases of this $match, adding a negation for previous cases
            for (const { condition, output } of match.cases) {
              nestedOutputs.push(
                cartesianMerge(flatten(output), [{ [ifSymbol]: condition }]),
              );
            }
            // Finally, push an empty set if all items failed
            nestedOutputs.push([{ [ifSymbol]: match.default }]);
            logDebug("Flattened $match:", input, "->", nestedOutputs);
            outputs.push(nestedOutputs.flat(1));
          } else {
            throw new Error(
              `Unexpected value for '$match': ${friendlyTypeOf(input)} (expected an object)`,
            );
          }
        } else if (key == arrayKey) {
          if (input[arrayKey] !== undefined && isArray(input[arrayKey])) {
            outputs.push(flattenArray(input[arrayKey]));
          } else {
            throw new Error(
              `Unexpected value for '$array': ${friendlyTypeOf(input)} (expected an array)`,
            );
          }
        } else if (key == arraysKey) {
          let value = input[arraysKey];
          if (value !== undefined && !isArray(value)) {
            const objectAsArray = [];
            for (const key of Object.keys(value)) {
              objectAsArray[Number(key)] = value[<`${number}`> key];
            }
            value = objectAsArray;
          }
          if (value !== undefined && isArray(value)) {
            for (const array of value) {
              outputs.push(flattenArray(array));
            }
          } else {
            throw new Error(
              `Unexpected value for '$arrays': ${friendlyTypeOf(input)} (expected an array or an object with numbered keys)`,
            );
          }
        } else if (isRegularKey(key) || key == ifKey) {
          const nested = input[key];
          if (nested === undefined) {
            throw new Error("'undefined' is not a valid value");
          }
          if (typeof nested == "object" && !Array.isArray(nested)) {
            const { match: matchObj, dynamic, value, if: ifValue, regular } =
              splitValueObject<InputObjectValue>(nested);
            const ifParts = ifValue !== undefined
              ? [{ [ifSymbol]: ifValue }]
              : [];
            if (matchObj) {
              const match = parseMatch(matchObj);
              const nestedOutputs = [];
              for (const { condition, output: caseValue } of match.cases) {
                const caseOutputs = isNestedInputObject(caseValue)
                  ? flattenNestedKeyObject(key, caseValue)
                  : flattenWithKeyInput(key, caseValue);
                nestedOutputs.push(
                  cartesianMerge(caseOutputs, [{ [ifSymbol]: condition }], ifParts),
                );
              }
              nestedOutputs.push(cartesianMerge([{ [ifSymbol]: match.default }], ifParts));
              const regularOutputs = Object.keys(regular).map((rKey) =>
                flattenWithKeyInput(rKey, regular[rKey] as NestedInputValue)
              );
              outputs.push(cartesianMerge(nestedOutputs.flat(1), ...regularOutputs));
            } else if (dynamic !== undefined) {
              outputs.push(
                cartesianMerge([{ [key]: { [dynamicKey]: dynamic } }], ifParts),
              );
              for (const rKey of Object.keys(regular)) {
                outputs.push(flattenWithKeyInput(rKey, regular[rKey] as NestedInputValue));
              }
            } else if (value !== undefined) {
              outputs.push(
                cartesianMerge(flattenWithKeyInput(key, value as NestedInputValue), ifParts),
              );
              for (const rKey of Object.keys(regular)) {
                outputs.push(flattenWithKeyInput(rKey, regular[rKey] as NestedInputValue));
              }
            } else {
              outputs.push(
                cartesianMerge(
                  flattenNestedKeyObject(key, regular as NestedInputObject),
                  ifParts,
                ),
              );
            }
          } else if (nested !== undefined) {
            outputs.push(flattenWithKeyInput(key, nested));
          }
        } else {
          throw new Error(`Illegal key: ${key}`);
        }
      }

      return cartesianMerge(...outputs);
    }
  }
  throw new Error(
    `Unexpected type in object context: ${friendlyTypeOf(input)} (expected an object or array of objects)`,
  );
}

function flattenNestedKeyObject(
  key: string,
  input: NestedInputObject,
): OutputRecord[] {
  const outputs = [];

  if (Object.keys(input).length == 0) {
    throw new Error(
      `Object in object value context for '${key}' must have at least one key`,
    );
  }

  for (const nestedKey of Object.keys(input)) {
    if (isSpecialKey(nestedKey)) {
      throw new Error(`Illegal key: ${nestedKey}`);
    }
    const value = input[nestedKey];
    if (value === null) {
      outputs.push([{ [key]: nestedKey }]);
      continue;
    }
    if (!isObject(value)) {
      throw new Error(
        `Unexpected type in object context '${friendlyTypeOf(value)}' (expected an object or array of objects)`,
      );
    }

    const flattened = flatten(value);
    logDebug(
      "Flatten with key:",
      key,
      "=",
      value,
      "->",
      flattened,
    );

    outputs.push(cartesianMerge([{ [key]: nestedKey }], flattened));
  }
  return outputs.flat(1);
}

/**
 * Flatten something in object value context. If the object was, for example,
 * `{ os: [mac, linux] }`, the key would be `os` and the input would be `[mac, linux]`.
 */
function flattenWithKeyInput(
  key: string,
  input: NestedInputValue,
): OutputRecord[] {
  if (typeof input == "string" || typeof input == "boolean") {
    return [{ [key]: input }];
  }

  if (isArray(input)) {
    return input.map((input) => flattenWithKeyInput(key, input)).flat(1);
  }

  if (isObject(input)) {
    const { match, dynamic, value, if: ifValue, regular } =
      splitValueObject<InputValue>(input);

    const ifParts = ifValue !== undefined
      ? [{ [ifSymbol]: ifValue }]
      : [];

    const flattened = Object.keys(regular).flatMap((k) =>
      flattenWithKeyInput(k, regular[k])
    );

    if (match) {
      const outputs = [];
      const ifAccum: string[] = [];
      for (const caseKey of Object.keys(match)) {
        const condition = structuredClone(ifAccum);
        condition.push(caseKey);
        ifAccum.push(`!(${caseKey})`);

        const output = flattenWithKeyInput(key, match[caseKey]);
        outputs.push(
          cartesianMerge(output, flattened, [{ [ifSymbol]: condition }]),
        );
      }
      outputs.push([{ [ifSymbol]: ifAccum }]);
      logDebug("Flattened $match:", input, "->", outputs);
      return cartesianMerge(outputs.flat(1), ifParts);
    }

    if (dynamic !== undefined) {
      if (typeof dynamic !== "string") {
        throw new Error(
          `Unexpected type in $dynamic value context: ${friendlyTypeOf(dynamic)}`,
        );
      }
      return cartesianMerge(
        [{ [key]: { [dynamicKey]: dynamic } }],
        flattened,
        ifParts,
      );
    }

    if (value !== undefined) {
      const output = flattenWithKeyInput(key, value);
      return cartesianMerge(output, flattened, ifParts);
    }

    throw new Error(
      `Unexpected type in object context: '${friendlyTypeOf(input)}' (expected an object or array of objects)`,
    );
  }
  throw new Error(
    `Unexpected type in object value context for key '${key}': ${friendlyTypeOf(input)}`,
  );
}

// deno-lint-ignore no-explicit-any
function filterRecord(config: any, record: OutputRecord): boolean {
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (isDynamicObject(value)) {
      const noValue = Symbol();
      const predicate = value[dynamicKey];
      let cachedValue = noValue;
      let computing = false;
      Object.defineProperty(record, key, {
        get() {
          if (cachedValue === noValue) {
            if (computing) {
              throw new Error(
                `Circular dependency computing property '${key}' for expression '${predicate}'`,
              );
            }
            computing = true;
            try {
              const fn = makeBindingFunction(predicate, record);
              let value = fn(config);
              if (value === "") {
                value = undefined;
              }
              cachedValue = value;
            } finally {
              computing = false;
            }
          }
          return cachedValue;
        },
      });
    }
  }

  const ifValue = record[ifSymbol];
  delete record[ifSymbol];
  if (ifValue !== undefined) {
    for (const predicate of arrayify(ifValue)) {
      // NOTE: This is an `eval` call!
      const fn = makeBindingFunction(predicate, record);
      if (!fn(config)) {
        logDebug(
          "Removing because predicate",
          predicate,
          "failed:",
          record,
        );
        return false;
      }
    }
  }

  if (Object.keys(record).length == 0) {
    return false;
  }

  return true;
}

function makeBindingFunction(predicate: string, record: OutputRecord) {
  const trimmed = predicate.trim();
  if (trimmed.length == 0) {
    throw new Error("Invalid predicate: empty string");
  }
  try {
    return new Function("config", `return (${trimmed})`).bind(record);
  } catch (e) {
    throw new Error(`Invalid predicate: ${trimmed}: ${e}`);
  }
}

function itemShouldMaskPrevious(
  item: OutputRecord,
  previous: OutputRecord,
): "no" | "equal" | "superset" {
  const keys1 = Object.keys(item);
  const keys2 = Object.keys(previous);
  if (keys2.length > keys1.length) {
    return "no";
  }
  for (const key2 of keys2) {
    if (String(item[key2]) !== String(previous[key2])) {
      return "no";
    }
  }
  return keys1.length == keys2.length ? "equal" : "superset";
}

// deno-lint-ignore no-explicit-any
function generateMatrixSync(input: Input, config: any): OutputRecord[] {
  if (!isObject(input) && !isArray(input)) {
    throw new Error("Top-level input must be an array or object");
  }
  const flattened = flatten(input);
  logDetailed("Flattened:", flattened);
  const evaluated = flattened.filter((record) => filterRecord(config, record))
    .map((x) => <OutputRecord> JSON.parse(JSON.stringify(x)));
  logDetailed("Evaluated:", evaluated);

  // This is O(n^2) but hopefully we don't ever hit that complexity. If we do, we'll probably
  // need to use indexes.
  const merged: OutputRecord[] = [];
  outer: for (const item of evaluated) {
    for (let i = 0; i < merged.length; i++) {
      const result = itemShouldMaskPrevious(item, merged[i]);
      if (result == "equal") {
        continue outer;
      }
      if (result == "superset") {
        merged.splice(i, 1);
        i--;
      }
    }
    merged.push(item);
  }

  return merged;
}

// deno-lint-ignore no-explicit-any
export function generateMatrix(input: Input, config: any): OutputRecord[];
// deno-lint-ignore no-explicit-any
export function generateMatrix(input: Input, config: any, resolve: ResolveFunction): OutputRecord[];
// deno-lint-ignore no-explicit-any
export function generateMatrix(input: Input, config: any, resolve: AsyncResolveFunction): Promise<OutputRecord[]>;
// deno-lint-ignore no-explicit-any
export function generateMatrix(input: Input, config: any, resolve?: ResolveFunction | AsyncResolveFunction): OutputRecord[] | Promise<OutputRecord[]> {
  if (!resolve) {
    return generateMatrixSync(input, config);
  }
  const resolved = resolveIncludes(input, resolve, 0);
  if (resolved instanceof Promise) {
    return resolved.then((r: Input) => generateMatrixSync(r, config));
  }
  return generateMatrixSync(resolved, config);
}
