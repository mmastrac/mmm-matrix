import { isRegularKey } from "./types.ts";
import { RegularKey } from "./types.ts";

const ifKey = "$if";
const matchKey = "$match";
const valueKey = "$value";
const dynamicKey = "$dynamic";
const arrayKey = "$array";
const arraysKey = "$arrays";

// Workaround for https://github.com/microsoft/TypeScript/issues/17867
// deno-lint-ignore no-explicit-any
const ifSymbol: unique symbol = ifKey as any;
// deno-lint-ignore no-explicit-any
const matchSymbol: unique symbol = matchKey as any;
// deno-lint-ignore no-explicit-any
const valueSymbol: unique symbol = valueKey as any;
// deno-lint-ignore no-explicit-any
const dynamicSymbol: unique symbol = dynamicKey as any;
// deno-lint-ignore no-explicit-any
const arraySymbol: unique symbol = arrayKey as any;
// deno-lint-ignore no-explicit-any
const arraysSymbol: unique symbol = arraysKey as any;

export enum Verbosity {
  Normal,
  Detailed,
  Debugging,
}

let verbosity = Verbosity.Normal;

type OutputValue = string | boolean | { [dynamicKey]: string };
type IfValue = string | string[];
type OutputRecord = { [key: string]: OutputValue; [ifSymbol]?: IfValue };

// deno-lint-ignore no-explicit-any
type InputRecord = boolean | string | any[] | InputObject;

// The top-level object
type Input = Input[] | InputObject;

type InputObject = {
  [key: RegularKey]: InputObjectValue | {
    [matchKey]: MatchObject<InputObjectValue>;
  };
  [ifKey]?: string;
  [arrayKey]?: Input[] | { [key: `${number}`]: Input };
  [arraysKey]?: Input[] | { [key: `${number}`]: Input };
  [matchKey]?: MatchObject<Input>;
};

type InputObjectValue = InputValue | NestedInputObject | {
  [dynamicKey]: string;
};

// eg: the "mac: ..." in label: mac: os: osx
type NestedInputObject = { [key: RegularKey]: Input };

type InputValue = string | boolean | InputValue[];
type NestedInputValue = InputValue | InputValueObject;

type InputValueObject =
  & { [key: RegularKey]: InputValue }
  & (
    | { [matchKey]: MatchObject<InputValue> }
    | { [valueKey]: InputValue }
    | { [dynamicKey]: string }
    | Record<symbol, never>
  );
type MatchObject<T> = { [key: string]: T };

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

function isObject<T, U>(input: T | U[]): input is T {
  return input !== null && input !== undefined && typeof input == "object";
}

function isNonNull<T>(input: T | undefined): input is T {
  return input !== null && input !== undefined && typeof input == "object";
}

function isDynamicObject(
  input: InputRecord,
): input is { [dynamicKey]: string } {
  return input !== null && input !== undefined && typeof input == "object" &&
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
  if (verbosity == Verbosity.Debugging) {
    input = structuredClone(partials);
  }

  const nonEmptyPartials = partials.filter((partial) => partial.length > 0);
  const output = cartesian(...nonEmptyPartials).map(merge);
  if (verbosity == Verbosity.Debugging) {
    console.debug("Merge:", input, "->", output);
  }

  return output;
}

/**
 * Flatten an array recursively, filtering out any empty items or items
 * that consist of nothing but an `if` key.
 */
function flattenArray(input: Input[]): OutputRecord[] {
  const flattened = input.flatMap(flatten);
  if (verbosity == Verbosity.Debugging) {
    console.debug("Flatten array:", input, "->", flattened);
  }
  return flattened.filter((item) => {
    const keys = Object.keys(item);
    if (keys.length == 0) {
      if (verbosity == Verbosity.Debugging) {
        console.debug("Removing item with no content", item);
      }
      return false;
    }
    if (keys.length == 1 && keys[0] == ifKey) {
      if (verbosity == Verbosity.Debugging) {
        console.debug("Removing item with no content", item);
      }
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
          if (isNonNull(matchObj)) {
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
            if (verbosity == Verbosity.Debugging) {
              console.debug("Flattened $match:", input, "->", nestedOutputs);
            }
            outputs.push(nestedOutputs.flat(1));
          } else {
            throw new Error(
              `Unexpected value for '$match': ${typeof input} (expected an object)`,
            );
          }
        } else if (key == arrayKey) {
          if (input[arrayKey] !== undefined && isArray(input[arrayKey])) {
            outputs.push(flattenArray(input[arrayKey]));
          } else {
            throw new Error(
              `Unexpected value for '$array': ${typeof input} (expected an array)`,
            );
          }
        } else if (key == arraysKey) {
          let value = input[arraysKey];
          if (isNonNull(value) && !isArray(value)) {
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
              `Unexpected value for '$arrays': ${typeof input} (expected an array or an object with numbered keys)`,
            );
          }
        } else if (isRegularKey(key) || key == ifKey) {
          const nested = input[key];
          if (nested === undefined) {
            throw new Error("'undefined' is not a valid value");
          }
          if (typeof nested == "object" && matchKey in nested) {
            const match = parseMatch(nested);
          } else {
            if (
              typeof nested == "object" &&
              (dynamicSymbol in nested || matchKey in nested)
            ) {
              outputs.push(flattenWithKeyInput(key, nested));
            } else if (typeof nested == "object" && !Array.isArray(nested)) {
              outputs.push(flattenNestedKeyObject(key, nested));
            } else if (nested !== undefined) {
              outputs.push(flattenWithKeyInput(key, nested));
            }
          }
        } else {
          throw new Error(`Illegal key: ${key}`);
        }
      }

      return cartesianMerge(...outputs);
    }
  }
  throw new Error(
    `Unexpected type in object context: ${typeof input} (expected an object or array of objects)`,
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
    if (!isRegularKey(nestedKey)) {
      throw new Error(`Illegal key: ${key}`);
    }
    const value = input[nestedKey];
    if (!isObject(value)) {
      throw new Error(
        `Unexpected type in object context '${typeof value}' (expected an object or array of objects)`,
      );
    }

    const flattened = flatten(value);
    if (verbosity == Verbosity.Debugging) {
      console.debug(
        "Flatten with key:",
        key,
        "=",
        value,
        "->",
        flattened,
      );
    }

    outputs.push(cartesianMerge([{ [key]: nestedKey }], flattened));
  }
  return outputs.flat(1);
}

/**
 * Flatten something in object value context. If the object was, for example,
 * `{ os: [mac, linux] }`, the key would be `os` and the input would be `[mac, linux]`.
 */
function flattenWithKeyInput(
  key: Exclude<string, typeof ifKey>,
  input: NestedInputValue,
): OutputRecord[] {
  if (typeof input == "string" || typeof input == "boolean") {
    return [{ [key]: input }];
  }

  if (isArray(input)) {
    return input.map((input) => flattenWithKeyInput(key, input)).flat(1);
  }

  if (isObject(input)) {
    // This can be:
    //  - { $match: ..., ...other }
    //  - { $value: ..., ...other }
    //  - { $dynamic: ..., ...other }
    let matchValue;
    if (matchSymbol in input) {
      matchValue = input[matchSymbol];
      delete input[matchSymbol];
    }
    let dynamicValue;
    if (dynamicSymbol in input) {
      dynamicValue = input[dynamicSymbol];
      delete input[dynamicSymbol];
    }
    let valueValue;
    if (valueSymbol in input) {
      valueValue = input[valueSymbol];
      delete input[valueSymbol];
    }

    if (matchValue) {
      const outputs = [];
      for (const nestedKey of Object.keys(input)) {
        outputs.push(flattenWithKeyInput(nestedKey, input[nestedKey]));
      }
      const flattened = outputs.flat(1);

      if (isNonNull(matchValue)) {
        const ifAccum = [];
        // Push a set for all cases of this $match, adding a negation for previous cases
        for (const caseKey of Object.keys(matchValue)) {
          const condition = structuredClone(ifAccum);
          condition.push(caseKey);
          ifAccum.push(`!(${caseKey})`);

          const output = flattenWithKeyInput(key, matchValue[caseKey]);
          outputs.push(
            cartesianMerge(output, flattened, [{ [ifSymbol]: condition }]),
          );
        }
        // Finally, push an empty set if all items failed
        outputs.push([{ [ifSymbol]: ifAccum }]);
        if (verbosity == Verbosity.Debugging) {
          console.debug("Flattened $match:", input, "->", outputs);
        }
        return outputs.flat(1);
      } else {
        throw new Error(
          `Unexpected value for '$match': ${typeof input} (expected an object)`,
        );
      }
    }

    if (dynamicValue) {
      const outputs = [];
      for (const nestedKey of Object.keys(input)) {
        outputs.push(flattenWithKeyInput(nestedKey, input[nestedKey]));
      }
      const flattened = outputs.flat(1);

      if (dynamicValue !== undefined) {
        if (typeof dynamicValue == "string") {
          if (Object.keys(input).length == 0) {
            return [{ [key]: { [dynamicKey]: dynamicValue } }];
          }
          const output = flattenWithKeyInput(key, {
            [dynamicKey]: dynamicValue,
          });
          return cartesianMerge(output, flattened);
        } else {
          throw new Error(
            `Unexpected type in $dynamic value context: ${typeof input}`,
          );
        }
      }
    }

    if (valueValue) {
      const outputs = [];
      for (const nestedKey of Object.keys(input)) {
        outputs.push(flattenWithKeyInput(nestedKey, input[nestedKey]));
      }
      const flattened = outputs.flat(1);

      if (valueValue !== undefined) {
        const output = flattenWithKeyInput(key, valueValue);
        return cartesianMerge(output, flattened);
      }
    }
    throw new Error(
      `Unexpected type in object context: '${typeof input}' (expected an object or array of objects)`,
    );
  }
  throw new Error(
    `Unexpected type in object value context for key '${key}': ${typeof input}`,
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
        if (verbosity >= Verbosity.Debugging) {
          console.debug(
            "Removing because predicate",
            predicate,
            "failed:",
            record,
          );
        }
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
export function generateMatrix(input: any, config: any): OutputRecord[] {
  if (!isObject(input) && !isArray(input)) {
    throw new Error("Top-level input must be an array or object");
  }
  const flattened = flatten(input);
  if (verbosity >= Verbosity.Detailed) {
    console.info("Flattened:", flattened);
  }
  const evaluated = flattened.filter((record) => filterRecord(config, record))
    .map((x) => <OutputRecord> JSON.parse(JSON.stringify(x)));
  if (verbosity >= Verbosity.Detailed) {
    console.info("Evaluated:", evaluated);
  }

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

export function setVerbosity(verbosity_: Verbosity) {
  verbosity = verbosity_;
}
