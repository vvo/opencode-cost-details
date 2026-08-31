import assert from "node:assert/strict"
import { test } from "node:test"
import { computeTurns } from "../dist/turns.js"

const user = (id, created) => ({ id, user: true, cost: 0, created })
const msg = (id, created, cost) => ({ id, user: false, cost, created })

test("no messages", () => {
  assert.deepEqual(computeTurns([]), { current: 0, previous: 0 })
})

test("splits on user messages", () => {
  const entries = [user("1", 1), msg("2", 2, 0.5), user("3", 3), msg("4", 4, 0.25)]
  assert.deepEqual(computeTurns(entries), { current: 0.25, previous: 0.5 })
})

test("a single turn leaves previous at zero", () => {
  assert.deepEqual(computeTurns([user("1", 1), msg("2", 2, 0.5)]), { current: 0.5, previous: 0 })
})

test("sums every message in a turn", () => {
  const entries = [user("1", 1), msg("2", 2, 0.5), msg("3", 3, 0.25)]
  assert.deepEqual(computeTurns(entries), { current: 0.75, previous: 0 })
})

test("sorts by creation time, not input order", () => {
  const entries = [msg("4", 4, 0.25), user("3", 3), msg("2", 2, 0.5), user("1", 1)]
  assert.deepEqual(computeTurns(entries), { current: 0.25, previous: 0.5 })
})

test("dedupes by id so the live window can overlap the backfill", () => {
  const entries = [user("1", 1), msg("2", 2, 0.5), msg("2", 2, 0.5)]
  assert.deepEqual(computeTurns(entries), { current: 0.5, previous: 0 })
})

test("ignores messages before the first user message", () => {
  assert.deepEqual(computeTurns([msg("0", 0, 9)]), { current: 0, previous: 0 })
})

test("reports only the last two of many turns", () => {
  const entries = [user("1", 1), msg("2", 2, 1), user("3", 3), msg("4", 4, 2), user("5", 5), msg("6", 6, 3)]
  assert.deepEqual(computeTurns(entries), { current: 3, previous: 2 })
})

test("attributes a subagent to the turn open when it started", () => {
  const entries = [user("1", 1), msg("2", 2, 0.5), user("3", 3), msg("4", 4, 0.25)]
  assert.deepEqual(computeTurns(entries, [{ cost: 1, created: 3.5 }]), { current: 1.25, previous: 0.5 })
  assert.deepEqual(computeTurns(entries, [{ cost: 1, created: 1.5 }]), { current: 0.25, previous: 1.5 })
})

test("drops a subagent that predates every turn", () => {
  assert.deepEqual(computeTurns([user("1", 1)], [{ cost: 1, created: 0 }]), { current: 0, previous: 0 })
})
