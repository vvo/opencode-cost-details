/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, type Accessor } from "solid-js"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type Msg = {
  role: string
  providerID?: string
  modelID?: string
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

type Entry = { cost: number; created: number }

type Tracker = {
  // user prompt messageID -> time created, one per turn
  boundaries: Map<string, number>
  // assistant messageID -> cost, covers the last two turns and everything live
  assistants: Map<string, Entry>
  // subagent sessionID -> session cost
  children: Map<string, Entry>
  version: Accessor<number>
  bump: () => void
}

async function backfill(api: TuiPluginApi, sessionID: string, tracker: Tracker) {
  try {
    let cursor: string | undefined
    let users = 0
    for (let page = 0; page < 50 && users < 2; page++) {
      const res = await api.client.v2.session.messages({
        sessionID,
        limit: 200,
        ...(cursor ? { cursor } : { order: "desc" as const }),
      })
      const body = res.data
      if (!body) break
      for (const message of body.data) {
        if (message.type === "assistant") {
          if (!tracker.assistants.has(message.id))
            tracker.assistants.set(message.id, { cost: message.cost ?? 0, created: message.time.created })
        } else if (message.type === "user") {
          tracker.boundaries.set(message.id, message.time.created)
          users++
          if (users >= 2) break
        }
      }
      cursor = body.cursor.next
      if (!cursor) break
    }
  } catch {
    // v2 message routes are experimental: fall back to the full v1 fetch
    const res = await api.client.session.messages({ sessionID }).catch(() => undefined)
    for (const { info } of res?.data ?? []) {
      if (info.role === "assistant") tracker.assistants.set(info.id, { cost: info.cost ?? 0, created: info.time.created })
      else if (info.role === "user") tracker.boundaries.set(info.id, info.time.created)
    }
  }
  const children = await api.client.session.children({ sessionID }).catch(() => undefined)
  for (const child of children?.data ?? []) {
    if (!tracker.children.has(child.id)) tracker.children.set(child.id, { cost: child.cost ?? 0, created: child.time.created })
  }
  tracker.bump()
}

function createTracker(api: TuiPluginApi, sessionID: string): Tracker {
  const [version, setVersion] = createSignal(0)
  const tracker: Tracker = {
    boundaries: new Map(),
    assistants: new Map(),
    children: new Map(),
    version,
    bump: () => setVersion((v) => v + 1),
  }
  void backfill(api, sessionID, tracker)
  return tracker
}

function View(props: { api: TuiPluginApi; session_id: string; tracker: Tracker }) {
  const theme = () => props.api.theme.current
  const messages = () => props.api.state.session.messages(props.session_id) as readonly Msg[]

  const context = () => {
    const last = messages().findLast((m) => m.role === "assistant" && (m.tokens?.output ?? 0) > 0)
    if (!last?.tokens) return { tokens: 0, percent: null }
    const t = last.tokens
    const tokens = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
    const model = props.api.state.provider.find((p) => p.id === last.providerID)?.models[last.modelID!]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  }

  const cost = () => {
    const tracker = props.tracker
    tracker.version()
    const turn = (start: [string, number], end?: [string, number]) => {
      let sum = 0
      for (const [id, m] of tracker.assistants) {
        if (id > start[0] && (!end || id < end[0])) sum += m.cost
      }
      for (const child of tracker.children.values()) {
        if (child.created >= start[1] && (!end || child.created < end[1])) sum += child.cost
      }
      return sum
    }
    const bounds = [...tracker.boundaries.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-2)
    let subagents = 0
    for (const child of tracker.children.values()) subagents += child.cost
    return {
      total: (props.api.state.session.get(props.session_id)?.cost ?? 0) + subagents,
      current: bounds.length > 0 ? turn(bounds[bounds.length - 1]!) : 0,
      previous: bounds.length === 2 ? turn(bounds[0]!, bounds[1]!) : 0,
    }
  }

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{context().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{context().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost().total)} spent</text>
      <text fg={theme().textMuted}>
        current {money.format(cost().current)}, previous {money.format(cost().previous)}
      </text>
    </box>
  )
}

const INTERNAL_CONTEXT = "internal:sidebar-context"

const tui: TuiPlugin = async (api) => {
  const internal = api.plugins.list().find((p) => p.id === INTERNAL_CONTEXT)
  if (internal) {
    if (internal.active) await api.plugins.deactivate(INTERNAL_CONTEXT)
    api.lifecycle.onDispose(async () => {
      await api.plugins.activate(INTERNAL_CONTEXT)
    })
  }

  const trackers = new Map<string, Tracker>()
  const track = (sessionID: string) => {
    let tracker = trackers.get(sessionID)
    if (!tracker) {
      tracker = createTracker(api, sessionID)
      trackers.set(sessionID, tracker)
    }
    return tracker
  }

  const unsubs = [
    api.event.on("message.updated", (event) => {
      const tracker = trackers.get(event.properties.sessionID)
      const info = event.properties.info
      if (!tracker || info.role !== "assistant") return
      tracker.assistants.set(info.id, { cost: info.cost ?? 0, created: info.time.created })
      tracker.bump()
    }),
    // real user prompts only: `$` shell commands never fire this event
    api.event.on("session.next.prompted", (event) => {
      const tracker = trackers.get(event.properties.sessionID)
      if (!tracker) return
      tracker.boundaries.set(event.properties.messageID, event.properties.timestamp)
      tracker.bump()
    }),
    api.event.on("session.updated", (event) => {
      const info = event.properties.info
      const tracker = info.parentID ? trackers.get(info.parentID) : undefined
      if (!tracker) return
      tracker.children.set(info.id, { cost: info.cost ?? 0, created: info.time.created })
      tracker.bump()
    }),
  ]
  api.lifecycle.onDispose(() => {
    for (const unsub of unsubs) unsub()
  })

  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} tracker={track(props.session_id)} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-cost-details",
  tui,
}

export default plugin
