# GitHub Project Automation

Status: canonical

Use this file for the cross-repo `Soma + ClawNet + Pulse` project at <https://github.com/orgs/claw-net/projects/1>.

## Goal

The project board should support execution, not become a second job.

Humans and agents should use GitHub issues, proposal docs, ADRs, PRs, and project fields as the durable system. The board is an index over that work, not the source of product truth.

## Current Automation Posture

- Built-in GitHub Project workflows should handle routine issue and PR lifecycle movement where possible.
- GitHub Actions can auto-add issues and PRs to the project when labels or events match.
- `gh project` is useful for simple cases, but direct GraphQL is more reliable for cross-owner work like adding `1xmint/Soma` issues to the `claw-net` org project.
- Agents may update project fields through GraphQL after the user has approved the initiative shape or when the requested task clearly includes project maintenance.
- Agents must still ask before merge, deploy, publish, or any policy-sensitive access.

## What To Automate Now

Automate:

- add new `claw-net` and `pulse` issues to the org project
- add new `claw-net` and `pulse` PRs to the org project
- add selected `1xmint/Soma` issues to the org project by GraphQL when they are part of a cross-repo initiative
- set obvious fields such as `Repo Owner`, `Stage`, `Initiative Type`, `Needs ADR`, `First Consumer`, `Security Review`, `Production Impact`, and `Docs Updated`
- move proposal issues from `discovery` to `proposal` after a proposal doc exists
- move implementation issues toward `review` only after a PR exists
- mark `Docs Updated` as `yes` only when the relevant repo docs or ADRs were actually changed

Do not automate:

- high-risk design approval
- ADR acceptance
- merge approval
- deploy or publish approval
- emergency/manual VPS access decisions

## External Soma Issues

`Soma` is intentionally separate under `1xmint/Soma`.

If the GitHub UI only shows `claw-net` org repos in the project picker, do not move Soma just to satisfy the UI. Use GraphQL to add the real Soma issue to the `claw-net` org project.

If GraphQL is unavailable, use a project draft item as a temporary proxy and paste the canonical Soma issue link in the draft description.

## Proven GraphQL Pattern

Use variables instead of inline quoted repo names in PowerShell. This avoids quoting bugs around names like `claw-net`.

```powershell
gh api graphql `
  -f login=claw-net `
  -f 'query=query($login:String!){ organization(login:$login) { id login projectsV2(first:10){ nodes { id number title url } } } }'
```

Add an external issue by content ID:

```powershell
gh api graphql `
  -f projectId=<PROJECT_ID> `
  -f contentId=<ISSUE_ID> `
  -f 'query=mutation($projectId:ID!,$contentId:ID!){ addProjectV2ItemById(input:{projectId:$projectId, contentId:$contentId}){ item { id } } }'
```

Then set project metadata with `updateProjectV2ItemFieldValue`.

## Source Guidance

- GitHub's `actions/add-to-project` action can add issues and PRs to non-classic Projects and filter by labels.
- For private repos or org projects, that action requires a token with project access; choose this deliberately instead of casually spreading a broad PAT.
- GitHub's GraphQL Projects v2 API is the right layer for setting single-select field values precisely.

## Workflow Secret

The `claw-net` and `pulse` repos use `.github/workflows/add-to-project.yml`.

They require a repository or organization secret named `ADD_TO_PROJECT_PAT` with enough access to:

- read the repo issue or PR event
- write to the `claw-net` org project

For a classic token, GitHub's action docs call for `repo` and `project` scopes for private repos. Prefer a fine-grained token if available and practical: grant organization Projects read/write plus read-only issue and pull request access for the participating repos.

## Operating Rule

The board should be maintained by agents whenever the work already gives enough context to do so safely. The user should only be asked to use the UI when GitHub requires a human-only action, when permissions are missing, or when a decision has product/security consequences.
