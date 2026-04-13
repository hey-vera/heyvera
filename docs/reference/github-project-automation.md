# GitHub Project Automation

Status: canonical

Use this file for the cross-repo `Soma + ClawNet + Pulse` project at <https://github.com/orgs/claw-net/projects/1>.

## Goal

The project board should support execution, not become a second job.

Issues, proposal docs, ADRs, PRs, and project fields are the durable system. The board is an index over that work, not the source of product truth.

## Solo-Dev Automation Posture

- Auto-add all new `claw-net` issues and PRs to the org project.
- Auto-add all new `pulse` issues and PRs to the org project.
- Add selected `1xmint/Soma` issues to the org project by GraphQL when they are part of a cross-repo initiative.
- Keep human approval for design acceptance, ADR acceptance, merge, deploy, publish, and policy-sensitive access.
- Prefer GraphQL for precise cross-owner Projects v2 updates, because the UI repo picker may not show external repos like `1xmint/Soma`.

## Workflow Secret

The `claw-net` and `pulse` repos use `.github/workflows/add-to-project.yml`.

They require a repository or organization secret named `ADD_TO_PROJECT_PAT` with enough access to:

- read the repo issue or PR event
- write to the `claw-net` org project

For a classic token, GitHub's `actions/add-to-project` docs call for `repo` and `project` scopes for private repos. Prefer a fine-grained token if available and practical: grant organization Projects read/write plus read-only issue and pull request access for the participating repos.

Until the secret exists, the workflow safely no-ops instead of failing every PR.

## External Soma Issues

`Soma` is intentionally separate under `1xmint/Soma`.

If the GitHub UI only shows `claw-net` org repos in the project picker, do not move Soma just to satisfy the UI. Use GraphQL to add the real Soma issue to the `claw-net` org project.

If GraphQL is unavailable, use a project draft item as a temporary proxy and paste the canonical Soma issue link in the draft description.

## PowerShell-Safe GraphQL Pattern

Use variables instead of inline quoted repo names in PowerShell. This avoids quoting bugs around names like `claw-net`.

```powershell
gh api graphql `
  -f login=claw-net `
  -f 'query=query($login:String!){ organization(login:$login) { id login projectsV2(first:10){ nodes { id number title url } } } }'
```
