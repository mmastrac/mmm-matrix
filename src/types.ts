import {
  arrayKey,
  arraysKey,
  dynamicKey,
  ifKey,
  ifSymbol,
  matchKey,
  valueKey,
} from "./keys.ts";

export type OutputValue = string | boolean | { [dynamicKey]: string };
export type IfValue = string | string[];
export type OutputRecord = { [key: string]: OutputValue; [ifSymbol]?: IfValue };

// The top-level object
export type Input = Input[] | InputObject;

export type InputObject = {
  [key: RegularKey]: InputObjectValue | {
    [matchKey]: MatchObject<InputObjectValue>;
    [ifKey]?: IfValue;
  };
  [ifKey]?: string;
  [arrayKey]?: Input[] | { [key: `${number}`]: Input };
  [arraysKey]?: Input[][] | { [key: `${number}`]: Input[] };
  [matchKey]?: MatchObject<Input>;
};

export type InputObjectValue = InputValue | NestedInputObject | {
  [dynamicKey]: string;
};

// eg: the "mac: ..." in label: mac: os: osx
export type NestedInputObject = { [key: string]: Input };

export function isNestedInputObject(
  input: InputObjectValue,
): input is NestedInputObject {
  return typeof input === "object" && !Array.isArray(input) &&
    !(dynamicKey in input);
}

export type InputValue = string | boolean | InputValue[];
export type NestedInputValue = InputValue | InputValueObject;

export type InputValueObject =
  & { [key: RegularKey]: InputValue; [ifKey]?: IfValue }
  & (
    | { [matchKey]?: MatchObject<InputValue> }
    | { [valueKey]?: InputValue }
    | { [dynamicKey]?: string }
    | Record<string, never>
  );
export type MatchObject<T> = { [key: string]: T };

export type Letter =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z"
  | "_"
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";
export type RegularKey = `${Letter}${string}`;

export function isRegularKey(key: string): key is RegularKey {
  return LETTER_REGEXP.test(key[0]);
}
const LETTER_REGEXP = /[a-zA-Z0-9_]/;

export function isSpecialKey(key: string): boolean {
  return key.startsWith("$");
}

export function friendlyTypeOf(input: unknown): string {
  if (input === null) return "null";
  if (input === undefined) return "undefined";
  if (Array.isArray(input)) return "array";
  return typeof input;
}

export function isArray<T>(input: T[] | object): input is T[] {
  return Array.isArray(input);
}

export function isObject(input: unknown): input is object {
  return typeof input == "object" && input !== null && !Array.isArray(input);
}
