import { logDebug } from "./log.ts";
import { includeKey } from "./keys.ts";
import { friendlyTypeOf, Input, InputObject } from "./types.ts";

const maxIncludeDepth = 10;

type ResolveResult = { content: unknown; resolve: ResolveFunction };
type AsyncResolveResult = { content: unknown; resolve: AsyncResolveFunction };
type MaybeAsyncResolveResult = { content: unknown; resolve: MaybeAsyncResolveFunction };

type MaybeAsyncResolveFunction = (path: string) => MaybePromise<MaybeAsyncResolveResult>;
export type ResolveFunction = (path: string) => ResolveResult;
export type AsyncResolveFunction = (
  path: string,
) => AsyncResolveResult | Promise<AsyncResolveResult>;

type MaybePromise<T> = T | Promise<T>;

function then<T, U>(
  value: MaybePromise<T>,
  fn: (v: T) => MaybePromise<U>,
): U | Promise<U> {
  if (value instanceof Promise) {
    return value.then(fn);
  }
  return fn(value);
}

function all<T>(values: MaybePromise<T>[]): MaybePromise<T[]> {
  return values.some((r) => r instanceof Promise)
    ? Promise.all(values)
    : values as T[];
}

function map<T, U>(value: MaybePromise<T>[], fn: (v: T) => MaybePromise<U>): MaybePromise<U>[] {
  return value.map((v) => v instanceof Promise
    ? v.then((v) => fn(v))
    : fn(v));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// "Colorless" resolveIncludes: returns sync if resolve is sync, Promise if resolve is async
export function resolveIncludes(input: unknown, resolve: ResolveFunction, depth: number): Input;
export function resolveIncludes(input: unknown, resolve: AsyncResolveFunction, depth: number): Promise<Input>;
export function resolveIncludes(input: unknown, resolve: (path: string) => MaybePromise<Input>, depth: number): MaybePromise<Input>;
export function resolveIncludes(
  input: unknown,
  resolveFn: ResolveFunction | AsyncResolveFunction | ((path: string) => MaybePromise<Input>),
  depth: number,
): Input | Promise<Input> {
  const resolve = resolveFn as unknown as MaybeAsyncResolveFunction;
  if (depth > maxIncludeDepth) {
    throw new Error(`$include depth exceeded ${maxIncludeDepth} levels`);
  }
  if (Array.isArray(input)) {
    const results = map<unknown, Input>(input, (item) =>
      resolveIncludes(item, resolve, depth)
    );
    return all<Input>(results);
  }
  if (isObject(input)) {
    if (includeKey in input) {
      const includePath = input[includeKey];
      delete input[includeKey];
      if (typeof includePath !== "string") {
        throw new Error(
          `$include value must be a string, got ${friendlyTypeOf(includePath)}`,
        );
      }
      const hasSiblings = Object.keys(input).length > 0;
      logDebug("$include:", includePath);
      return then<MaybeAsyncResolveResult, Input>(
        resolve(includePath),
        ({ content, resolve }) => {
          logDebug("$include resolved:", includePath, "->", content);
          if (!isObject(content)) {
            if (hasSiblings) {
              throw new Error(
                `$include resolved to ${friendlyTypeOf(content)} but has sibling keys`,
              );
            }
            // Re-resolve this value, just in case it was an array
            return resolveIncludes(content, resolve, depth + 1);
          }
          for (const key of Object.keys(content)) {
            if (key in input) {
              throw new Error(
                `$include resolved object has duplicate key '${key}'`,
              );
            }
          }
          // Re-resolve this object and sibling keys
          return resolveIncludes({
            ...content,
            ...input,
          }, resolve, depth + 1);
        },
      );
    }
    const entries = Object.entries(input);
    const values = map(entries, ([, value]) =>
      resolveIncludes(value, resolve, depth)
    );
    return then(all<Input>(values), (resolvedValues) => {
      const result: Record<string, unknown> = {};
      entries.forEach(([key], i) => {
        result[key] = resolvedValues[i];
      });
      return result as Input;
    });
  }
  return input as InputObject;
}
