import assert from "node:assert/strict"
import { test } from "node:test"
import { extractPullRequests, pullRequestStatus, truncate, uniquePullRequests } from "../dist/prs.js"

test("extracts and normalizes GitHub pull request links", () => {
  assert.deepEqual(extractPullRequests("See https://github.com/vvo/opencode-plugins/pull/12/files"), [{
    owner: "vvo", repo: "opencode-plugins", number: 12,
    url: "https://github.com/vvo/opencode-plugins/pull/12",
  }])
})

test("removes duplicate pull requests", () => {
  const refs = extractPullRequests("https://github.com/vvo/repo/pull/1 https://github.com/vvo/repo/pull/1")
  assert.equal(uniquePullRequests(refs).length, 1)
})

test("truncates long titles", () => assert.equal(truncate("a long title", 8), "a long …"))

test("labels pull request states", () => {
  assert.equal(pullRequestStatus({ state: "OPEN", isDraft: true }), "draft")
  assert.equal(pullRequestStatus({ state: "OPEN", isDraft: false }), "open")
  assert.equal(pullRequestStatus({ state: "MERGED", isDraft: false }), "merged")
})
