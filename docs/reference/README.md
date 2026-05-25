# Reference

Status: canonical

Use this folder for factual, current-state material:

- API contracts
- billing rules
- integration contracts
- config or environment reference
- production completion checklists
- repo boundary/source-of-truth documents
- current implementation inventories that prevent stale docs from being treated as shipped truth

Do not put roadmaps, speculative designs, or historical notes here.

## HeyVera

- `heyvera-backend-api-contract.md` - backend HTTP contract expected by the
  current HeyVera frontend.
- `heyvera-production-checklist.md` - production completion gates for
  Cloudflare Pages, same-domain `/v1/*`, release smoke, and rollback.
