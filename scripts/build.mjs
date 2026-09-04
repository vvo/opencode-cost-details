import { spawn } from "node:child_process"

const child = spawn("pnpm", ["build"], { stdio: "inherit" })
child.on("exit", (code) => {
  if (code) {
    process.exitCode = code
  }
})
