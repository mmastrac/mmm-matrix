export const ifKey = "$if";
export const matchKey = "$match";
export const valueKey = "$value";
export const dynamicKey = "$dynamic";
export const arrayKey = "$array";
export const arraysKey = "$arrays";
export const rangeKey = "$range";
export const includeKey = "$include";

// Workaround for https://github.com/microsoft/TypeScript/issues/17867
// OutputRecord needs [key: string] + a differently-typed $if property,
// which TS doesn't allow with string keys. A unique symbol sidesteps this.
// deno-lint-ignore no-explicit-any
export const ifSymbol: unique symbol = ifKey as any;
