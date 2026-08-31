/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { computeTurns, type Child, type Entry, type Turns } from "./turns.js"

// One object satisfies both hosts. opencode 1 validates `tui`, opencode 2
// validates `setup`, and neither rejects the other's key. Nothing is imported
// from @opencode-ai/plugin at runtime: on opencode 2 that specifier is remapped
// to a host builtin, but on opencode 1 it resolves to the real npm package,
// where the v2 exports do not exist.
import type { RGBA } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Plugin } from "plugin-v2/tui"

type Context = Plugin.Context

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

/** How far back to page when backfilling; two user messages is all we display. */
const BACKFILL_PAGE = 200
const BACKFILL_PAGES = 50
const BACKFILL_TURNS = 2

type Tracker = {
  /** Turns the host's own (short) message window has dropped. */
  history: Map<string, Entry>
  /** Subagent sessionID -> cost, so a session is only counted once. */
  children: Map<string, Child>
  version: Accessor<number>
  bump: () => void
}

function createTracker(): Tracker {
  const [version, setVersion] = createSignal(0)
  return {
    history: new Map(),
    children: new Map(),
    version,
    bump: () => setVersion((v) => v + 1),
  }
}

/** Shared view: a single line appended under the host's Context block. */
// opencode 1 hands out RGBA theme values, opencode 2 hands out strings; the
// opentui `fg` prop accepts either.
function CostLine(props: { turns: () => Turns; fg: string | RGBA }) {
  const visible = () => props.turns().current > 0 || props.turns().previous > 0
  return (
    <>
      {visible() ? (
        <text fg={props.fg}>
          current {money.format(props.turns().current)}, previous {money.format(props.turns().previous)}
        </text>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// opencode 2
// ---------------------------------------------------------------------------

async function backfillV2(context: Context, sessionID: string, tracker: Tracker) {
  try {
    let cursor: string | undefined
    let users = 0
    for (let page = 0; page < BACKFILL_PAGES && users < BACKFILL_TURNS; page++) {
      const res = await context.client.message.list({
        sessionID,
        limit: BACKFILL_PAGE,
        order: "desc",
        ...(cursor ? { cursor } : {}),
      })
      for (const message of res.data) {
        tracker.history.set(message.id, {
          id: message.id,
          user: message.type === "user",
          cost: "cost" in message ? (message.cost ?? 0) : 0,
          created: message.time.created,
        })
        if (message.type === "user" && ++users >= BACKFILL_TURNS) break
      }
      cursor = res.cursor.next ?? undefined
      if (!cursor) break
    }
  } catch {
    // A backfill failure only costs us the previous turn; the live window still renders.
  }

  try {
    const children = await context.client.session.list({ parentID: sessionID, order: "desc" })
    for (const child of children.data) {
      if (!tracker.children.has(child.id))
        tracker.children.set(child.id, { cost: child.cost ?? 0, created: child.time.created })
    }
  } catch {
    // Subagent costs stay out until a usage event reports them.
  }

  tracker.bump()
}

function setup(context: Context) {
  if (typeof context.ui?.slot !== "function") {
    context.ui?.toast?.show({
      variant: "error",
      message: "opencode-cost-details needs a newer opencode (sidebar slots unavailable)",
    })
    return
  }

  const trackers = new Map<string, Tracker>()
  const track = (sessionID: string) => {
    let tracker = trackers.get(sessionID)
    if (!tracker) {
      tracker = createTracker()
      trackers.set(sessionID, tracker)
      void backfillV2(context, sessionID, tracker)
    }
    return tracker
  }

  // session.updated is gone in v2, and usage events carry no parentID, so the
  // parent is resolved through the session tree instead.
  const unsubscribe = context.data.on("session.usage.updated", (event) => {
    const { sessionID, cost } = event.data
    const root = context.data.session.root(sessionID)
    if (!root || root === sessionID) return
    const tracker = trackers.get(root)
    if (!tracker) return
    const created = context.data.session.get(sessionID)?.time.created
    if (created === undefined) return
    tracker.children.set(sessionID, { cost: cost ?? 0, created })
    tracker.bump()
  })

  const unslot = context.ui.slot({
    append: "sidebar.content",
    render: ({ sessionID }) => {
      const turns = () => {
        const tracker = track(sessionID)
        tracker.version()
        const live = context.data.session.message.list(sessionID).map((message) => ({
          id: message.id,
          user: message.type === "user",
          cost: "cost" in message ? (message.cost ?? 0) : 0,
          created: message.time.created,
        }))
        return computeTurns([...tracker.history.values(), ...live], tracker.children.values())
      }
      return <CostLine turns={turns} fg={context.theme.text.subdued} />
    },
  })

  return () => {
    unsubscribe()
    unslot()
  }
}

// ---------------------------------------------------------------------------
// opencode 1
// ---------------------------------------------------------------------------

type V1Message = {
  id: string
  role: string
  cost?: number
  time: { created: number }
}

async function backfillV1(api: TuiPluginApi, sessionID: string, tracker: Tracker) {
  try {
    const res = await api.client.session.messages({ sessionID })
    for (const { info } of res?.data ?? []) {
      tracker.history.set(info.id, {
        id: info.id,
        user: info.role === "user",
        cost: info.role === "assistant" ? (info.cost ?? 0) : 0,
        created: info.time.created,
      })
    }
  } catch {
    // Live window only.
  }

  try {
    const children = await api.client.session.children({ sessionID })
    for (const child of children?.data ?? []) {
      if (!tracker.children.has(child.id))
        tracker.children.set(child.id, { cost: child.cost ?? 0, created: child.time.created })
    }
  } catch {
    // Subagent costs stay out until session.updated reports them.
  }

  tracker.bump()
}

const tui: TuiPlugin = async (api) => {
  if (typeof api.slots?.register !== "function") {
    api.ui?.toast({
      variant: "error",
      message: "opencode-cost-details needs a newer opencode (sidebar slots unavailable)",
    })
    return
  }

  const trackers = new Map<string, Tracker>()
  const track = (sessionID: string) => {
    let tracker = trackers.get(sessionID)
    if (!tracker) {
      tracker = createTracker()
      trackers.set(sessionID, tracker)
      void backfillV1(api, sessionID, tracker)
    }
    return tracker
  }

  api.lifecycle.onDispose(
    api.event.on("session.updated", (event) => {
      const info = event.properties.info
      if (!info.parentID) return
      const tracker = trackers.get(info.parentID)
      if (!tracker) return
      tracker.children.set(info.id, { cost: info.cost ?? 0, created: info.time.created })
      tracker.bump()
    }),
  )

  // The built-in sidebar sections use order 100 (context) through 500 (files).
  // 150 puts the line just under Context, where opencode 2's
  // `append: "sidebar.content"` also puts it.
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
          const turns = () => {
            const tracker = track(props.session_id)
            tracker.version()
            const live = (api.state.session.messages(props.session_id) as readonly V1Message[]).map((message) => ({
              id: message.id,
              user: message.role === "user",
              cost: message.cost ?? 0,
              created: message.time.created,
            }))
            return computeTurns([...tracker.history.values(), ...live], tracker.children.values())
          }
          return <CostLine turns={turns} fg={api.theme.current.textMuted} />
      },
    },
  })
}

export default {
  id: "opencode-cost-details",
  tui,
  setup,
}
