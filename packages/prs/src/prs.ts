export type PullRequestRef = { owner: string; repo: string; number: number; url: string }
export type PullRequest = PullRequestRef & { title: string; state: "OPEN" | "CLOSED" | "MERGED"; isDraft: boolean }

export function pullRequestStatus(pr: Pick<PullRequest, "state" | "isDraft">): "draft" | "open" | "merged" | "closed" {
  if (pr.state === "MERGED") return "merged"
  if (pr.state === "CLOSED") return "closed"
  return pr.isDraft ? "draft" : "open"
}

const GITHUB_PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\b|\/)/g

export function extractPullRequests(text: string): PullRequestRef[] {
  const refs = new Map<string, PullRequestRef>()
  for (const match of text.matchAll(GITHUB_PR_URL)) {
    const [, owner, repo, value] = match
    const number = Number(value)
    const url = `https://github.com/${owner}/${repo}/pull/${number}`
    refs.set(url, { owner, repo, number, url })
  }
  return [...refs.values()]
}

export function uniquePullRequests(refs: Iterable<PullRequestRef>): PullRequestRef[] {
  return [...new Map([...refs].map((ref) => [ref.url, ref])).values()]
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
}
