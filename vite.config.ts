import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    nitro(),
    tsConfigPaths(),
    tanstackStart(),
    react(),
  ],
  nitro: {
    preset: "aws-lambda",
  },
});