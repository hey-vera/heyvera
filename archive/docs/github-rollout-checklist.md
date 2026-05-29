# GitHub Rollout Checklist

Status: canonical

This file defines the next GitHub-side activation steps for the repo system.

## Current State

- local repo structure is in place
- proposal templates exist
- issue templates exist
- PR templates exist
- CODEOWNERS exists
- project schema exists in [github-project-schema.md](github-project-schema.md)
- Discussions are enabled for `claw-net/claw-net`, `claw-net/pulse`, and `1xmint/Soma`
- the org-level project exists at <https://github.com/orgs/claw-net/projects/1>
- `gh` auth is working with `project`, `repo`, `workflow`, and `read:org` scopes
- cross-owner project membership works through the GitHub GraphQL API, even when the UI repo picker only shows `claw-net` org repos

## Enable Discussions

Use Discussions for early idea shaping before implementation.

Recommended categories:

- `Ideas`
  - for broad future concepts and architecture thinking
- `Q&A`
  - for questions and clarification
- `Announcements`
  - for maintainers only

Recommended scope:

- organization Discussions for cross-repo ideas
- repo Discussions for repo-local ideas

Relevant GitHub docs:

- [About Discussions](https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions)
- [Managing categories](https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions-in-your-repository)
- [Discussion category forms](https://docs.github.com/en/discussions/managing-discussions-for-your-community/creating-discussion-category-forms)

## Create GitHub Project

Create one org-level project for `Soma`, `claw-net`, and `pulse`.

Use the fields and stages from [github-project-schema.md](github-project-schema.md).

Minimum setup:

- views: board + table
- fields: `Repo Owner`, `Stage`, `Initiative Type`, `Needs ADR`, `First Consumer`, `Security Review`, `Production Impact`, `Docs Updated`
- automation: new issues land in `Inbox`

See [github-project-automation.md](github-project-automation.md) for the automation plan and the rule for external Soma issues.

## Rulesets

Consider rulesets after the new flow is actively used.

Start with:

- required PRs on protected branches
- required status checks
- required CODEOWNER review where useful
- block force-push to protected branches

Use merge queue only if branch throughput is high enough that it improves velocity rather than adding ceremony.

Relevant GitHub docs:

- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets?trk=public_post_comment-text)
- [Merge queue](https://docs.github.com/de/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

## Reusable Workflows And Vale

Defer these until the operating model settles.

When ready:

- centralize repeated CI/security workflow logic with reusable workflows
- add Vale when docs churn stabilizes enough to justify docs linting

Relevant docs:

- [Reusable workflow building blocks](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-pre-written-building-blocks-in-your-workflow?learn=getting_started)
- [Vale](https://vale.sh/)
