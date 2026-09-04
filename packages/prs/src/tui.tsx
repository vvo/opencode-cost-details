/** @jsxImportSource @opentui/solid */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createEffect, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Plugin } from "plugin-v2/tui"
import {
  extractPullRequests,
  pullRequestStatus,
  truncate,
  uniquePullRequests,
  type PullRequest,
  type PullRequestRef,
} from "./prs.js"

const execFileAsync = promisify(execFile)
const REFRESH_MS = 60_000
const MAX_HISTORY_PAGES = 50
const MAX_VISIBLE_PRS = 5
type Context = Plugin.Context
type Message = { type?: string; text?: string; content?: unknown[] }

async function fetchPullRequest(ref: PullRequestRef): Promise<PullRequest | undefined> {
  try {
    const { stdout } = await execFileAsync("gh", ["pr", "view", ref.url, "--json", "title,state,url,number,isDraft"])
    const data = JSON.parse(stdout) as Pick<PullRequest, "title" | "state" | "url" | "number" | "isDraft">
    return { ...ref, ...data }
  } catch {
    return undefined
  }
}

function textFromV2(messages: readonly Message[]): string {
  const chunks: string[] = []
  for (const message of messages) {
    if (message.type === "user" && typeof message.text === "string") chunks.push(message.text)
    if (message.type !== "assistant") continue
    for (const content of message.content ?? []) {
      if (!content || typeof content !== "object") continue
      const part = content as { type?: string; text?: string }
      if (part.type === "text" && typeof part.text === "string") chunks.push(part.text)
    }
  }
  return chunks.join("\n")
}

function textFromV1(api: TuiPluginApi, sessionID: string): string {
  const chunks: string[] = []
  for (const message of api.state.session.messages(sessionID)) {
    if (message.role !== "user" && message.role !== "assistant") continue
    for (const part of api.state.part(message.id)) {
      if (part.type === "text" && "text" in part) chunks.push(part.text)
    }
  }
  return chunks.join("\n")
}

async function textFromV2History(context: Context, sessionID: string): Promise<string> {
  const chunks: string[] = []
  let cursor: string | undefined
  let page = 0
  do {
    const response = await context.client.message.list({ sessionID, limit: 200, ...(cursor ? { cursor } : {}) })
    chunks.push(textFromV2(response.data as readonly Message[]))
    cursor = response.cursor.next ?? undefined
    page++
  } while (cursor && page < MAX_HISTORY_PAGES)
  return chunks.join("\n")
}

async function textFromV1History(api: TuiPluginApi, sessionID: string): Promise<string> {
  const response = await api.client.session.messages({ sessionID })
  const chunks: string[] = []
  for (const item of response.data ?? []) {
    const info = item.info as { role?: string; text?: string }
    if (info.role !== "user" && info.role !== "assistant") continue
    if (typeof info.text === "string") chunks.push(info.text)
    for (const part of item.parts as { type?: string; text?: string }[]) {
      if (part.type === "text" && typeof part.text === "string") chunks.push(part.text)
    }
  }
  return chunks.join("\n")
}

function PullRequests(props: {
  text: Accessor<string>
  history: () => Promise<string>
  foreground: string | RGBA
  subdued: string | RGBA
  link: string | RGBA
}) {
  const [open, setOpen] = createSignal(true)
  const [prs, setPrs] = createSignal<PullRequest[]>([])
  const [unavailable, setUnavailable] = createSignal(false)
  const visiblePrs = () => prs().slice(-MAX_VISIBLE_PRS)
  const hiddenCount = () => prs().length - visiblePrs().length
  let history = ""
  const refresh = async () => {
    const refs = uniquePullRequests(extractPullRequests(`${history}\n${props.text()}`))
    const results = await Promise.all(refs.map(fetchPullRequest))
    setUnavailable(refs.length > 0 && results.every((result) => result === undefined))
    setPrs(results.filter((result): result is PullRequest => result !== undefined && result.state !== "CLOSED"))
  }
  createEffect(() => {
    props.text()
    void refresh()
  })
  onMount(() => {
    void props.history().then((value) => {
      history = value
      void refresh()
    })
    const interval = setInterval(() => void refresh(), REFRESH_MS)
    onCleanup(() => clearInterval(interval))
  })
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} onMouseUp={() => setOpen((value) => !value)}>
        <text fg={props.foreground}>{open() ? "▼" : "▶"}</text>
        <text fg={props.foreground}><b>PRs ({prs().length})</b></text>
      </box>
      <Show when={open()}>
        <Show when={unavailable()}><text fg={props.subdued}>GitHub unavailable</text></Show>
        <Show when={!unavailable() && prs().length === 0}><text fg={props.subdued}>No PRs</text></Show>
        <For each={visiblePrs()}>{(pr) => (
          <text fg={props.subdued} wrapMode="none">
            • <a href={pr.url}>#{pr.number} {truncate(pr.title, 24)}</a>{" "}
            <span style={{ fg: pr.state === "OPEN" && !pr.isDraft ? props.subdued : props.link }}>
              {pullRequestStatus(pr)}
            </span>
          </text>
        )}</For>
        <Show when={hiddenCount() > 0}><text fg={props.subdued}>+{hiddenCount()} more</text></Show>
      </Show>
    </box>
  )
}

function setup(context: Context) {
  if (typeof context.ui?.slot !== "function") return
  return context.ui.slot({
    append: "sidebar.content",
    render: ({ sessionID }) => (
      <PullRequests
        text={() => textFromV2(context.data.session.message.list(sessionID) as readonly Message[])}
        history={() => textFromV2History(context, sessionID)}
        foreground={context.theme.text.default}
        subdued={context.theme.text.subdued}
        link={context.theme.markdown.link}
      />
    ),
  })
}

const tui: TuiPlugin = async (api) => {
  if (typeof api.slots?.register !== "function") return
  api.slots.register({
    order: 240,
    slots: {
      sidebar_content(_ctx, props) {
        return <PullRequests
          text={() => textFromV1(api, props.session_id)}
          history={() => textFromV1History(api, props.session_id)}
          foreground={api.theme.current.text}
          subdued={api.theme.current.textMuted}
          link={api.theme.current.markdownLink}
        />
      },
    },
  })
}

export default { id: "opencode-prs", tui, setup }
