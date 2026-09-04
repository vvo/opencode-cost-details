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
  marquee,
  pullRequestStatus,
  uniquePullRequests,
  type PullRequest,
  type PullRequestRef,
} from "./prs.js"

const execFileAsync = promisify(execFile)
const REFRESH_MS = 60_000
const MAX_HISTORY_PAGES = 50
const MAX_VISIBLE_PRS = 5
const MARQUEE_DELAY_MS = 500
const MARQUEE_STEP_MS = 120
type Context = Plugin.Context
type Message = { type?: string; content?: unknown[] }
type SessionCache = {
  history: PullRequestRef[]
  historyPromise?: Promise<PullRequestRef[]>
  prs: PullRequest[]
  refsKey: string
  refreshedAt: number
  unavailable: boolean
  refreshPromise?: Promise<void>
}

const sessionCache = new Map<string, SessionCache>()

function cacheFor(sessionID: string): SessionCache {
  let cache = sessionCache.get(sessionID)
  if (!cache) {
    cache = { history: [], prs: [], refsKey: "", refreshedAt: 0, unavailable: false }
    sessionCache.set(sessionID, cache)
  }
  return cache
}

function PullRequestRow(props: { pr: PullRequest; subdued: string | RGBA; link: string | RGBA }) {
  const [hovered, setHovered] = createSignal(false)
  const [width, setWidth] = createSignal(1)
  const [offset, setOffset] = createSignal(0)
  let delay: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    clearTimeout(delay)
    clearInterval(interval)
    setOffset(0)
    if (!hovered() || props.pr.title.length <= width()) return
    delay = setTimeout(() => {
      interval = setInterval(() => setOffset((value) => value + 1), MARQUEE_STEP_MS)
    }, MARQUEE_DELAY_MS)
  })
  onCleanup(() => {
    clearTimeout(delay)
    clearInterval(interval)
  })

  return (
    <box
      flexDirection="row"
      minWidth={0}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text fg={props.subdued} flexShrink={0}>• </text>
      <box flexGrow={1} minWidth={0} overflow="hidden" onSizeChange={function () { setWidth(this.width) }}>
        <text fg={props.link} wrapMode="none"><a href={props.pr.url}>{marquee(props.pr.title, width(), offset())}</a></text>
      </box>
      <text fg={props.pr.state === "OPEN" && !props.pr.isDraft ? props.subdued : props.link} flexShrink={0}>
        {" "}{pullRequestStatus(props.pr)}
      </text>
    </box>
  )
}

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
  sessionID: string
  refs: Accessor<PullRequestRef[]>
  history: () => Promise<PullRequestRef[]>
  foreground: string | RGBA
  subdued: string | RGBA
  link: string | RGBA
}) {
  const cache = cacheFor(props.sessionID)
  const [open, setOpen] = createSignal(true)
  const [prs, setPrs] = createSignal<PullRequest[]>(cache.prs)
  const [unavailable, setUnavailable] = createSignal(cache.unavailable)
  const visiblePrs = () => prs().slice(-MAX_VISIBLE_PRS)
  const hiddenCount = () => prs().length - visiblePrs().length
  let mounted = true
  const showCache = () => {
    if (!mounted) return
    setPrs(cache.prs)
    setUnavailable(cache.unavailable)
  }
  const refresh = async (force = false) => {
    const refs = uniquePullRequests([...cache.history, ...props.refs()])
    const refsKey = refs.map((ref) => ref.url).join("\n")
    if (!force && refsKey === cache.refsKey && Date.now() - cache.refreshedAt < REFRESH_MS) {
      showCache()
      return
    }
    if (!cache.refreshPromise) {
      cache.refreshPromise = Promise.all(refs.map(fetchPullRequest)).then((results) => {
        cache.unavailable = refs.length > 0 && results.every((result) => result === undefined)
        cache.prs = results.filter((result): result is PullRequest => result !== undefined && result.state !== "CLOSED")
        cache.refsKey = refsKey
        cache.refreshedAt = Date.now()
      }).finally(() => {
        cache.refreshPromise = undefined
      })
    }
    await cache.refreshPromise
    showCache()
  }
  createEffect(() => {
    props.refs()
    void refresh()
  })
  onMount(() => {
    cache.historyPromise ??= props.history()
    void cache.historyPromise.then((value) => {
      cache.history = value
      void refresh()
    })
    const interval = setInterval(() => void refresh(true), REFRESH_MS)
    onCleanup(() => {
      mounted = false
      clearInterval(interval)
    })
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
          <PullRequestRow pr={pr} subdued={props.subdued} link={props.link} />
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
        sessionID={sessionID}
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
          sessionID={props.session_id}
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
