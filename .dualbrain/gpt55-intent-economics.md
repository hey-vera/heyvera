I’ll verify current provider pricing first, then compute the blended economics from the layer distribution. I’ll keep assumptions explicit because the answer depends heavily on token counts and whether “one orchestration call” includes only intent routing or downstream model execution.
The pricing surface has shifted: OpenAI’s current official pricing page now centers GPT-5.4/5.5, while GPT-4.1-mini remains available on its model page. I’ll use current direct API prices where official pages expose them, and I’ll call out when I’m using a model as a proxy for the layer.
Below is a unit economics model for the Cortex 4-layer intent pipeline using current public pricing I could verify today, May 19, 2026.

**Pricing Sources**
OpenAI official pricing lists `gpt-5.5` at `$5/M input` and `$30/M output`, `gpt-5.4-mini` at `$0.75/M input` and `$4.50/M output`, and batch/flex discounts at 50% for eligible work. OpenAI’s model page still lists `gpt-4.1-mini` at `$0.40/M input`, `$0.10/M cached input`, `$1.60/M output`. Anthropic lists Claude Haiku 3.5 at `$0.80/M input`, `$4/M output`, and Claude Opus 4.1 at `$15/M input`, `$75/M output`. OpenRouter says model prices match listed provider prices and charges platform/funding/BYOK fees depending on mode. Together’s public pricing shows small open models from roughly `$0.06-$0.10/M input` and `$0.12-$0.15/M output` for low-end models. DigitalOcean’s 16 GB droplet is `$96/mo`; Backblaze B2 is about `$0.005/GB-mo`; Portkey Production is `$49/mo` for 100k logs plus `$9/100k` overage.

Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT-4.1-mini pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Anthropic pricing](https://docs.claude.com/en/docs/about-claude/pricing), [Together pricing](https://www.together.ai/pricing), [OpenRouter pricing](https://openrouter.ai/pricing), [Portkey pricing](https://portkey.ai/pricing), [DigitalOcean droplets](https://www.digitalocean.com/pricing/droplets), [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/transaction-pricing).

**Core Assumptions**
Base query volume: `50 queries/day/user * 30 days = 1,500 queries/user/month`.

Layer mix:

| Layer | Share | Mechanism |
|---|---:|---|
| L1 | 70.0% | regex/keyword |
| L2 | 25.0% | local ONNX embedding + vector search |
| L3 | 4.9% | small constrained LLM |
| L4 | 0.1% | frontier fallback |

Token assumption for intent classification:

| Layer | Input | Output |
|---|---:|---:|
| L3 | 800 tokens | 80 tokens |
| L4 | 1,000 tokens | 120 tokens |

These are intentionally conservative for a constrained JSON classifier. If Cortex sends long tool schemas, long history, or candidate catalogs, costs scale linearly.

**1. Cost Per Query By Layer**
Formula:  
`cost = input_tokens * input_price / 1,000,000 + output_tokens * output_price / 1,000,000`

| Layer | Model / Method | Per-hit Cost | Cost / 1M Hits |
|---|---|---:|---:|
| L1 | Regex/keyword | `$0.000000` | `$0` |
| L2 | Local ONNX embedding + in-process/vector lookup | `~$0.000001` | `~$1` |
| L3 | GPT-4.1-mini | `(800*$0.40 + 80*$1.60)/1M = $0.000448` | `$448` |
| L3 | Claude Haiku 3.5 | `(800*$0.80 + 80*$4)/1M = $0.000960` | `$960` |
| L3 | GPT-5.4-mini | `(800*$0.75 + 80*$4.50)/1M = $0.000960` | `$960` |
| L4 | GPT-5 legacy/current proxy | `(1000*$1.25 + 120*$10)/1M = $0.002450` | `$2,450` |
| L4 | GPT-5.5 | `(1000*$5 + 120*$30)/1M = $0.008600` | `$8,600` |
| L4 | Claude Opus 4.1 | `(1000*$15 + 120*$75)/1M = $0.024000` | `$24,000` |

Blended base case with GPT-4.1-mini for L3 and GPT-5 for L4:

`0.70*$0 + 0.25*$0.000001 + 0.049*$0.000448 + 0.001*$0.00245`

`= $0.000024652/query`

That is about `$24.65 per 1M Cortex intent queries`.

**2. Monthly Cost Per User At 50 Queries/Day**
`1,500 queries/month * $0.000024652 = $0.036978/user/month`

Breakdown:

| Component | Monthly Hits/User | Unit Cost | Monthly Cost/User |
|---|---:|---:|---:|
| L1 | 1,050 | `$0` | `$0.0000` |
| L2 | 375 | `$0.000001` | `$0.0004` |
| L3 | 73.5 | `$0.000448` | `$0.0329` |
| L4 | 1.5 | `$0.00245` | `$0.0037` |
| Total | 1,500 | blended | `$0.0370` |

Sensitivity:

| L3 + L4 Choice | Blended Cost/Query | Cost/User/Month |
|---|---:|---:|
| GPT-4.1-mini + GPT-5 | `$0.00002465` | `$0.0370` |
| GPT-4.1-mini + GPT-5.5 | `$0.00003080` | `$0.0462` |
| GPT-4.1-mini + Opus 4.1 | `$0.00004620` | `$0.0693` |
| Haiku 3.5 + GPT-5 | `$0.00004974` | `$0.0746` |
| Haiku 3.5 + Opus 4.1 | `$0.00007129` | `$0.1069` |
| Local L3 + GPT-5 | `~$0.00000368` | `~$0.0055` |

The main point: the pipeline economics are dominated by whether L3 is API or local and how often L4 fires. At only 0.1%, even Opus is survivable.

**3. Monthly Infrastructure Cost**
Base case: GPT-4.1-mini L3, GPT-5 L4, local L2. This excludes support payroll and product analytics beyond basic observability.

Query volumes:

| Users | Queries/Month | Avg QPS | L3 Calls/Month | L4 Calls/Month |
|---:|---:|---:|---:|---:|
| 1K | 1.5M | 0.58 | 73,500 | 1,500 |
| 10K | 15M | 5.79 | 735,000 | 15,000 |
| 100K | 150M | 57.9 | 7.35M | 150,000 |

Cost model:

| Users | Server | Redis/Cache | Storage/Backups | Observability | LLM API | L2 CPU Allocation | Total | Cost/User |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1K | `$60` | `$0` | `$10` | `$25` | `$36.60` | `$0.38` | `$131.98` | `$0.132` |
| 10K | `$240` | `$50` | `$35` | `$100` | `$366.03` | `$3.75` | `$794.78` | `$0.079` |
| 100K | `$1,800` | `$300` | `$250` | `$650` | `$3,660.30` | `$37.50` | `$6,697.80` | `$0.067` |

This is credible for a single-process Node/Hono + SQLite WAL architecture up to meaningful scale if the intent layer stays CPU-cheap and L4 is capped. At 100K users, peak QPS matters more than monthly volume. If peak is 5x average, you need to handle roughly `290 QPS`, with about `72 QPS` hitting L2 embeddings. That is still plausible on a few strong CPU boxes, but you should load-test the ONNX path.

**4. Gross Margin At $7.99, $14.99, $29.99**
Pure infra gross margin:

| Users | Cost/User | GM @ $7.99 | GM @ $14.99 | GM @ $29.99 |
|---:|---:|---:|---:|---:|
| 1K | `$0.132` | `98.35%` | `99.12%` | `99.56%` |
| 10K | `$0.079` | `99.01%` | `99.47%` | `99.73%` |
| 100K | `$0.067` | `99.16%` | `99.55%` | `99.78%` |

After card processing, assuming `2.9% + $0.30`:

| Price | Net Revenue/User | GM After Infra + Payment @ 10K Users |
|---:|---:|---:|
| `$7.99` | `$7.458` | `98.93% of net revenue` |
| `$14.99` | `$14.255` | `99.44% of net revenue` |
| `$29.99` | `$28.820` | `99.72% of net revenue` |

The subscription is not constrained by intent-routing cost. It is constrained by abuse, downstream model usage, support, auth/payment overhead, and whether “unlimited” users can trigger expensive actions outside this classifier.

**5. x402 Pricing For Agent/API Access**
Do not price x402 at raw COGS. Raw blended COGS is only `$0.00002465/call`, but that ignores abuse, retries, observability, fraud, rate-limit state, and product margin.

Recommended pricing:

| Product | Price / Orchestration Call | Notes |
|---|---:|---|
| Basic intent route | `$0.00025` | 10x raw COGS, simple fixed price |
| Verified route with audit/logging | `$0.00050` | good default for agents |
| LLM fallback allowed | `$0.00100` | covers L3 variance and abuse |
| Frontier override | dynamic: `model_cost * 1.3 + $0.00025` | quote before execution |

Best design: fixed price for normal orchestration, dynamic quote for frontier escalation.

Why: agents need predictable pricing, but you need protection against requests that force L3/L4. Use an x402 quote response like:

`price = base_route_fee + max_expected_model_fee + risk_fee`

Practical default: charge agents `$0.0005` per normal Cortex orchestration call. That is `$0.50 per 1,000 calls` or `$500 per 1M calls`. Your raw COGS at base mix is about `$24.65 per 1M`, so gross margin is about `95%` before payment/network overhead.

**6. Vector Store Comparison**
For the L2 embedding layer:

| Option | Best For | Cost | Pros | Cons |
|---|---|---:|---|---|
| In-memory vectors | intent patterns up to ~100K | near-zero | fastest, simplest, no daemon | restart load, RAM-bound, no durable index |
| SQLite FTS5 | keyword/lexical fallback | near-zero | already fits SQLite stack, great for exact/partial text | not true embedding similarity |
| SQLite + vector extension | small durable semantic store | near-zero | keeps single-file architecture | less mature than Qdrant |
| Qdrant embedded | 100K-5M vectors | server CPU/RAM only | real HNSW vector search, filters, persistence | more moving parts, Rust/native dependency |

Memory math for embeddings:

`vectors * dimensions * bytes`

For 384-dim float32 embeddings:

| Vectors | Raw Vector RAM |
|---:|---:|
| 10K | `10,000*384*4 = 15.4 MB` |
| 100K | `153.6 MB` |
| 1M | `1.54 GB` |

Recommendation: keep Cortex intent patterns in memory until you exceed 100K-250K patterns. Use SQLite FTS5 as lexical fallback/audit search. Move to Qdrant embedded when you need HNSW indexing, metadata filters, or million-scale pattern catalogs.

**7. Local Layer 3 In Rust With candle/llama.cpp**
Yes, but only if the L3 task is truly constrained classification.

Good candidates:

| Local Model | RAM Quantized | Quality | Use |
|---|---:|---|---|
| Phi-3/Phi-3.5 mini | ~2-4 GB | decent | constrained intent JSON |
| Qwen 2.5/3 3B-7B | ~3-6 GB | better multilingual/tool-ish behavior | stronger local classifier |
| Llama 3.1/3.2 8B | ~5-8 GB | stronger but slower | higher-accuracy local fallback |

Cost tradeoff:

At 100K users, L3 calls are `7.35M/month`.

API GPT-4.1-mini L3 cost:

`7.35M * $0.000448 = $3,292.80/month`

If local L3 needs `$300-$800/month` of extra CPU/GPU capacity, it wins financially at 100K users.

At 1K users, L3 calls are only `73,500/month`.

API cost:

`73,500 * $0.000448 = $32.93/month`

A dedicated local model host may lose money at small scale unless it runs on the same box.

Quality tradeoff: GPT-4.1-mini/Haiku will be more stable on ambiguous language, long-tail domains, and adversarial prompts. Local L3 is economically attractive if you have a tight schema, small label set, strong eval suite, and confidence thresholds that still send uncertainty to L4.

**8. Competitive Pricing**
Cortex should not compete with OpenRouter/Together on raw model tokens. It should compete as an intent/orchestration control plane.

| Competitor | Pricing Basis | Implication |
|---|---|---|
| OpenRouter | provider token price, funding/BYOK platform fees | great model marketplace; not specialized intent pipeline |
| Together.ai | cheap open-model inference, small models around cents per million tokens | good for hosted open L3 if local ops are unwanted |
| Portkey | gateway/observability, `$49/mo` + log overages | useful for production LLM observability; expensive if logging every Cortex intent call |

Portkey hosted math if every orchestration call is logged:

| Users | Calls/Month | Portkey Production Estimate |
|---:|---:|---:|
| 1K | 1.5M | `$49 + 14*$9 = $175` |
| 10K | 15M | `$49 + 149*$9 = $1,390` |
| 100K | 150M | `$49 + 1,499*$9 = $13,540` |

So do not put every L1/L2 intent call through a paid LLM gateway log product. Log samples, errors, L3/L4 calls, and billing-relevant events.

**Bottom Line**
At the stated `70/25/4.9/0.1` mix, Cortex intent routing is extremely cheap: about `$0.037/user/month` in model+local compute at 50 queries/day, or roughly `$24.65 per 1M intent calls`.

The economically correct offer is:

`$7.99/mo unlimited humans` is safe for intent routing alone.

For agents, charge a fixed `$0.0005` per normal orchestration call, with dynamic quoted pricing for frontier escalation. Keep L1/L2 local, use GPT-4.1-mini or local Qwen/Phi for L3, and cap L4 with budget/rate policy.
