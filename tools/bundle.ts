import * as esbuild from "https://deno.land/x/esbuild@v0.19.11/mod.js";
import { denoPlugins } from "https://deno.land/x/esbuild_deno_loader@0.9.0/mod.ts";

const nodePlugin = {
  name: "node",
  // deno-lint-ignore no-explicit-any
  setup(build: any) {
    build.onResolve({ filter: /^node:/ }, (args: { path: string }) => {
      return { path: args.path.slice(5), external: true };
    });
  },
};

const result = await esbuild.build({
  plugins: [nodePlugin, ...denoPlugins()],
  entryPoints: ["src/main.ts"],
  outfile: "dist/action.js",
  platform: "node",
  bundle: true,
  format: "cjs",
});

if (result.errors.length || result.warnings.length) {
  console.error(result);
  Deno.exit(1);
}

esbuild.stop();
console.log("Success.");
