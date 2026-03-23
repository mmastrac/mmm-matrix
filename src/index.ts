/// Public API for the mmm-matrix library.
export { generateMatrix, indexMatrix } from "./matrix.ts";
export { parseYaml, parseJsonc } from "./parse.ts";
export type {
  Input,
  InputObject,
  OutputRecord,
  OutputValue,
  IfValue,
} from "./types.ts";
export type {
  ResolveFunction,
  AsyncResolveFunction,
} from "./normalize.ts";
