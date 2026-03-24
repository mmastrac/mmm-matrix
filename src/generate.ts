import {
  arrayKey,
  arraysKey,
  dynamicKey,
  ifKey,
  ifSymbol,
  matchKey,
  rangeKey,
  valueKey,
} from "./keys.ts";
import {
  friendlyTypeOf,
  IfValue,
  Input,
  InputObjectValue,
  InputValue,
  isArray,
  isNestedInputObject,
  isObject,
  isRegularKey,
  isSpecialKey,
  MatchObject,
  NestedInputObject,
  NestedInputValue,
  OutputRecord,
  RangeValue,
} from "./types.ts";
import { isDebugging, logDebug, logDetailed } from "./log.ts";

const MAX_RANGE_LENGTH = 1000;

function expandRange(input: RangeValue): number[] {
  let start: number, stop: number, step: number;

  if (isArray(input)) {
    const arr = input as number[];
    if (arr.length === 1) {
      [stop] = arr;
      start = 0;
      step = 1;
    } else if (arr.length === 2) {
      [start, stop] = arr;
      step = 1;
    } else if (arr.length === 3) {
      [start, stop, step] = arr;
    } else {
      throw new Error(
        `$range array must have 1 to 3 elements, got ${arr.length}`,
      );
    }
    for (const v of arr) {
      if (typeof v !== "number") {
        throw new Error(
          `$range values must be numbers, got ${friendlyTypeOf(v)}`,
        );
      }
    }
  } else if (isObject(input)) {
    const obj = input as Record<string, unknown>;
    if (!("stop" in obj) || typeof obj.stop !== "number") {
      throw new Error("$range object requires a numeric 'stop' property");
    }
    stop = obj.stop;
    start = typeof obj.start === "number" ? obj.start : 0;
    step = typeof obj.step === "number" ? obj.step : 1;
  } else {
    throw new Error(
      `$range value must be an array or object, got ${friendlyTypeOf(input)}`,
    );
  }

  if (step === 0) {
    throw new Error("$range step must not be zero");
  }

  if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) {
    throw new Error(
      `$range would produce no values (start=${start}, stop=${stop}, step=${step})`,
    );
  }

  const length = Math.ceil((stop - start) / step);
  if (length > MAX_RANGE_LENGTH) {
    throw new Error(
      `$range would produce ${length} values, which exceeds the maximum of ${MAX_RANGE_LENGTH}`,
    );
  }

  const result: number[] = [];
  if (step > 0) {
    for (let i = start; i < stop; i += step) {
      result.push(i);
    }
  } else {
    for (let i = start; i > stop; i += step) {
      result.push(i);
    }
  }
  return result;
}

type SplitValueObject<T = unknown> = {
  match?: MatchObject<T>;
  dynamic?: string;
  value?: T;
  range?: RangeValue;
  if?: IfValue;
  regular: { [key: string]: T };
};

function splitValueObject<T>(input: object): SplitValueObject<T> {
  const result: SplitValueObject<T> = { regular: {} };
  for (const [key, val] of Object.entries(input)) {
    if (key === matchKey) result.match = val;
    else if (key === dynamicKey) result.dynamic = val;
    else if (key === valueKey) result.value = val;
    else if (key === rangeKey) result.range = val;
    else if (key === ifKey) result.if = val;
    else result.regular[key] = val;
  }
  const specials = [
    result.match !== undefined && matchKey,
    result.dynamic !== undefined && dynamicKey,
    result.value !== undefined && valueKey,
    result.range !== undefined && rangeKey,
  ].filter(Boolean);
  if (specials.length > 1) {
    throw new Error(
      `${specials.join(", ")} cannot be combined in the same object`,
    );
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
    if (valueKey in input || dynamicKey in input || rangeKey in input) {
      throw new Error("Illegal $value, $dynamic, or $range key in object context");
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
              `Unexpected value for '$match': ${
                friendlyTypeOf(input)
              } (expected an object)`,
            );
          }
        } else if (key == arrayKey) {
          if (input[arrayKey] !== undefined && isArray(input[arrayKey])) {
            outputs.push(flattenArray(input[arrayKey]));
          } else {
            throw new Error(
              `Unexpected value for '$array': ${
                friendlyTypeOf(input)
              } (expected an array)`,
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
              `Unexpected value for '$arrays': ${
                friendlyTypeOf(input)
              } (expected an array or an object with numbered keys)`,
            );
          }
        } else if (isRegularKey(key) || key == ifKey) {
          const nested = input[key];
          if (nested === undefined) {
            throw new Error("'undefined' is not a valid value");
          }
          if (typeof nested == "object" && !Array.isArray(nested)) {
            const { match: matchObj, dynamic, value, range, if: ifValue, regular } =
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
                  cartesianMerge(
                    caseOutputs,
                    [{ [ifSymbol]: condition }],
                    ifParts,
                  ),
                );
              }
              nestedOutputs.push(
                cartesianMerge([{ [ifSymbol]: match.default }], ifParts),
              );
              const regularOutputs = Object.keys(regular).map((rKey) =>
                flattenWithKeyInput(rKey, regular[rKey] as NestedInputValue)
              );
              outputs.push(
                cartesianMerge(nestedOutputs.flat(1), ...regularOutputs),
              );
            } else if (dynamic !== undefined) {
              outputs.push(
                cartesianMerge([{ [key]: { [dynamicKey]: dynamic } }], ifParts),
              );
              for (const rKey of Object.keys(regular)) {
                outputs.push(
                  flattenWithKeyInput(rKey, regular[rKey] as NestedInputValue),
                );
              }
            } else if (range !== undefined) {
              const expanded = expandRange(range);
              outputs.push(
                cartesianMerge(
                  expanded.map((v) => ({ [key]: v })),
                  ifParts,
                ),
              );
              for (const rKey of Object.keys(regular)) {
                outputs.push(
                  flattenWithKeyInput(rKey, regular[rKey] as NestedInputValue),
                );
              }
            } else if (value !== undefined) {
              outputs.push(
                cartesianMerge(
                  flattenWithKeyInput(key, value as NestedInputValue),
                  ifParts,
                ),
              );
              for (const rKey of Object.keys(regular)) {
                outputs.push(
                  flattenWithKeyInput(rKey, regular[rKey] as NestedInputValue),
                );
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
    `Unexpected type in object context: ${
      friendlyTypeOf(input)
    } (expected an object or array of objects)`,
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
        `Unexpected type in object context '${
          friendlyTypeOf(value)
        }' (expected an object or array of objects)`,
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
  if (typeof input == "string" || typeof input == "boolean" || typeof input == "number") {
    return [{ [key]: input }];
  }

  if (isArray(input)) {
    return input.map((input) => flattenWithKeyInput(key, input)).flat(1);
  }

  if (isObject(input)) {
    const { match, dynamic, value, range, if: ifValue, regular } = splitValueObject<
      InputValue
    >(input);

    const ifParts = ifValue !== undefined ? [{ [ifSymbol]: ifValue }] : [];

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
          `Unexpected type in $dynamic value context: ${
            friendlyTypeOf(dynamic)
          }`,
        );
      }
      return cartesianMerge(
        [{ [key]: { [dynamicKey]: dynamic } }],
        flattened,
        ifParts,
      );
    }

    if (range !== undefined) {
      const expanded = expandRange(range);
      return cartesianMerge(
        expanded.map((v) => ({ [key]: v })),
        flattened,
        ifParts,
      );
    }

    if (value !== undefined) {
      const output = flattenWithKeyInput(key, value);
      return cartesianMerge(output, flattened, ifParts);
    }

    throw new Error(
      `Unexpected type in object context: '${
        friendlyTypeOf(input)
      }' (expected an object or array of objects)`,
    );
  }
  throw new Error(
    `Unexpected type in object value context for key '${key}': ${
      friendlyTypeOf(input)
    }`,
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
export function generateNormalizedMatrix(
  input: Input,
  config: any,
): OutputRecord[] {
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
