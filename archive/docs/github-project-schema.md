# GitHub Project Schema

Status: canonical

Use this schema for cross-repo work that moves from idea to production.

## Recommended Columns Or Views

- Inbox
- Discovery
- Proposal
- Needs ADR
- Planned
- In Progress
- In Review
- Ready To Merge
- Merged
- Deployed
- Archived

## Recommended Custom Fields

### `Repo Owner`

One of:

- `Soma`
- `claw-net`
- `pulse`
- `cross-repo`

### `Stage`

One of:

- `discovery`
- `proposal`
- `adr`
- `implementation`
- `review`
- `release`

### `Initiative Type`

One of:

- `protocol`
- `platform`
- `product`
- `ops`
- `docs`
- `security`

### `Needs ADR`

- `yes`
- `no`

### `First Consumer`

Examples:

- `claw-net`
- `pulse`
- `external package user`

### `Security Review`

- `required`
- `not-required`
- `complete`

### `Production Impact`

- `none`
- `low`
- `medium`
- `high`

### `Docs Updated`

- `yes`
- `no`

## Recommended Record Shapes

### Discovery Item

- short problem statement
- broad idea
- likely repo owner
- why it matters

### Proposal Item

- linked proposal doc
- first consumer
- security requirements
- slice plan

### Delivery Item

- parent issue
- sub-issues
- linked PRs
- deploy or publish consequence

## Rule

Do not let major ideas jump straight from vague chat to implementation if they change:

- trust model
- repo boundaries
- product scope
- production behavior
- release posture

For project automation, cross-owner Soma issues, and agent board maintenance rules, see [github-project-automation.md](github-project-automation.md).
