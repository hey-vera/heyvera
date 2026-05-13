# Review Rules

Project-specific rules for the dual-brain GPT review. Edit these for your repo.

## Framework & Tooling
- Must use Hono, not Fastify
- Must use npm, not pnpm
- Must use better-sqlite3 with raw SQL, no ORM

## Code Patterns
- Use round6() for all credit math
- Use maskApiKey(), never raw .slice() for key masking
- Import DB helpers from src/db/index.ts, not domain files

## Data Integrity
- Soma origin does not prove factual truth
