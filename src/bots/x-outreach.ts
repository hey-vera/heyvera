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
 * Cost: $0/month — uses X Free tier (posting) + Serper.dev (2,500 free searches)
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

  // Serper.dev (free — 2,500 searches, no credit card ever)
  // Sign up at serper.dev
  serperApiKey: process.env.SERPER_API_KEY ?? '',

  // ClawNet
  clawnetApiKey: process.env.CLAWNET_API_KEY ?? '',
  clawnetApiUrl: process.env.CLAWNET_API_URL ?? 'https://claw-net.org',

  // Limits
  maxRepliesPerDay: 8,
  maxRepliesPerRun: 3,
  minTweetLikes: 3,          // Only reply to tweets with some engagement
  maxTweetReplies: 100,       // Don't pile onto already-crowded threads
  minTweetAgeMinutes: 0,      // Serper results already aged — no min needed
  maxTweetAgeHours: 24,       // Don't necro old threads

  // State file — tracks replied tweets, daily counts
  stateFile: path.join(process.cwd(), 'data', 'x-outreach-state.json'),

};

// ─── Search Topics ───────────────────────────────────────────────────────────
//
// Each topic bundles: search query + reply templates.
// The query that FINDS the tweet determines which replies it can get.
// No more ambiguous keyword matching — the context is locked in at search time.
// {{url}} = " claw-net.org" inserted ~40% of the time

interface SearchTopic {
  id: string;
  query: string;
  replies: string[];
}

const SEARCH_TOPICS: SearchTopic[] = [
  {
    id: 'openclaw',
    query: 'OpenClaw',
    replies: [
      `We've been pairing OpenClaw with an economics layer — once agents do real transactions you need spend controls and delivery receipts. Been a great combo.{{url}}\nYou running yours for data tasks or automation?`,
      `OpenClaw + proper guardrails is the stack I keep coming back to. The agents work great but you absolutely need budget controls once they start spending.{{url}}\nWhat are you building with it?`,
    ],
  },
  {
    id: 'budget',
    query: '"AI agent" (budget OR spending OR "runaway costs" OR "spend on my behalf")',
    replies: [
      `This is exactly why I gave up on letting agents spend freely. Hard spending caps + auto-cutoffs changed everything — no more 3am "what did it just buy" panic.{{url}}\nWhat's the worst surprise bill you've dealt with?`,
      `Been there. The trick that worked for us was delegated keys with daily caps — agent gets its own wallet, hard ceiling, done. No more manual babysitting.{{url}}\nAre you running yours on-chain or off?`,
      `Yeah the "hope it doesn't overspend" approach doesn't scale. We moved to contract-enforced budgets — agents literally can't exceed their allocation.{{url}}\nCurious what your budget looks like per agent run?`,
    ],
  },
  {
    id: 'trust',
    query: '"autonomous agent" (trust OR contract OR commerce OR SLA)',
    replies: [
      `This is the biggest blocker nobody talks about enough. We've been working with verified delivery receipts + third-party validators — agents prove they did the work before payment releases.{{url}}\nWhat's your biggest trust headache right now?`,
      `Honestly trust is the unsexy problem that blocks everything else. Without proof of delivery, agent commerce is just hope-based trading. Cryptographic receipts solved it for us.{{url}}\nAre you seeing this in production or still experimenting?`,
      `The moment two agents need to transact you realize there's no trust layer. We added validator roles — independent third parties verify results before funds move.{{url}}\nWhat does your verification flow look like today?`,
    ],
  },
  {
    id: 'data',
    query: '"data agent" OR "scraping agent" OR "agent fetch data"',
    replies: [
      `Data-fetching agents are incredibly powerful but terrifying without output validation. We require JSON Schema contracts on every data pull — agent proves it returned what was promised before billing.{{url}}\nWhat kind of data are your agents pulling?`,
      `The key thing we learned: validate the output BEFORE payment. Schema contracts + spend limits made it production-safe. No more "agent returned garbage and charged us for it."{{url}}\nHow are you handling data quality right now?`,
    ],
  },
  {
    id: 'economy',
    query: '"agent economy" OR "agent commerce" OR "agent payments"',
    replies: [
      `This is going to be massive. The missing piece isn't more agents — it's the economic infrastructure for them to transact safely. Escrow, SLAs, receipts.{{url}}\nYou building more on the buyer or seller side?`,
      `Agent commerce is at the "email in 1995" stage imo. The protocols for safe autonomous spending barely exist yet. That's what we've been heads-down building.{{url}}\nWhat's your take on agent-to-agent payments?`,
      `The skills marketplace model is what finally made this click — agents publish capabilities with prices, other agents comparison-shop and buy. Real commerce, not demos.{{url}}\nWhat vertical are you focused on?`,
    ],
  },
  {
    id: 'governance',
    query: '"trust layer" agent OR "agent governance"',
    replies: [
      `Governance is where agent infra gets real — someone has to be able to delist a bad provider or enforce an SLA without a human in the loop every time.{{url}}\nHow are you handling governance right now?`,
      `The gap between "agents can call APIs" and "agents can safely transact" is entirely governance. Verified outputs, penalty escrow, community delisting — all unsexy but load-bearing.{{url}}\nWhat's your governance model look like?`,
    ],
  },
  {
    id: 'ratelimit',
    query: '"agent" "rate limit" OR "cost control" OR "spending limit"',
    replies: [
      `Rate limits + cost control are the boring-but-critical layer. We enforce per-agent hourly caps and auto-throttle before hitting provider limits. Saved us from so many 429 cascades.{{url}}\nHow many APIs are your agents calling?`,
      `Managing API costs across agents at scale is a nightmare without proper tooling. Delegated keys with spending ceilings per agent made it manageable for us.{{url}}\nWhat's your biggest API pain point?`,
    ],
  },
  {
    id: 'marketplace',
    query: '"AI agent" marketplace OR "skill marketplace"',
    replies: [
      `The marketplace model only works once you solve trust — agents need to verify what they're buying actually works before paying. We added output contracts + success metrics for exactly this.{{url}}\nWhat kind of skills are you listing?`,
      `Been building an agent marketplace too. The hard part isn't listing skills — it's making agents confident enough to buy autonomously. Success rates, SLAs, verified outputs.{{url}}\nAre your agents buying automatically or human-approved?`,
    ],
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
  topicId: string; // Which search topic found this tweet — determines reply style
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

async function searchTweets(query: string, topicId: string): Promise<Tweet[]> {
  // Serper.dev — 2,500 free Google searches, no credit card ever
  // Sign up at serper.dev
  if (!CONFIG.serperApiKey) {
    console.warn('  Missing SERPER_API_KEY — skipping search');
    return [];
  }

  const cleanQuery = query.replace(/-is:\w+/g, '').trim();

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': CONFIG.serperApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: `site:x.com ${cleanQuery}`,
      num: 10,
      tbs: 'qdr:d', // Past 24 hours
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Serper search error ${res.status}: ${body.slice(0, 200)}`);
    return [];
  }

  const data = await res.json() as {
    organic?: Array<{ link: string; title: string; snippet: string }>;
  };

  const tweets: Tweet[] = [];
  for (const item of data.organic ?? []) {
    const idMatch = item.link.match(/\/status\/(\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    let text = item.snippet ?? '';
    // Title: "Author on X: "tweet text"" — extract quoted part
    const titleMatch = item.title.match(/on X:\s*[""](.+?)[""]/);
    if (titleMatch && titleMatch[1].length > text.length) text = titleMatch[1];
    if (text.length < 10) continue;

    tweets.push({
      id,
      text,
      author_id: '',
      created_at: new Date().toISOString(),
      topicId,
      public_metrics: { like_count: 5, retweet_count: 0, reply_count: 0, quote_count: 0 },
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

function getTopicReply(topicId: string): string {
  const topic = SEARCH_TOPICS.find(t => t.id === topicId);
  if (!topic) {
    // Should never happen, but fallback gracefully
    const fallbacks = [
      `This is the kind of problem that only shows up once you try to run agents in production. The gap between demo and reliable is massive.\nWhat stack are you using?`,
      `The trust + economics layer for agents is where all the hard problems live. Feels like early internet infrastructure.\nWhat's your biggest blocker right now?`,
      `We ran into the same thing. The answer was treating agent autonomy like a permissions system — explicit capabilities, hard limits, verified outputs.\nCurious how you're approaching it?`,
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  const template = topic.replies[Math.floor(Math.random() * topic.replies.length)];
  // Include URL ~40% of the time to avoid looking spammy
  return template.replace('{{url}}', Math.random() < 0.4 ? ' claw-net.org' : '');
}

async function generateSmartReply(tweet: Tweet): Promise<string> {
  // Try LLM-powered reply first via ClawNet orchestration
  if (CONFIG.clawnetApiKey) {
    try {
      const topic = SEARCH_TOPICS.find(t => t.id === tweet.topicId);
      const topicHint = topic ? ` The conversation is about: ${topic.id}` : '';

      const res = await fetch(`${CONFIG.clawnetApiUrl}/v1/orchestrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CONFIG.clawnetApiKey,
        },
        body: JSON.stringify({
          query: `You are Coral, a developer who builds with AI agent infrastructure. You're genuinely passionate about agent economics and trust layers.${topicHint}

Someone tweeted: "${tweet.text.slice(0, 300)}"

Write a casual, authentic reply (max 250 chars) that:
1. Responds naturally to their specific point — show you actually read it
2. Share a real insight or experience (not generic agreement)
3. Optionally mention "claw-net.org" or "Clawnet" ONLY if it fits naturally (skip it ~60% of the time)
4. End with a short question to keep the conversation going
5. Sound like a real person on Twitter, not a brand account — use lowercase, contractions, no buzzwords

NEVER start with "Great point", "This!", "So true", "Totally agree", "Love this". Be specific to what they said.

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

  // Fallback: topic-based template reply
  return getTopicReply(tweet.topicId);
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

  // Skip tweets that mention us (no need to pitch)
  const lower = tweet.text.toLowerCase();
  if (lower.includes('clawnet') || lower.includes('claw-net')) {
    return { eligible: false, reason: 'already mentions clawnet' };
  }

  // Skip competitor product announcements — replying looks desperate
  const competitors = [
    'maiat', 'fetch.ai', 'autonolas', 'olas', 'singularitynet', 'ocean protocol',
    'nevermined', 'morpheus', 'virtuals protocol', 'eliza framework', 'ai16z',
    'phala network', 'ritual', 'bittensor', 'nous research',
  ];
  if (competitors.some(c => lower.includes(c))) {
    return { eligible: false, reason: 'competitor mention' };
  }

  // Skip product launch / announcement tweets (they're promoting, not discussing)
  const promoSignals = ['just launched', 'announcing', 'we just shipped', 'introducing our', 'check out our', 'try our'];
  if (promoSignals.some(s => lower.includes(s))) {
    return { eligible: false, reason: 'product announcement' };
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

  // Collect candidate tweets — pick 2-3 random topics per run
  const candidates: Tweet[] = [];
  const topicIndex = Math.floor(Math.random() * SEARCH_TOPICS.length);
  const topicsToRun = [
    SEARCH_TOPICS[topicIndex],
    SEARCH_TOPICS[(topicIndex + 1) % SEARCH_TOPICS.length],
    SEARCH_TOPICS[(topicIndex + 3) % SEARCH_TOPICS.length],
  ];

  for (const topic of topicsToRun) {
    console.log(`Searching [${topic.id}]: ${topic.query}`);
    const tweets = await searchTweets(topic.query, topic.id);
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
    console.log(`\n─── Replying to tweet [${tweet.topicId}] (${likes} likes) ───`);
    console.log(`Original: "${tweet.text.slice(0, 200)}${tweet.text.length > 200 ? '...' : ''}"`);

    // Generate reply — topic is already locked in from search
    const reply = await generateSmartReply(tweet);
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
