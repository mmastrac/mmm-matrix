const ifKey = "$if";
const matchKey = "$match";
const valueKey = "$value";
const dynamicKey = "$dynamic";
const arrayKey = "$array";
const arraysKey = "$arrays";

// Workaround for https://github.com/microsoft/TypeScript/issues/17867
// deno-lint-ignore no-explicit-any
const ifSymbol: unique symbol = ifKey as any;

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
type InputObject = { [key: string]: InputRecord } & {
  [arrayKey]?: InputRecord[];
  [arraysKey]?: InputRecord[][] | { [key: string]: InputRecord[] };
};
type InputValue = { [valueKey]: string | boolean } | { [dynamicKey]: string };

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

function isArray(input: InputRecord): input is InputRecord[] {
  return Array.isArray(input);
}

function isObject(input: InputRecord): input is InputObject {
  return input !== null && input !== undefined && typeof input == "object";
}

function isDynamicObject(
  input: InputRecord,
): input is { [dynamicKey]: string } {
  return input !== null && input !== undefined && typeof input == "object" &&
    dynamicKey in input;
}

function isArraysObject(
  input: InputRecord,
): input is { [key: string]: InputRecord[] } {
  return input !== null && input !== undefined && typeof input == "object";
}

function isMatchObject(
  input: InputRecord,
): input is { [key: string]: InputRecord | InputRecord[] } {
  return input !== null && input !== undefined && typeof input == "object";
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
    const ifStatement = removeKey(partial, ifKey);
    output = { ...output, ...partial };
    mergeIf(output, ifStatement);
    partial[ifKey] = ifStatement;
  }
  return output;
}

function cartesianMerge(...partials: OutputRecord[][]): OutputRecord[] {
  return cartesian(...partials).map(merge);
}

// deno-lint-ignore no-explicit-any
function removeKey(object: Record<string, any>, key: string): any {
  const value = object[key];
  delete object[key];
  return value;
}

/**
 * This can be:
 *
 *  - an array, in which we recursively flatten
 *  - an object, in which we extract the keys and then flattenWithKeyInput.
 */
function flatten(input: InputRecord): OutputRecord[] {
  if (isArray(input)) {
    const flattened = input.flatMap(flatten);
    if (verbosity == Verbosity.Debugging) {
      console.debug("Flatten array:", input, "->", flattened);
    }
    return flattened;
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
          if (isMatchObject(matchObj)) {
            const keys = Object.keys(matchObj);
            const ifAccum = [];
            const nestedOutputs: OutputRecord[][] = [];
            // Push a set for all cases of this $match, adding a negation for previous cases
            for (const key of keys) {
              const condition = structuredClone(ifAccum);
              condition.push(key);
              ifAccum.push(`!(${key})`);
              const caseObj = flatten(matchObj[key]);
              nestedOutputs.push(
                cartesianMerge(caseObj, [{ [ifSymbol]: condition }]),
              );
            }
            // Finally, push an empty set if all items failed
            nestedOutputs.push([{ [ifSymbol]: ifAccum }]);
            outputs.push(nestedOutputs.flat(1));
          } else {
            throw new Error(
              `Unexpected value for '$match': ${typeof input} (expected an object)`,
            );
          }
        } else if (key == arrayKey) {
          if (input[arrayKey] !== undefined && isArray(input[arrayKey])) {
            const nestedOutputs = [];
            for (const value of input[arrayKey]) {
              nestedOutputs.push(flatten(value));
            }
            outputs.push(nestedOutputs.flat(1));
          } else {
            throw new Error(
              `Unexpected value for '$array': ${typeof input} (expected an array)`,
            );
          }
        } else if (key == arraysKey) {
          let value = input[arraysKey];
          if (value !== undefined && isArraysObject(value)) {
            const objectAsArray = [];
            for (const key of Object.keys(value)) {
              objectAsArray[Number(key)] = value[key];
            }
            value = objectAsArray;
          }
          if (value !== undefined && isArray(value)) {
            for (const array of value) {
              const nestedOutputs = [];
              for (const value of array) {
                nestedOutputs.push(flatten(value));
              }
              outputs.push(nestedOutputs.flat(1));
            }
          } else {
            throw new Error(
              `Unexpected value for '$arrays': ${typeof input} (expected an array or an object with numbered keys)`,
            );
          }
        } else {
          const flattened = flattenWithKeyInput(key, input[key]);
          if (verbosity == Verbosity.Debugging) {
            console.debug(
              "Flatten with key:",
              key,
              "=",
              input[key],
              "->",
              flattened,
            );
          }
          outputs.push(flattened);
        }
      }

      return cartesianMerge(...outputs);
    }
  }
  throw new Error(
    `Unexpected type in object context: ${typeof input} (expected an object or array of objects)`,
  );
}

function flattenWithKeyInput(
  key: Exclude<string, typeof ifKey>,
  input: InputRecord,
): OutputRecord[] {
  if (typeof input == "string" || typeof input == "boolean") {
    return [{ [key]: input }];
  }

  if (isArray(input)) {
    return input.map((input) => flattenWithKeyInput(key, input)).flat(1);
  }

  const outputs = [];

  if (isObject(input)) {
    const matchValue = removeKey(input, matchKey);
    if (matchValue !== undefined) {
      const flattened = flatten(input);
      if (isMatchObject(matchValue)) {
        const ifAccum = [];
        const nestedOutputs: OutputRecord[][] = [];
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
        nestedOutputs.push([{ [ifSymbol]: ifAccum }]);
      } else {
        throw new Error(
          `Unexpected value for '$match': ${typeof input} (expected an object)`,
        );
      }
      return outputs.flat(1);
    }

    const dynamicValue = removeKey(input, dynamicKey);
    if (dynamicValue !== undefined) {
      if (typeof dynamicValue == "string") {
        if (Object.keys(input).length == 0) {
          return [{ [key]: { [dynamicKey]: dynamicValue } }];
        }
        const output = flattenWithKeyInput(key, { [dynamicKey]: dynamicValue });
        return cartesianMerge(output, flatten(input));
      } else {
        throw new Error(
          `Unexpected type in $dynamic value context: ${typeof input}`,
        );
      }
    }

    const valueValue = removeKey(input, valueKey);
    if (valueValue !== undefined) {
      const output = flattenWithKeyInput(key, valueValue);
      return cartesianMerge(output, flatten(input));
    }

    for (const nestedValue of Object.keys(input)) {
      const value: OutputRecord = { [key]: nestedValue };
      outputs.push(cartesianMerge([value], flatten(input[nestedValue])));
    }
    if (outputs.length == 0) {
      throw new Error(
        `Object in object value context for '${key}' must have at least one key`,
      );
    }
    return outputs.flat(1);
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

  const ifValue = removeKey(record, ifKey);
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
