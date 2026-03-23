import * as esbuild from "https://deno.land/x/esbuild@v0.19.11/mod.js";
import { denoPlugins } from "https://deno.land/x/esbuild_deno_loader@0.9.0/mod.ts";
import { logError, logInfo } from "../src/log.ts";

const nodePlugin = {
  name: "node",
  // deno-lint-ignore no-explicit-any
  setup(build: any) {
    build.onResolve({ filter: /^node:/ }, (args: { path: string }) => {
      return { path: args.path.slice(5), external: true };
    });
  },
};

const plugins = [nodePlugin, ...denoPlugins()];

const shared = {
  platform: "node" as const,
  bundle: true,
  format: "cjs" as const,
  mainFields: ["module", "main"],
};

const actionResult = await esbuild.build({
  plugins,
  entryPoints: ["src/main.ts"],
  outfile: "dist/action.js",
  ...shared,
});

if (actionResult.errors.length || actionResult.warnings.length) {
  logError(actionResult);
  Deno.exit(1);
}

const libResult = await esbuild.build({
  plugins,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.cjs",
  ...shared,
});

if (libResult.errors.length || libResult.warnings.length) {
  logError(libResult);
  Deno.exit(1);
}

const cliResult = await esbuild.build({
  plugins,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.cjs",
  ...shared,
  banner: { js: "#!/usr/bin/env node" },
});

if (cliResult.errors.length || cliResult.warnings.length) {
  logError(cliResult);
  Deno.exit(1);
}

esbuild.stop();
logInfo("Success.");
