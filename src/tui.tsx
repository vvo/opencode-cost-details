/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type Msg = {
  role: string
  cost?: number
  providerID?: string
  modelID?: string
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const messages = () => props.api.state.session.messages(props.session_id) as Msg[]

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
    const turns: number[] = []
    for (const msg of messages()) {
      if (msg.role === "user") {
        turns.push(0)
        continue
      }
      if (msg.role === "assistant" && turns.length > 0) {
        turns[turns.length - 1] += msg.cost ?? 0
      }
    }
    return {
      total: props.api.state.session.get(props.session_id)?.cost ?? 0,
      current: turns.at(-1) ?? 0,
      previous: turns.at(-2) ?? 0,
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

  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-cost-details",
  tui,
}

export default plugin
