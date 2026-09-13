#!/usr/bin/env node
// Honest failure for root scripts whose implementation belongs to a later task.
// These scripts must never pretend success. Each exits non-zero with the owning
// task named on stderr until the real implementation lands and replaces the call.

const [scriptName, description] = process.argv.slice(2)

if (!scriptName || !description) {
  process.stderr.write("usage: pending-implementation.mjs <script-name> <description>\n")
  process.exit(2)
}

process.stderr.write(
  [
    `pnpm ${scriptName}: not implemented yet.`,
    `${description} is not part of this repository yet.`,
    `This command fails on purpose instead of pretending success.`,
    ``,
  ].join("\n"),
)
process.exit(1)
