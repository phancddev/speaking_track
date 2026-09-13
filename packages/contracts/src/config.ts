import { z } from "zod"

/**
 * Shared configuration helpers. Packages expose factory functions that take
 * an explicit env-like record — no package reads `process.env` at import
 * time, and nothing connects before a factory is called.
 */

/**
 * Thrown by configuration factories when required variables are missing or
 * malformed. Carrying every problem at once lets operators fix their
 * environment in one pass; startup must fail on this error.
 */
export class ConfigurationError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`)
    this.name = "ConfigurationError"
    this.problems = problems
  }
}

/** Collects per-variable problems from a schema failure into one error. */
export function configurationErrorFromZodError(
  variables: readonly string[],
  error: z.ZodError,
): ConfigurationError {
  const problems = error.issues.map((issue) => {
    const path = issue.path.join(".")
    const name = path === "" ? variables.join("|") : path
    return `${name}: ${issue.message}`
  })
  return new ConfigurationError(problems)
}

const ENV_BOOLEAN = z.stringbool({ truthy: ["true", "1"], falsy: ["false", "0"] })

const POSITIVE_INT_STRING = z
  .string()
  .regex(/^\d+$/, "must be a positive integer written without separators")
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value) && value > 0, "must be a positive integer")

function urlSchema(schemes: readonly string[], description: string) {
  return z
    .string()
    .url(`must be a valid ${description}`)
    .refine((value) => schemes.some((scheme) => value.startsWith(`${scheme}://`)), {
      message: `must start with ${schemes.join(" or ")}`,
    })
}

export const ENV_SCHEMAS = {
  boolean: ENV_BOOLEAN,
  positiveInt: POSITIVE_INT_STRING,
  postgresUrl: urlSchema(["postgres", "postgresql"], "PostgreSQL connection URL"),
  redisUrl: urlSchema(["redis", "rediss"], "Redis connection URL"),
  httpUrl: urlSchema(["http", "https"], "HTTP(S) endpoint URL"),
  nonEmptyString: z.string().min(1, "must not be empty"),
} as const
