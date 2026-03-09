/**
 * Seed official ClawHub skills into the DB on first boot.
 * Idempotent — skips skills that already exist.
 */
import { getDb } from '../db/index';
import { logger } from '../utils/logger';

interface OfficialSkill {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  creditCost: number;
  version: string;
  tags: string[];
  inputSchema: object;
  outputSchema: object;
}

const OFFICIAL_SKILLS: OfficialSkill[] = [
  {
    id: 'token-analysis',
    name: 'Token Analyst',
    description: 'Deep token analysis: price action, on-chain metrics, sentiment, and risk scoring for any Solana token.',
    promptTemplate: 'Analyze the Solana token {{token}} at {{depth}} analysis depth. Include: current price action and trend, on-chain transaction volume and holder count, top holder concentration risk, social sentiment signals, and a risk/opportunity score from 0-10 each. Conclude with 2-3 specific suggested actions for an investor.',
    creditCost: 5,
    version: '1.0.0',
    tags: ['defi', 'solana', 'token', 'analysis'],
    inputSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', description: 'Token symbol or mint address (e.g. SOL, BONK, or a Solana mint pubkey)' },
        depth: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard', description: 'Analysis depth' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'Human-readable analysis summary' },
        opportunityScore: { type: 'number', description: '0–10 opportunity rating' },
        riskScore: { type: 'number', description: '0–10 risk rating' },
        suggestedActions: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    id: 'social-sentiment',
    name: 'Social Sentiment',
    description: 'Twitter/X and Reddit sentiment analysis for any crypto project, token, or topic.',
    promptTemplate: 'Analyze social sentiment for "{{topic}}" on Twitter/X and Reddit. Quantify bullish vs bearish mentions, identify key influencers, detect unusual volume spikes, and provide an overall sentiment score from -10 (extreme fear) to +10 (extreme greed). Include top 3 narrative themes.',
    creditCost: 3,
    version: '1.0.0',
    tags: ['social', 'sentiment', 'twitter', 'crypto'],
    inputSchema: {
      type: 'object',
      required: ['topic'],
      properties: {
        topic: { type: 'string', description: 'Token, project name, or search term' },
        timeframe: { type: 'string', enum: ['1h', '24h', '7d'], default: '24h' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        sentimentScore: { type: 'number', description: '-10 to +10' },
        bullishPct: { type: 'number' },
        bearishPct: { type: 'number' },
        topThemes: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
  {
    id: 'portfolio-optimizer',
    name: 'Portfolio Optimizer',
    description: 'Analyze a Solana wallet and suggest rebalancing strategies based on risk tolerance and market conditions.',
    promptTemplate: 'Analyze the Solana wallet {{wallet}} portfolio. Assess current allocation, identify overexposed positions, calculate approximate portfolio risk score, and suggest a rebalancing strategy for a {{riskLevel}} risk tolerance. Include specific swap recommendations.',
    creditCost: 8,
    version: '1.0.0',
    tags: ['portfolio', 'solana', 'defi', 'rebalance'],
    inputSchema: {
      type: 'object',
      required: ['wallet'],
      properties: {
        wallet: { type: 'string', description: 'Solana wallet address' },
        riskLevel: { type: 'string', enum: ['conservative', 'moderate', 'aggressive'], default: 'moderate' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        riskScore: { type: 'number' },
        currentAllocation: { type: 'object' },
        recommendations: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  },
];

const CLAWHUB_KEY = 'clawhub-official';

export function seedOfficialSkills(): void {
  const db = getDb();
  let seeded = 0;

  for (const skill of OFFICIAL_SKILLS) {
    const existing = db.prepare('SELECT id FROM skills WHERE id = ?').get(skill.id);
    if (existing) continue;

    db.prepare(`
      INSERT INTO skills
        (id, name, description, prompt_template, author_key, public, credit_cost,
         version, tags_json, input_schema_json, output_schema_json, published_at)
      VALUES
        (@id, @name, @description, @promptTemplate, @authorKey, 1, @creditCost,
         @version, @tagsJson, @inputSchemaJson, @outputSchemaJson, datetime('now'))
    `).run({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      promptTemplate: skill.promptTemplate,
      authorKey: CLAWHUB_KEY,
      creditCost: skill.creditCost,
      version: skill.version,
      tagsJson: JSON.stringify(skill.tags),
      inputSchemaJson: JSON.stringify(skill.inputSchema),
      outputSchemaJson: JSON.stringify(skill.outputSchema),
    });
    seeded++;
  }

  if (seeded > 0) {
    logger.info({ seeded }, 'Official ClawHub skills seeded');
  }
}
