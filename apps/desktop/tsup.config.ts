import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/main/index.ts",
    preload: "src/main/preload.ts",
  },
  clean: true,
  external: ["electron"],
  noExternal: [/^@localhub\//],
  format: ["cjs"],
  outDir: "dist-electron",
  target: "es2022",
  sourcemap: false,
});
