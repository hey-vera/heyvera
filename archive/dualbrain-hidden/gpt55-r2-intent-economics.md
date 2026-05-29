I’ll verify the provider prices first, then run the unit economics from those source numbers instead of relying on the earlier estimate. After that I’ll separate subscription usage from x402 agent-call pricing so the margin picture is explicit.
The current pricing has shifted materially from the older briefing: OpenAI’s visible current flagship table is GPT-5.5/5.4 rather than plain “GPT-5”, and Anthropic’s current Opus is Opus 4.7 at $5/$25 per MTok, with old Opus 4.1/4 still listed at $15/$75. I’m going to model the intended “frontier” layer on current Opus 4.7 unless noted, and also show the older Opus price as the downside case.
**Bottom Line**

With current verified retail API prices, the $0.13-$0.15/user/month finding is conservative for model cost. Under the stated 70/25/4.9/0.1 split and 1,500 queries/month, the direct model cost is about **$0.049/user/month** if Layer 4 uses current Claude Opus 4.7, or **$0.053/user/month** if Layer 2 uses OpenAI embeddings instead of local ONNX.

The kill answer: **yes, $7.99 flat-rate is sustainable at 100K users with 5% power users doing 500 queries/day, but only if the routing split is enforced and “agent/API traffic” is excluded from the subscription and billed via x402.** If power users can run unconstrained frontier/tool/agent loops, flat-rate breaks.

**Verified Prices**

Sources checked May 19, 2026:

- OpenAI GPT-4.1 mini: **$0.40/1M input**, **$1.60/1M output**. Source: [OpenAI GPT-4.1 mini model page](https://platform.openai.com/docs/models/gpt-4.1-mini)
- OpenAI GPT-5: **$1.25/1M input**, **$10/1M output**. Source: [OpenAI GPT-5 model page](https://developers.openai.com/api/docs/models/gpt-5)
- OpenAI GPT-5.5: **$5/1M input**, **$30/1M output**. Source: [OpenAI models page](https://developers.openai.com/api/docs/models)
- OpenAI text-embedding-3-small: **$0.02/1M tokens**. Source: [OpenAI embedding pricing/search result](https://openai.com/api/pricing/)
- Anthropic Claude Haiku 4.5: **$1/1M input**, **$5/1M output**. Source: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Anthropic Claude Opus 4.7/4.6/4.5: **$5/1M input**, **$25/1M output**. Older Opus 4.1/4: **$15/$75**. Source: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

Assumption per query: **500 input tokens + 200 output tokens**.

**Per-Query Cost**

Formula: `(input_tokens * input_price + output_tokens * output_price) / 1,000,000`

| Layer / Model | Math | Cost/query |
|---|---:|---:|
| Layer 1 deterministic | CPU only | ~$0 |
| Layer 2 local ONNX embedding | local | ~$0 |
| Layer 2 OpenAI embedding fallback | `500 * $0.02 / 1M` | **$0.000010** |
| Layer 3 GPT-4.1 mini | `(500*$0.40 + 200*$1.60)/1M` | **$0.000520** |
| Haiku 4.5 alternative | `(500*$1 + 200*$5)/1M` | **$0.001500** |
| GPT-5 | `(500*$1.25 + 200*$10)/1M` | **$0.002625** |
| GPT-5.5 | `(500*$5 + 200*$30)/1M` | **$0.008500** |
| Claude Opus 4.7 | `(500*$5 + 200*$25)/1M` | **$0.007500** |
| Claude Opus 4.1 old/downside | `(500*$15 + 200*$75)/1M` | **$0.022500** |

**Subscription Cost Model**

1,500 queries/month/user:

- Layer 1: `70% * 1,500 = 1,050` queries
- Layer 2: `25% * 1,500 = 375` queries
- Layer 3: `4.9% * 1,500 = 73.5` queries
- Layer 4: `0.1% * 1,500 = 1.5` queries

Using local Layer 2, GPT-4.1 mini Layer 3, Claude Opus 4.7 Layer 4:

- Layer 1: `$0`
- Layer 2 local: `$0`
- Layer 3: `73.5 * $0.000520 = $0.03822`
- Layer 4: `1.5 * $0.007500 = $0.01125`
- Total: **$0.04947/user/month**

If Layer 2 uses OpenAI `text-embedding-3-small` instead of local ONNX:

- Layer 2: `375 * $0.000010 = $0.00375`
- Total: **$0.05322/user/month**

Downside if Layer 4 accidentally uses old Opus 4.1 pricing:

- Layer 4: `1.5 * $0.022500 = $0.03375`
- Total: `$0.03822 + $0.03375 = $0.07197/user/month`

So the earlier **$0.13-$0.15** is not contradicted; it is just above current direct model COGS unless it includes observability, infra, retries, abuse, tools, and margin buffer.

**Infrastructure**

Verified infra anchors:

- Fly.io shared 2x / 4GB is roughly **$21-$28/month** depending region; performance 2x / 4GB is **$64.39/month** in the listed table. Source: [Fly.io pricing](https://fly.io/docs/about/pricing/)
- Hetzner April 2026 adjusted pricing lists CAX31 at **$18.49/month** and CPX31 at **$24.99/month** for Germany/Finland pricing table. Source: [Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)

Traffic with normal users:

- 1K users: `1,500,000 queries/month`, avg `0.58 qps`
- 10K users: `15,000,000/month`, avg `5.8 qps`
- 100K users: `150,000,000/month`, avg `58 qps`

With 5% power users at 500/day:

- Normal users: `95% * 1,500 = 1,425 avg queries`
- Power users: `5% * 15,000 = 750 avg queries`
- Blended: `2,175 queries/user/month`
- 100K users: `217,500,000/month`, avg `84 qps`

Rust/Axum can handle that on modest app fleets if DB/cache paths are sane. Practical monthly infra estimates:

| Scale | Hetzner-style app/core infra | Fly.io-style app/core infra |
|---:|---:|---:|
| 1K users | **$50-$150/mo** | **$75-$250/mo** |
| 10K users | **$150-$500/mo** | **$300-$1,000/mo** |
| 100K users | **$800-$3,000/mo** | **$2,000-$8,000/mo** |

That is **$0.008-$0.03/user/month** at 100K on Hetzner-like infra, or **$0.02-$0.08/user/month** on Fly-like infra, before heavy logging, data retention, CDN, support tooling, and managed DB choices.

**Gross Margin at $7.99**

Stripe online card pricing is **2.9% + $0.30**. Source: [Stripe pricing](https://stripe.com/pricing)

- Stripe fee: `($7.99 * 2.9%) + $0.30 = $0.53171`
- Net after Stripe: `$7.99 - $0.53171 = $7.45829`

Normal usage:

- Model COGS: `$0.04947`
- Infra allowance, say: `$0.03-$0.08`
- Gross profit after Stripe/model/infra: about `$7.33-$7.38`
- Gross margin on sticker price: about **91.7%-92.4%**

Power-user mix:

- Blended queries: `2,175/month`
- Layer 3 calls: `2,175 * 4.9% = 106.575`
- Layer 4 calls: `2,175 * 0.1% = 2.175`
- Model cost: `(106.575 * $0.000520) + (2.175 * $0.007500) = $0.07173/user/month`
- Still very sustainable.

The real danger is not “5% do 500/day” under the stated pipeline. The danger is pipeline drift.

Example: if Layer 4 becomes 5% instead of 0.1%:

- Opus calls: `1,500 * 5% = 75`
- Opus cost: `75 * $0.0075 = $0.5625`
- Layer 3 unchanged: `$0.03822`
- Total: **$0.60072/user/month**

Still survivable, but no longer negligible.

If a power user runs all 15,000 monthly queries through Opus:

- `15,000 * $0.0075 = $112.50/user/month`

That destroys flat-rate economics. This is why agents and API access must be x402-metered.

**x402 Agent Call Pricing**

For one 500-in / 200-out agent orchestration call:

Small orchestration path:

- GPT-4.1 mini only: **$0.000520**
- Add infra/signing/receipt overhead buffer: call it **$0.0007-$0.0010 cost basis**
- 70% gross margin price: `cost / 0.30 = $0.0023-$0.0033`
- 80% gross margin price: `cost / 0.20 = $0.0035-$0.0050`

Recommended x402 price: **$0.003-$0.005** for small agent orchestration.

Frontier orchestration path:

- GPT-4.1 mini router + Opus 4.7: `$0.000520 + $0.007500 = $0.008020`
- Add platform overhead: **~$0.009 cost basis**
- 70% margin price: `$0.009 / 0.30 = $0.030`
- 80% margin price: `$0.009 / 0.20 = $0.045`

Recommended x402 price: **$0.03-$0.05** for frontier-backed orchestration.

Comparison:

- OpenRouter says it passes through provider pricing with no inference markup, but charges a **5.5% credit purchase fee, $0.80 minimum**. Source: [OpenRouter FAQ](https://openrouter.ai/docs/faq)
- Together.ai examples: `gpt-oss-120B` is **$0.15/$0.60 per 1M**, Qwen3.5 9B is **$0.10/$0.15**, Llama 3.3 70B is **$0.88/$0.88**. Source: [Together pricing](https://www.together.ai/pricing)

Per 500/200 call:

- Together `gpt-oss-120B`: `(500*$0.15 + 200*$0.60)/1M = $0.000195`
- Together Qwen3.5 9B: `(500*$0.10 + 200*$0.15)/1M = $0.000080`
- Together Llama 3.3 70B: `(500*$0.88 + 200*$0.88)/1M = $0.000616`

So x402 should not compete as “cheapest token API.” It should price the **orchestration + trust receipt + provenance + payment gating** product.

**Local Phi-3 Feasibility**

Phi-3 mini is a **3.8B parameter** model. Source: [Microsoft Phi-3 mini Hugging Face card](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct)

Candle supports Phi-3 and is a Rust ML framework with CPU/GPU support. Source: [Hugging Face Candle repo](https://github.com/huggingface/candle)

Memory reality:

- FP16 weights: `3.8B * 2 bytes = 7.6GB` before KV cache/runtime
- INT4 weights: `3.8B * 0.5 bytes = 1.9GB` before KV cache/runtime
- Practical 4-bit runtime: roughly **2.5-5GB RAM/VRAM** for short context
- Long context can dominate memory via KV cache, especially 128K variants

When local is cheaper:

- GPT-4.1 mini Layer 3 cost is `$0.00052/query`
- A $25/month Hetzner CPX31 equals `~48,077 GPT-4.1-mini calls/month` before electricity/ops: `$25 / $0.00052`
- If one local small-model server can reliably handle more than ~50K Layer-3-equivalent queries/month at acceptable latency and quality, local can beat API on cost.
- At 100K users, Layer 3 volume is `100,000 * 73.5 = 7.35M calls/month`; local small models are economically compelling if quality is acceptable.

But local small models should be treated as Layer 2.5/3 fallback only. They reduce cost and latency, but quality drift and operations are the hidden tax.

**Kill Question**

Yes, **$7.99 flat-rate is sustainable at 100K users with 5% power users** under the stated split:

- Normal blended model COGS: **$0.049/user/month**
- Power-user blended model COGS: **$0.072/user/month**
- Stripe cost: **$0.532/user/month**
- Likely infra at 100K: **$0.01-$0.08/user/month**
- Gross margin still roughly **91%-92%**

But the subscription must have hard policy boundaries:

- Humans only.
- No autonomous loops.
- No unrestricted tool calls.
- No unlimited frontier usage.
- Agent/API calls go to x402.
- Web search/container/tool calls require separate metering. OpenAI web search alone is **$10/1K calls = $0.01/call**, meaning 1,500 searched queries would cost **$15/user/month** before model tokens.

The business works if Cortex remains a deterministic-first human orchestration layer. It fails if “unlimited human access” becomes unlimited agent execution.
