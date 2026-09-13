/**
 * Copies the ffmpeg.wasm core (single-thread ESM build) into the web app's
 * public directory so the trim editor works offline / on the LAN without a
 * CDN. Run automatically before dev and build.
 */
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
// Resolves the UMD entry (require condition); the ESM tree sits beside it.
const coreRoot = dirname(dirname(dirname(require.resolve("@ffmpeg/core"))))
const source = join(coreRoot, "dist", "esm")
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "ffmpeg")

mkdirSync(target, { recursive: true })
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  copyFileSync(join(source, file), join(target, file))
  console.log(`copied @ffmpeg/core/dist/esm/${file} -> public/ffmpeg/${file}`)
}
