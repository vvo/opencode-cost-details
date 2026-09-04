/** @jsxImportSource @opentui/solid */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createEffect, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Plugin } from "plugin-v2/tui"
import {
  extractPullRequests,
  extractCreatedPullRequests,
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
type Message = { type?: string; content?: unknown[] }

async function fetchPullRequest(ref: PullRequestRef): Promise<PullRequest | undefined> {
  try {
    const { stdout } = await execFileAsync("gh", ["pr", "view", ref.url, "--json", "title,state,url,number,isDraft"])
    const data = JSON.parse(stdout) as Pick<PullRequest, "title" | "state" | "url" | "number" | "isDraft">
    return { ...ref, ...data }
  } catch {
    return undefined
  }
}

function refsFromV2(messages: readonly Message[]): PullRequestRef[] {
  const refs: PullRequestRef[] = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const content of message.content ?? []) {
      if (!content || typeof content !== "object") continue
      const part = content as {
        type?: string
        name?: string
        state?: { status?: string; input?: { command?: string }; content?: unknown[] }
      }
      if (part.type !== "tool" || part.name !== "shell" || part.state?.status !== "completed") continue
      refs.push(...extractCreatedPullRequests(part.state.input?.command ?? "", JSON.stringify(part.state.content)))
    }
  }
  return refs.flat()
}

function refsFromV1(api: TuiPluginApi, sessionID: string): PullRequestRef[] {
  const refs: PullRequestRef[] = []
  for (const message of api.state.session.messages(sessionID)) {
    for (const part of api.state.part(message.id)) {
      if (part.type !== "tool" || part.tool !== "shell" || part.state.status !== "completed") continue
      const input = part.state.input as { command?: string }
      refs.push(...extractCreatedPullRequests(input.command ?? "", part.state.output))
    }
  }
  return refs.flat()
}

async function refsFromV2History(context: Context, sessionID: string): Promise<PullRequestRef[]> {
  const refs: PullRequestRef[] = []
  let cursor: string | undefined
  let page = 0
  do {
    const response = await context.client.message.list({ sessionID, limit: 200, ...(cursor ? { cursor } : {}) })
    refs.push(...refsFromV2(response.data as readonly Message[]))
    cursor = response.cursor.next ?? undefined
    page++
  } while (cursor && page < MAX_HISTORY_PAGES)
  return refs
}

async function refsFromV1History(api: TuiPluginApi, sessionID: string): Promise<PullRequestRef[]> {
  const response = await api.client.session.messages({ sessionID })
  const refs: PullRequestRef[] = []
  for (const item of response.data ?? []) {
    for (const part of item.parts as {
      type?: string
      tool?: string
      state?: { status?: string; input?: { command?: string }; output?: string }
    }[]) {
      if (part.type !== "tool" || part.tool !== "shell" || part.state?.status !== "completed") continue
      refs.push(...extractCreatedPullRequests(part.state.input?.command ?? "", part.state.output ?? ""))
    }
  }
  return refs.flat()
}

function PullRequests(props: {
  refs: Accessor<PullRequestRef[]>
  history: () => Promise<PullRequestRef[]>
  foreground: string | RGBA
  subdued: string | RGBA
  link: string | RGBA
}) {
  const [open, setOpen] = createSignal(true)
  const [prs, setPrs] = createSignal<PullRequest[]>([])
  const [unavailable, setUnavailable] = createSignal(false)
  const visiblePrs = () => prs().slice(-MAX_VISIBLE_PRS)
  const hiddenCount = () => prs().length - visiblePrs().length
  let history: PullRequestRef[] = []
  const refresh = async () => {
    const refs = uniquePullRequests([...history, ...props.refs()])
    const results = await Promise.all(refs.map(fetchPullRequest))
    setUnavailable(refs.length > 0 && results.every((result) => result === undefined))
    setPrs(results.filter((result): result is PullRequest => result !== undefined && result.state !== "CLOSED"))
  }
  createEffect(() => {
    props.refs()
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
            • <a href={pr.url}>{truncate(pr.title, 32)}</a>{" "}
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
        refs={() => refsFromV2(context.data.session.message.list(sessionID) as readonly Message[])}
        history={() => refsFromV2History(context, sessionID)}
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
          refs={() => refsFromV1(api, props.session_id)}
          history={() => refsFromV1History(api, props.session_id)}
          foreground={api.theme.current.text}
          subdued={api.theme.current.textMuted}
          link={api.theme.current.markdownLink}
        />
      },
    },
  })
}

export default { id: "opencode-prs", tui, setup }
