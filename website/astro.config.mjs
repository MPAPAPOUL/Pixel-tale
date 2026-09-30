import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://pixelfe.fr",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
});
