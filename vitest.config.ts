import { readdirSync } from "node:fs"
import { basename, resolve } from "node:path"
import { defineConfig } from "vitest/config"

// One Vitest setup for the whole workspace. Projects are derived from the
// workspace layout: every app and package is a project with the same include
// pattern, so tests live next to the code they protect. The web project keeps
// a node environment for API/route tests; browser-facing component tests can
// add a jsdom project when they arrive.
const projectDirs = [
  ...readdirSync("apps", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `apps/${entry.name}`),
  ...readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`),
]

const projects = projectDirs.map((root) => ({
  resolve:
    root === "apps/web"
      ? // Mirror apps/web tsconfig "@/*" -> "./src/*" and neutralize the
        // server-only guard package outside React Server Components.
        {
          alias: {
            "@": resolve("apps/web/src"),
            "server-only": resolve("apps/web/test/server-only-stub.js"),
          },
        }
      : undefined,
  test: {
    name: basename(root),
    root: resolve(root),
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
}))

export default defineConfig({
  test: {
    projects,
    passWithNoTests: true,
  },
})
