/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, type Accessor } from "solid-js"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type Msg = {
  id: string
  role: string
  cost?: number
  time: { created: number }
  providerID?: string
  modelID?: string
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

type Entry = { role: string; cost: number; created: number }

type Tracker = {
  // messageID -> role and cost, for the turns the TUI dropped from its own window
  history: Map<string, Entry>
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
        tracker.history.set(message.id, {
          role: message.type,
          cost: message.type === "assistant" ? (message.cost ?? 0) : 0,
          created: message.time.created,
        })
        if (message.type === "user") {
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
      tracker.history.set(info.id, {
        role: info.role,
        cost: info.role === "assistant" ? (info.cost ?? 0) : 0,
        created: info.time.created,
      })
    }
  }
  const children = await api.client.session.children({ sessionID }).catch(() => undefined)
  for (const child of children?.data ?? []) {
    if (!tracker.children.has(child.id))
      tracker.children.set(child.id, { role: "child", cost: child.cost ?? 0, created: child.time.created })
  }
  tracker.bump()
}

function createTracker(api: TuiPluginApi, sessionID: string): Tracker {
  const [version, setVersion] = createSignal(0)
  const tracker: Tracker = {
    history: new Map(),
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

    // the TUI state is the live source, the backfill only covers what it dropped
    const merged = new Map(tracker.history)
    for (const message of messages()) {
      merged.set(message.id, {
        role: message.role,
        cost: message.cost ?? 0,
        created: message.time.created,
      })
    }

    const turns: { cost: number; start: number }[] = []
    for (const [, message] of [...merged].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (message.role === "user") turns.push({ cost: 0, start: message.created })
      else if (turns.length > 0) turns[turns.length - 1]!.cost += message.cost
    }

    let subagents = 0
    for (const child of tracker.children.values()) {
      subagents += child.cost
      const turn = turns.findLast((candidate) => child.created >= candidate.start)
      if (turn) turn.cost += child.cost
    }

    return {
      total: (props.api.state.session.get(props.session_id)?.cost ?? 0) + subagents,
      current: turns.at(-1)?.cost ?? 0,
      previous: turns.at(-2)?.cost ?? 0,
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

  const unsub = api.event.on("session.updated", (event) => {
    const info = event.properties.info
    const tracker = info.parentID ? trackers.get(info.parentID) : undefined
    if (!tracker) return
    tracker.children.set(info.id, { role: "child", cost: info.cost ?? 0, created: info.time.created })
    tracker.bump()
  })
  api.lifecycle.onDispose(unsub)

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
