import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tanstackStart({
      target: "aws-lambda",
      server: { entry: "src/server.ts" },
    }),
    tsConfigPaths(),
  ],
});