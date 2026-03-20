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
