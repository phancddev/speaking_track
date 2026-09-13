import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

// Host-side generate/migrate convenience: read the repo-root .env without
// overriding variables already set in the environment.
config({ path: new URL("../../.env", import.meta.url).pathname, quiet: true })

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // generate never connects; migrate uses the real value from the env.
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/speaking_track",
  },
  verbose: true,
  strict: false,
})
