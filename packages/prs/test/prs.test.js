import assert from "node:assert/strict"
import { test } from "node:test"
import { extractCreatedPullRequests, extractPullRequests, marquee, pullRequestStatus, truncate, uniquePullRequests } from "../dist/prs.js"

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

test("only extracts pull requests created by gh", () => {
  const url = "https://github.com/vvo/opencode-plugins/pull/7"
  assert.equal(extractCreatedPullRequests("gh pr view 7", url).length, 0)
  assert.equal(extractCreatedPullRequests("gh pr create --draft", url)[0].url, url)
})

test("scrolls long titles", () => {
  assert.equal(marquee("abcdef", 4, 0), "abcd")
  assert.equal(marquee("abcdef", 4, 2), "cdef")
  assert.equal(marquee("abc", 4, 2), "abc")
})
