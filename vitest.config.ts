import { defineConfig } from "vitest/config";
import { defineProjects } from "./vitest.workspace.js";

export default defineConfig({
  test: {
    projects: defineProjects(),
  },
});
