export enum Verbosity {
  Normal,
  Detailed,
  Debugging,
}

let verbosity = Verbosity.Normal;

export function setVerbosity(verbosity_: Verbosity) {
  verbosity = verbosity_;
}

export function isDetailed(): boolean {
  return verbosity >= Verbosity.Detailed;
}

export function isDebugging(): boolean {
  return verbosity >= Verbosity.Debugging;
}

export function logDetailed(...args: unknown[]) {
  if (isDetailed()) console.info(...args);
}

export function logInfo(...args: unknown[]) {
  // `Normal` is the default level, so this is effectively "always log".
  if (verbosity >= Verbosity.Normal) console.info(...args);
}

export function logDebug(...args: unknown[]) {
  if (isDebugging()) console.debug(...args);
}

export function logError(...args: unknown[]) {
  console.error(...args);
}

export function logWarn(...args: unknown[]) {
  console.warn(...args);
}

