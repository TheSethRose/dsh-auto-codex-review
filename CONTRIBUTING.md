# Contributing

Use Node 22.19+ or 24+, then `npm ci`. Keep changes scoped to this package and preserve the unmodified upstream baseline. Read AGENTS.md for security invariants.

Run `npm run check` for behavior changes and `npm pack --dry-run` for package changes. Tests use synthetic inputs and no network credentials. The optional `npm run test:live` sends a synthetic review to OpenAI using your existing ChatGPT login; it does not execute the proposed action. Do not make it part of CI.

Pull requests should describe the behavioral change, relevant verification, compatibility limits, and any departure from upstream. Keep documentation aligned with runtime behavior. Security reports follow SECURITY.md, not public issues containing sensitive data.
