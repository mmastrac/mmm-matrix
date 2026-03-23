import { generateNormalizedMatrix } from "./generate.ts";
import { AsyncResolveFunction, ResolveFunction, resolveIncludes } from "./normalize.ts";
import { Input, OutputRecord } from "./types.ts";

export function generateMatrix(input: Input, config: unknown): OutputRecord[];
export function generateMatrix(input: Input, config: unknown, resolve: ResolveFunction): OutputRecord[];
export function generateMatrix(input: Input, config: unknown, resolve: AsyncResolveFunction): Promise<OutputRecord[]>;
export function generateMatrix(input: Input, config: unknown, resolve?: ResolveFunction | AsyncResolveFunction): OutputRecord[] | Promise<OutputRecord[]> {
  if (!resolve) {
    return generateNormalizedMatrix(input, config);
  }
  const resolved = resolveIncludes(input, resolve, 0);
  if (resolved instanceof Promise) {
    return resolved.then((r: Input) => generateNormalizedMatrix(r, config));
  }
  return generateNormalizedMatrix(resolved, config);
}

export function indexMatrix(
  output: OutputRecord[],
  keys: string[],
): Record<string, Record<string, OutputRecord>> {
  const result: Record<string, Record<string, OutputRecord>> = {};
  for (const key of keys) {
    const dict: Record<string, OutputRecord> = {};
    for (const item of output) {
      const value = item[key];
      if (value === undefined) {
        throw new Error(`Index key '${key}' is missing from matrix item: ${JSON.stringify(item)}`);
      }
      const strValue = String(value);
      if (strValue in dict) {
        throw new Error(`Duplicate value '${strValue}' for index key '${key}'`);
      }
      dict[strValue] = item;
    }
    result[key] = dict;
  }
  return result;
}
