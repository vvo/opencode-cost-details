/**
 * Turn cost math, kept free of any host API so it can be unit tested and shared
 * by the opencode 1 and opencode 2 entrypoints.
 */

export type Entry = {
  /** Message id, used to dedupe live state against the backfill. */
  id: string
  /** A turn starts at every user message; everything else adds to the open turn. */
  user: boolean
  cost: number
  created: number
}

export type Child = {
  cost: number
  created: number
}

export type Turns = {
  current: number
  previous: number
}

/**
 * Groups messages into turns and returns the cost of the last two.
 *
 * Entries may repeat by id (the live message window overlaps the backfill); the
 * last one wins. Subagent spend is attributed to the turn that was open when the
 * subagent session was created.
 */
export function computeTurns(entries: Iterable<Entry>, children: Iterable<Child> = []): Turns {
  const byID = new Map<string, Entry>()
  for (const entry of entries) byID.set(entry.id, entry)

  const sorted = [...byID.values()].sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1))

  const turns: { cost: number; start: number }[] = []
  for (const entry of sorted) {
    if (entry.user) turns.push({ cost: 0, start: entry.created })
    else if (turns.length > 0) turns[turns.length - 1]!.cost += entry.cost
  }

  for (const child of children) {
    // findLast: the most recent turn that had already started when the subagent did.
    const turn = turns.findLast((candidate) => child.created >= candidate.start)
    if (turn) turn.cost += child.cost
  }

  return {
    current: turns.at(-1)?.cost ?? 0,
    previous: turns.at(-2)?.cost ?? 0,
  }
}
