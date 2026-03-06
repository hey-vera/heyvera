# ClawNet Orchestrator

**The Universal Workflow Orchestration Layer for ClawAPIs & x402 APIs**

One natural language request. Automatic multi-API routing. Synthesized analysis with risk scores and actionable recommendations.

---

## 60-Second Quickstart

### 1. Clone and install
```bash
git clone https://github.com/1xmint/claw-net.git
cd claw-net
npm install
cp .env.example .env
```

### 2. Add your LLM key to .env
```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
```

### 3. Start the server
```bash
npm run dev
```

### 4. Send your first request
```bash
curl -X POST http://localhost:3402/v1/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"query": "Analyze BONK token: price, risk, and sentiment"}'
```

That's it. The orchestrator automatically selects the right APIs, runs them in parallel, and returns a synthesized analysis.

---

## How It Works

ClawNet takes one natural language query and runs it through 4 stages:

1. **Intent Parser** — An LLM reads your query and the API registry, then builds an execution plan
2. **Executor** — Runs all API calls in parallel where possible, checks cache first
3. **Synthesizer** — A second LLM call turns raw API data into a coherent analysis
4. **Cost Engine** — Calculates API costs + 15% markup, returns full cost breakdown

---

## API Reference

### POST /v1/orchestrate

Main endpoint. Send a natural language query, get a synthesized analysis.

**Request:**
```json
{
  "query": "Is BONK a safe investment right now?"
}
```

**Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key (required when API_KEYS is set in .env)
```

**Response:**
```json
{
  "requestId": "abc123",
  "answer": "Full analysis text...",
  "opportunityScore": 65,
  "riskScore": 35,
  "suggestedActions": ["Action 1", "Action 2"],
  "costBreakdown": {
    "apiCosts": 0.012,
    "markup": 0.0018,
    "total": 0.0138,
    "savings": 0.002
  },
  "metadata": {
    "stepsExecuted": 4,
    "cacheHits": 1,
    "totalDurationMs": 2340,
    "llmProvider": "openai",
    "simulationMode": true
  },
  "route": {
    "summary": "Multi-step token analysis",
    "steps": []
  }
}
```

### GET /v1/health

Returns server status, cache stats, and usage metrics. No auth required.

### GET /v1/registry

Lists all 15 available API endpoints grouped by category. No auth required.

### GET /v1/usage

Returns recent request history and aggregate stats.

### POST /v1/feedback

Submit feedback on a response.

**Request:**
```json
{
  "requestId": "abc123",
  "rating": 5,
  "comment": "Great analysis!"
}
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| PORT | No | 3402 | HTTP server port |
| NODE_ENV | No | development | development or production |
| LLM_PROVIDER | No | anthropic | anthropic, openai, or openclaw |
| ANTHROPIC_API_KEY | If provider | - | Anthropic API key |
| OPENAI_API_KEY | If provider | - | OpenAI API key |
| CLAWAPIS_API_KEY | Phase 2 | your-clawapis-key | Leave as placeholder for simulation mode |
| REDIS_URL | No | - | Redis connection string. Empty = memory cache only |
| MARKUP_PERCENT | No | 15 | Markup percentage added to API costs |
| API_KEYS | No | - | Comma-separated valid API keys for auth |
| RATE_LIMIT_PER_MIN | No | 60 | Max requests per IP per minute |
| LOG_LEVEL | No | info | debug, info, warn, or error |

---

## Deployment

### Docker (recommended)
```bash
# Copy and fill in your .env
cp .env.example .env

# Start orchestrator + Redis
docker compose up -d --build

# Check logs
docker compose logs -f orchestrator

# Health check
curl http://localhost:3402/v1/health
```

### Manual (Node.js)
```bash
npm run build
npm start
```

---

## Available API Endpoints (15)

### Solana/Crypto (8)
- `claw-token-metadata` — Token name, symbol, supply, social links
- `claw-token-price` — Current price, 24h change, volume, market cap
- `claw-token-holders` — Holder count, whale concentration
- `claw-token-risk` — AI rug pull risk score 0-100
- `claw-wallet-portfolio` — All token holdings and USD values
- `claw-tx-history` — Recent transaction history
- `claw-trending-tokens` — Currently trending tokens by volume
- `claw-wallet-risk` — Wallet suspicious activity analysis

### Social/Sentiment (5)
- `claw-x-mentions` — X/Twitter mentions and sentiment
- `claw-x-profile` — X/Twitter profile data
- `claw-linkedin-profile` — LinkedIn profile data
- `claw-instagram-check` — Instagram account metrics
- `claw-reddit-sentiment` — Reddit sentiment analysis

### Utility (2)
- `claw-web-scrape` — Extract text from any public URL
- `claw-news-search` — Recent crypto news search

---

## Troubleshooting

**Server won't start**
- Check `.env` exists: `cp .env.example .env`
- Check Node version: `node -v` should be 22.x
- Check port isn't in use: `netstat -ano | findstr :3402`

**INTENT_PARSE_FAILED error**
- Your LLM API key is missing or invalid
- Check `LLM_PROVIDER` matches which key you set
- Try `LOG_LEVEL=debug` to see full LLM prompts

**All responses show simulationMode: true**
- This is correct until you set a real `CLAWAPIS_API_KEY`
- Simulation mode returns mock data and costs $0

**401 Invalid API Key**
- Add `X-API-Key: your-key` header to requests
- Or clear `API_KEYS=` in `.env` to disable auth

**Cache not working**
- Check Redis: `docker compose ps` should show redis as healthy
- Set `REDIS_URL=redis://localhost:6379` in `.env`

---

## Architecture
```
User Query
    │
    ▼
Intent Parser (LLM call 1)
    │ ParsedIntent
    ▼
Executor (parallel API calls + cache)
    │ ExecutionResult
    ▼
Synthesizer (LLM call 2)
    │ FormattedResponse
    ▼
Cost Engine (markup calculation)
    │
    ▼
JSON Response
```

---

## License

MIT