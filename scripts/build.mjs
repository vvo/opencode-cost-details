// opencode's solid JSX transform skips any path containing node_modules, and npm
// plugins are installed under node_modules, so JSX has to be compiled at publish time.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { transformAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "babel-preset-solid"

const root = resolve(import.meta.dirname, "..")
const input = resolve(root, "src/tui.tsx")
const output = resolve(root, "dist/tui.js")

const result = await transformAsync(await readFile(input, "utf8"), {
  filename: input,
  configFile: false,
  babelrc: false,
  presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }], [typescript]],
})
if (!result?.code) throw new Error("babel produced no output")

await mkdir(dirname(output), { recursive: true })
await writeFile(output, result.code + "\n")
console.log(`built ${output}`)
