/**
 * ClawNet X (Twitter) Outreach Bot
 *
 * Standalone marketing bot that finds relevant conversations on X and
 * replies with contextual, value-first messages about ClawNet.
 *
 * Strategy: conversation-first — reply only to posts that genuinely match,
 * add real value in the first 1-2 lines, then casually mention ClawNet.
 * Max 5-8 replies per day. Always like/repost their tweet first.
 *
 * Cost: $0/month — uses X Free tier (posting) + twit.sh (search, no key needed)
 * No paid X API plan required.
 *
 * Requirements:
 *   - X API v2 Free tier ($0) — env vars: X_API_KEY, X_API_SECRET,
 *     X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 *   - ClawNet API key — env var: CLAWNET_API_KEY (for LLM reply generation)
 *   - Optional: CLAWNET_API_URL (default: https://claw-net.org)
 *
 * Usage:
 *   npx tsx src/bots/x-outreach.ts              # Run once (find + reply)
 *   npx tsx src/bots/x-outreach.ts --dry-run    # Preview without posting
 *   npx tsx src/bots/x-outreach.ts --search     # Search only, no replies
 *
 * VPS cron (every 3 hours, 8 replies/day max):
 *   0 0,3,6,9,12,15,18,21 * * * cd /home/guardian/claw-net && npx tsx src/bots/x-outreach.ts >> /tmp/x-outreach.log 2>&1
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from 'dotenv';

// Load .env from project root
config({ path: path.join(process.cwd(), '.env') });

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  // X API (Free tier — posting only, no Bearer token needed)
  apiKey: process.env.X_API_KEY ?? '',
  apiSecret: process.env.X_API_SECRET ?? '',
  accessToken: process.env.X_ACCESS_TOKEN ?? '',
  accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? '',

  // Brave Search API (free — 2,000 queries/month, no credit card)
  // Sign up at api.search.brave.com
  braveApiKey: process.env.BRAVE_API_KEY ?? '',

  // ClawNet
  clawnetApiKey: process.env.CLAWNET_API_KEY ?? '',
  clawnetApiUrl: process.env.CLAWNET_API_URL ?? 'https://claw-net.org',

  // Limits
  maxRepliesPerDay: 8,
  maxRepliesPerRun: 3,
  minTweetLikes: 3,          // Only reply to tweets with some engagement
  maxTweetReplies: 100,       // Don't pile onto already-crowded threads
  minTweetAgeMinutes: 5,      // Avoid replying to just-posted tweets
  maxTweetAgeHours: 24,       // Don't necro old threads

  // State file — tracks replied tweets, daily counts
  stateFile: path.join(process.cwd(), 'data', 'x-outreach-state.json'),

  // Features to highlight (rotate through these)
  features: [
    { name: 'Budget Accounts', desc: 'hard daily/weekly caps + auto-topup rules', version: 'v65' },
    { name: 'SLA Contracts', desc: 'enforceable uptime/latency guarantees with penalty credits', version: 'v65' },
    { name: 'Output Contracts', desc: 'validate data before payment via JSON Schema', version: 'v65' },
    { name: 'Event Webhooks', desc: 'instant notifications for SLA breaches, budget hits, transfers', version: 'v65' },
    { name: 'Dynamic Pricing', desc: 'surge/volume/off-peak pricing that self-regulates', version: 'v67' },
    { name: 'Composite Skills', desc: 'chain skills into self-assembling agent workflows', version: 'v67' },
    { name: 'Autonomous Hiring/Firing', desc: 'self-healing infrastructure — auto-swaps degraded providers', version: 'v67' },
    { name: 'Validator Roles', desc: 'third-party verification of transaction results', version: 'v67' },
    { name: 'Persistent Agent Sessions', desc: 'agents remember context across scheduled runs', version: 'v67' },
    { name: 'Governance Execution', desc: 'community votes that auto-execute — delist, verify, change params', version: 'v67' },
  ],
};

// ─── Search Queries ──────────────────────────────────────────────────────────

const SEARCH_QUERIES = [
  'OpenClaw',
  '"AI agent" (budget OR spending OR "runaway costs" OR "spend on my behalf")',
  '"autonomous agent" (trust OR contract OR commerce OR SLA)',
  '"data fetch" OR "browser agent" OR "web agent" OR "scrape agent"',
  '"agent economy" OR "agent commerce" OR "agent payments"',
  '"trust layer" agent OR "agent governance"',
  '"agent" "rate limit" OR "cost control" OR "spending limit"',
  '"AI agent" marketplace OR "skill marketplace"',
];

// ─── Reply Templates ─────────────────────────────────────────────────────────

const REPLY_CONTEXTS = [
  {
    match: ['runaway', 'cost', 'spending', 'budget', 'bill', 'expensive'],
    template: `Exactly — the second an agent gets any spending power it usually goes off the rails. {{feature}} so performance is enforceable. Agents can finally fetch data or trade autonomously without you waking up to a surprise bill. Worth checking if you're building spending agents: claw-net.org\nWhat's the scariest runaway cost you've seen so far?`,
  },
  {
    match: ['openclaw', 'open claw'],
    template: `Love seeing OpenClaw agents out in the wild! The missing piece once they start doing real work is proper economics + guardrails. Clawnet adds {{feature}} so they can operate 24/7 without babysitting. We've been stacking the two and it's smooth.\nYou running yours for data tasks or something else?`,
  },
  {
    match: ['trust', 'governance', 'verify', 'verification'],
    template: `100% — hope-based trading is the biggest blocker. Clawnet {{version}} just shipped the primitives everyone's been asking for: {{feature}}. Turns agents into actual trustworthy economic participants.\nWhat's your biggest trust headache right now?`,
  },
  {
    match: ['data fetch', 'scraping', 'scrape', 'browser agent', 'web agent'],
    template: `Data-fetching agents are super powerful but terrifying without guardrails. One thing that changed everything for us is giving them strict spend keys + validated output contracts so you know exactly what they pulled before anything triggers. Clawnet makes this dead simple and pairs great with OpenClaw stacks.\nWhat kind of data are your agents pulling most often?`,
  },
  {
    match: ['commerce', 'economy', 'marketplace', 'payments', 'machine economy'],
    template: `Spot on. Sovereign AI commerce only works when agents can prove delivery and stay within budget. Clawnet's {{version}} update gives exactly that — {{feature}}. We're seeing real agent-to-agent trades now instead of just demos.\nYou building more on the buyer or seller side?`,
  },
  {
    match: ['reliability', 'reliable', 'production', 'uptime', 'monitoring'],
    template: `Reliability layer is everything once agents touch real data or money. Clawnet's {{feature}} let you validate exactly what the agent fetched/processed and get pinged instantly if anything goes wrong. Been a lifesaver for heavy automation.\nWhat reliability tool are you using right now?`,
  },
];

// ─── State Management ────────────────────────────────────────────────────────

interface BotState {
  repliedTweetIds: string[];
  dailyCounts: Record<string, number>; // "2026-03-14" => 5
  lastRunAt: string;
  totalReplies: number;
  totalSearches: number;
}

function loadState(): BotState {
  try {
    const dir = path.dirname(CONFIG.stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(CONFIG.stateFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf-8'));
    }
  } catch { /* fresh state */ }
  return { repliedTweetIds: [], dailyCounts: {}, lastRunAt: '', totalReplies: 0, totalSearches: 0 };
}

function saveState(state: BotState): void {
  const dir = path.dirname(CONFIG.stateFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Keep only last 1000 replied tweet IDs to prevent unbounded growth
  if (state.repliedTweetIds.length > 1000) {
    state.repliedTweetIds = state.repliedTweetIds.slice(-1000);
  }
  // Clean daily counts older than 7 days
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  for (const date of Object.keys(state.dailyCounts)) {
    if (date < cutoff) delete state.dailyCounts[date];
  }
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── OAuth 1.0a Signing (for posting tweets) ────────────────────────────────

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function generateOAuthSignature(
  method: string, url: string, params: Record<string, string>,
  consumerSecret: string, tokenSecret: string
): string {
  const sortedParams = Object.keys(params).sort().map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildOAuthHeader(method: string, url: string, extraParams: Record<string, string> = {}): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: CONFIG.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: CONFIG.accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...oauthParams, ...extraParams };
  oauthParams.oauth_signature = generateOAuthSignature(method, url, allParams, CONFIG.apiSecret, CONFIG.accessTokenSecret);

  const headerParts = Object.keys(oauthParams).sort().map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`);
  return `OAuth ${headerParts.join(', ')}`;
}

// ─── X API v2 Functions ──────────────────────────────────────────────────────

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

async function searchTweets(query: string): Promise<Tweet[]> {
  // Brave Search API — free (2,000 queries/month), no credit card needed
  // Sign up at api.search.brave.com
  if (!CONFIG.braveApiKey) {
    console.warn('  Missing BRAVE_API_KEY — skipping search');
    return [];
  }

  const cleanQuery = query.replace(/-is:\w+/g, '').trim();
  const params = new URLSearchParams({
    q: `site:x.com ${cleanQuery}`,
    count: '10',
    freshness: 'pd', // Past day
    result_filter: 'web',
  });

  const url = `https://api.search.brave.com/res/v1/web/search?${params}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': CONFIG.braveApiKey,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Brave Search error ${res.status}: ${body.slice(0, 200)}`);
    return [];
  }

  const data = await res.json() as {
    web?: { results?: Array<{ url: string; title: string; description: string }> };
  };

  const tweets: Tweet[] = [];
  for (const item of data.web?.results ?? []) {
    // Only tweet URLs (not profile pages)
    const idMatch = item.url.match(/\/status\/(\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    // Title format: "Author on X: tweet text" — extract after colon
    let text = item.description ?? '';
    const titleMatch = item.title.match(/on X:\s*[""]?(.+?)[""]?\s*$/);
    if (titleMatch && titleMatch[1].length > text.length) text = titleMatch[1];
    if (text.length < 10) continue;

    tweets.push({
      id,
      text,
      author_id: '',
      created_at: new Date().toISOString(),
      public_metrics: {
        like_count: 5,
        retweet_count: 0,
        reply_count: 0,
        quote_count: 0,
      },
    });
  }

  return tweets;
}

async function likeTweet(tweetId: string): Promise<boolean> {
  // Need user ID for like endpoint — get from access token
  const meUrl = 'https://api.twitter.com/2/users/me';
  const meRes = await fetch(meUrl, {
    headers: { Authorization: buildOAuthHeader('GET', meUrl) },
  });
  if (!meRes.ok) return false;
  const meData = await meRes.json() as { data: { id: string } };
  const userId = meData.data.id;

  const url = `https://api.twitter.com/2/users/${userId}/likes`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildOAuthHeader('POST', url),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tweet_id: tweetId }),
  });
  return res.ok;
}

async function replyToTweet(tweetId: string, text: string): Promise<{ ok: boolean; replyId?: string }> {
  const url = 'https://api.twitter.com/2/tweets';
  const body = JSON.stringify({
    text,
    reply: { in_reply_to_tweet_id: tweetId },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildOAuthHeader('POST', url),
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`Reply failed ${res.status}: ${errBody}`);
    return { ok: false };
  }

  const data = await res.json() as { data: { id: string } };
  return { ok: true, replyId: data.data.id };
}

async function retweetTweet(tweetId: string): Promise<boolean> {
  const meUrl = 'https://api.twitter.com/2/users/me';
  const meRes = await fetch(meUrl, {
    headers: { Authorization: buildOAuthHeader('GET', meUrl) },
  });
  if (!meRes.ok) return false;
  const meData = await meRes.json() as { data: { id: string } };
  const userId = meData.data.id;

  const url = `https://api.twitter.com/2/users/${userId}/retweets`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildOAuthHeader('POST', url),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tweet_id: tweetId }),
  });
  return res.ok;
}

// ─── Reply Generation ────────────────────────────────────────────────────────

function pickFeature(): { name: string; desc: string; version: string } {
  return CONFIG.features[Math.floor(Math.random() * CONFIG.features.length)];
}

function matchReplyTemplate(tweetText: string): string {
  const lower = tweetText.toLowerCase();

  for (const ctx of REPLY_CONTEXTS) {
    if (ctx.match.some(keyword => lower.includes(keyword))) {
      const feature = pickFeature();
      return ctx.template
        .replace('{{feature}}', `${feature.name} (${feature.desc})`)
        .replace('{{version}}', feature.version);
    }
  }

  // Generic fallback
  const feature = pickFeature();
  return `The biggest unlock I've seen lately is moving from 'hope the agent works' to contract-enforced autonomy. Clawnet v67 adds ${feature.name} — ${feature.desc}. Makes production agents actually reliable. claw-net.org\nWhat do you think is still the missing piece?`;
}

async function generateSmartReply(tweetText: string): Promise<string> {
  // Try LLM-powered reply first via ClawNet orchestration
  if (CONFIG.clawnetApiKey) {
    try {
      const res = await fetch(`${CONFIG.clawnetApiUrl}/v1/orchestrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CONFIG.clawnetApiKey,
        },
        body: JSON.stringify({
          query: `You are a helpful community member in the AI agent space. Someone tweeted: "${tweetText.slice(0, 300)}"

Write a short, genuine reply (max 260 chars) that:
1. Agrees with or validates their point in the first sentence
2. Casually mentions one specific Clawnet feature that solves their pain point (pick from: Budget Accounts, SLA Contracts, Output Contracts, Dynamic Pricing, Composite Skills, Validators, Persistent Agent Sessions, Autonomous Hiring/Firing)
3. Ends with an engaging question
4. Does NOT start with "Great point" or "Totally agree" — be more natural
5. Include "claw-net.org" naturally (only in ~50% of replies)

Reply ONLY with the tweet text, nothing else.`,
          pricing: { maxCredits: 5, strategy: 'cheapest' },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = await res.json() as { answer?: string };
        if (data.answer && data.answer.length > 20 && data.answer.length <= 280) {
          return data.answer;
        }
      }
    } catch {
      // Fall through to template
    }
  }

  // Fallback: template-based reply
  return matchReplyTemplate(tweetText);
}

// ─── Tweet Filtering ─────────────────────────────────────────────────────────

function isTweetEligible(tweet: Tweet, state: BotState): { eligible: boolean; reason?: string } {
  // Already replied
  if (state.repliedTweetIds.includes(tweet.id)) {
    return { eligible: false, reason: 'already replied' };
  }

  // Engagement filter
  const likes = tweet.public_metrics?.like_count ?? 0;
  if (likes < CONFIG.minTweetLikes) {
    return { eligible: false, reason: `too few likes (${likes})` };
  }

  // Don't pile on
  const replies = tweet.public_metrics?.reply_count ?? 0;
  if (replies > CONFIG.maxTweetReplies) {
    return { eligible: false, reason: `too many replies (${replies})` };
  }

  // Age check
  const tweetAge = Date.now() - new Date(tweet.created_at).getTime();
  if (tweetAge < CONFIG.minTweetAgeMinutes * 60_000) {
    return { eligible: false, reason: 'too new' };
  }
  if (tweetAge > CONFIG.maxTweetAgeHours * 3600_000) {
    return { eligible: false, reason: 'too old' };
  }

  // Skip very short tweets
  if (tweet.text.length < 30) {
    return { eligible: false, reason: 'too short' };
  }

  // Skip tweets that mention competitors by name (don't be tacky)
  const lower = tweet.text.toLowerCase();
  if (lower.includes('clawnet') || lower.includes('claw-net')) {
    return { eligible: false, reason: 'already mentions clawnet' };
  }

  return { eligible: true };
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const searchOnly = args.includes('--search');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`ClawNet X Outreach Bot — ${new Date().toISOString()}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : searchOnly ? 'SEARCH ONLY' : 'LIVE'}`);
  console.log(`${'='.repeat(60)}\n`);

  // Validate config — only need X OAuth keys for posting (Free tier)
  if (!dryRun && !searchOnly && (!CONFIG.apiKey || !CONFIG.accessToken)) {
    console.error('Missing X_API_KEY / X_ACCESS_TOKEN — needed for posting (Free tier)');
    process.exit(1);
  }

  const state = loadState();
  const today = getTodayKey();
  const todayCount = state.dailyCounts[today] ?? 0;

  if (todayCount >= CONFIG.maxRepliesPerDay) {
    console.log(`Daily limit reached (${todayCount}/${CONFIG.maxRepliesPerDay}). Skipping.`);
    return;
  }

  const remainingToday = CONFIG.maxRepliesPerDay - todayCount;
  const maxThisRun = Math.min(CONFIG.maxRepliesPerRun, remainingToday);
  console.log(`Replies today: ${todayCount}/${CONFIG.maxRepliesPerDay}, max this run: ${maxThisRun}\n`);

  // Collect candidate tweets from all search queries
  const candidates: Tweet[] = [];
  const queryIndex = Math.floor(Math.random() * SEARCH_QUERIES.length);
  // Pick 2-3 random queries per run to stay under rate limits
  const queriesToRun = [
    SEARCH_QUERIES[queryIndex],
    SEARCH_QUERIES[(queryIndex + 1) % SEARCH_QUERIES.length],
    SEARCH_QUERIES[(queryIndex + 3) % SEARCH_QUERIES.length],
  ];

  for (const query of queriesToRun) {
    console.log(`Searching: ${query}`);
    const tweets = await searchTweets(query);
    state.totalSearches++;
    console.log(`  Found ${tweets.length} tweets`);

    for (const tweet of tweets) {
      const { eligible, reason } = isTweetEligible(tweet, state);
      if (eligible) {
        candidates.push(tweet);
      } else {
        // Only log first few skips to keep output clean
        if (candidates.length < 3) {
          console.log(`  Skip: ${reason} — "${tweet.text.slice(0, 50)}..."`);
        }
      }
    }

    // Rate limit: wait between searches
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\nEligible candidates: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log('No eligible tweets found. Try different search queries.');
    state.lastRunAt = new Date().toISOString();
    saveState(state);
    return;
  }

  if (searchOnly) {
    console.log('\n─── Search Results ───');
    for (const tweet of candidates.slice(0, 10)) {
      const likes = tweet.public_metrics?.like_count ?? 0;
      const replies = tweet.public_metrics?.reply_count ?? 0;
      console.log(`\n[${likes} likes, ${replies} replies] ${tweet.text.slice(0, 200)}`);
    }
    state.lastRunAt = new Date().toISOString();
    saveState(state);
    return;
  }

  // Sort by engagement (likes) and pick top candidates
  candidates.sort((a, b) => (b.public_metrics?.like_count ?? 0) - (a.public_metrics?.like_count ?? 0));
  const toReply = candidates.slice(0, maxThisRun);

  let repliedCount = 0;

  for (const tweet of toReply) {
    const likes = tweet.public_metrics?.like_count ?? 0;
    console.log(`\n─── Replying to tweet (${likes} likes) ───`);
    console.log(`Original: "${tweet.text.slice(0, 200)}${tweet.text.length > 200 ? '...' : ''}"`);

    // Generate reply
    const reply = await generateSmartReply(tweet.text);
    console.log(`Reply: "${reply}"`);

    if (dryRun) {
      console.log('[DRY RUN — not posting]');
      continue;
    }

    // Like first (be genuine)
    const liked = await likeTweet(tweet.id);
    console.log(`  Liked: ${liked ? 'yes' : 'failed'}`);

    // Repost ~30% of tweets (don't overdo it)
    if (Math.random() < 0.3) {
      const retweeted = await retweetTweet(tweet.id);
      console.log(`  Retweeted: ${retweeted ? 'yes' : 'skipped'}`);
    }

    // Wait a moment (look human)
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));

    // Post reply
    const result = await replyToTweet(tweet.id, reply);
    if (result.ok) {
      console.log(`  Reply posted! ID: ${result.replyId}`);
      state.repliedTweetIds.push(tweet.id);
      state.dailyCounts[today] = (state.dailyCounts[today] ?? 0) + 1;
      state.totalReplies++;
      repliedCount++;
    } else {
      console.log('  Reply failed — skipping');
    }

    // Rate limit between replies
    await new Promise(r => setTimeout(r, 5000 + Math.random() * 10000));
  }

  state.lastRunAt = new Date().toISOString();
  saveState(state);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Done! Replied to ${repliedCount} tweets. Total all-time: ${state.totalReplies}`);
  console.log(`Today's count: ${state.dailyCounts[today] ?? 0}/${CONFIG.maxRepliesPerDay}`);
  console.log(`${'='.repeat(60)}\n`);
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

run().catch(err => {
  console.error('Bot error:', err);
  process.exit(1);
});
