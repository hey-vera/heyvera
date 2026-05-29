# ClawHub Skill Format Spec v1

Status: canonical


A **skill** is a reusable, publishable capability that any ClawNet agent or user can discover and invoke. Skills wrap orchestrator logic into a named, versioned unit with explicit inputs, outputs, and pricing.

---

## Skill Manifest (`skill.json`)

Every skill package in the `skills/` directory must include a `skill.json`:

```json
{
  "id": "token-analysis",
  "name": "token-analysis",
  "version": "1.0.0",
  "description": "Deep token analysis: price action, on-chain metrics, sentiment, and risk scoring for any Solana token.",
  "author": "clawhub-official",
  "price_credits": 5,
  "input_schema": {
    "type": "object",
    "required": ["token"],
    "properties": {
      "token": {
        "type": "string",
        "description": "Token symbol or mint address (e.g. SOL, BONK, or a mint pubkey)"
      },
      "depth": {
        "type": "string",
        "enum": ["quick", "standard", "deep"],
        "default": "standard",
        "description": "Analysis depth — quick is 1 API call, deep is full multi-source"
      }
    }
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "answer": { "type": "string", "description": "Human-readable analysis summary" },
      "opportunityScore": { "type": "number", "description": "0–10 opportunity rating" },
      "riskScore": { "type": "number", "description": "0–10 risk rating" },
      "suggestedActions": { "type": "array", "items": { "type": "string" } }
    }
  },
  "tags": ["defi", "solana", "token", "analysis"],
  "prompt_template": "Analyze the Solana token {{token}} with {{depth}} depth. Include price action, on-chain activity, holder concentration, social sentiment, and a risk/opportunity score."
}
```

---

## Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✅ | Unique slug, lowercase, hyphens only |
| `name` | string | ✅ | Display name (same as id in v1) |
| `version` | string | ✅ | Semver (e.g. `1.0.0`) |
| `description` | string | ✅ | 10–500 chars, shown in ClawHub registry |
| `author` | string | ✅ | Author identifier (api key prefix or handle) |
| `price_credits` | integer | ✅ | Minimum credits charged per invocation |
| `input_schema` | JSON Schema | ✅ | Zod-compatible JSON Schema for inputs |
| `output_schema` | JSON Schema | ✅ | JSON Schema describing response shape |
| `tags` | string[] | ✅ | Used for filtering and embedding context |
| `prompt_template` | string | ✅ | Handlebars-style template with `{{variable}}` placeholders |

---

## Variable Interpolation

Templates use `{{variableName}}` syntax. Every key in `input_schema.required` must appear in the template. Extra variables are optional and will be substituted if provided.

```
"Analyze {{token}} at {{depth}} depth"
→ called with { token: "SOL", depth: "quick" }
→ renders: "Analyze SOL at quick depth"
```

---

## Lifecycle

```
skill.json defined → POST /v1/skills (publish) → embedded into discovery_cache
                                               ↓
                                    POST /v1/skills/:id/invoke
                                               ↓
                                    reputation_events recorded
```

---

## Versioning

- Version follows semver: `MAJOR.MINOR.PATCH`
- Patch: prompt/template fix, no schema change
- Minor: new optional input field added
- Major: breaking input/output schema change
- Forking (Chunk 9) creates a new version with a `forked_from` provenance chain

---

## Revenue Share

When another user invokes your public skill, 10% of credits charged flows back to the skill author (capped at `revenue_share_pct`). This is recorded atomically in the same DB transaction as credit deduction.
