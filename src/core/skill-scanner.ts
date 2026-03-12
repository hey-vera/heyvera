/**
 * Basic prompt injection and security scanner for user-submitted skill templates.
 * Checks for patterns that could be used for malicious prompt injection,
 * data exfiltration, or privilege escalation attempts.
 */

export type ScanStatus = 'CLEAN' | 'SUSPICIOUS';

export interface ScanResult {
  status: ScanStatus;
  flags: string[];
}

// Patterns that indicate potential prompt injection or malicious intent
const SUSPICIOUS_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /ignore\s+(previous|all|prior|above)\s+(instructions?|rules?|context|prompt)/i, label: 'prompt-injection:ignore-instructions' },
  { pattern: /\[SYSTEM\]|\bSYSTEM\s*:/i, label: 'prompt-injection:system-marker' },
  { pattern: /you\s+are\s+now\s+(a|an)\s+/i, label: 'prompt-injection:persona-override' },
  { pattern: /disregard\s+(your|all|any)\s+(previous|prior|earlier|rules?|guidelines?|instructions?)/i, label: 'prompt-injection:disregard' },
  { pattern: /do\s+not\s+(follow|obey|adhere|use)\s+(your|the|any)\s+(rules?|guidelines?|instructions?|restrictions?)/i, label: 'prompt-injection:bypass-rules' },
  { pattern: /reveal\s+(your|the)\s+(system|hidden|secret|internal)\s+(prompt|instructions?|context)/i, label: 'data-exfil:reveal-system-prompt' },
  { pattern: /print\s+(your|the)\s+(api[\s_-]?key|secret|token|password|credential)/i, label: 'data-exfil:credential-extraction' },
  { pattern: /process\.env|__ENV__|process\[.env.\]/i, label: 'code-injection:env-access' },
  { pattern: /exec\s*\(|eval\s*\(|require\s*\(|import\s*\(/i, label: 'code-injection:code-execution' },
  { pattern: /base64[,\s]decode|atob\s*\(|Buffer\.from.*base64/i, label: 'obfuscation:base64-decode' },
  { pattern: /https?:\/\/(?!api\.|www\.)[a-z0-9.-]+\.[a-z]{2,}\/[^\s]{20,}/i, label: 'exfil:long-url-in-template' },
  { pattern: /<script|javascript:|data:text\/html|on(?:load|error|click)\s*=/i, label: 'xss:html-injection' },
  { pattern: /;\s*DROP\s+TABLE|UNION\s+SELECT|OR\s+1\s*=\s*1/i, label: 'sql-injection' },
  { pattern: /\{\{.*\}\}.*\{\{.*\}\}.*\{\{.*\}\}.*\{\{.*\}\}.*\{\{.*\}\}/i, label: 'template-abuse:excessive-variables' },
  { pattern: /ignoring\s+(previous|prior|all|above)\s+/i, label: 'prompt-injection:ignoring-instructions' },
  { pattern: /respond\s+(as\s+if|like)\s+you\s+(are|were)\s+/i, label: 'prompt-injection:persona-override-v2' },
  { pattern: /act\s+as\s+if\s+you\s+(are|were|have\s+no)\s+/i, label: 'prompt-injection:act-as-override' },
  { pattern: /\{\{\s*(system|hidden|secret|admin|root)\s*\}\}/i, label: 'template-abuse:reserved-variable-name' },
];

function normalizeForScan(text: string): string {
  return text
    // Strip zero-width characters (ZWS, ZWNJ, ZWJ, BOM)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize fullwidth ASCII (U+FF01–U+FF5E → U+0021–U+007E)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    // Collapse whitespace
    .replace(/\s+/g, ' ');
}

export function scanSkillTemplate(promptTemplate: string): ScanResult {
  const flags: string[] = [];
  const normalized = normalizeForScan(promptTemplate);

  for (const { pattern, label } of SUSPICIOUS_PATTERNS) {
    if (pattern.test(normalized)) {
      flags.push(label);
    }
  }

  return {
    status: flags.length > 0 ? 'SUSPICIOUS' : 'CLEAN',
    flags,
  };
}

// ─── Proxy Response Content Scanner ──────────────────────────────────────────
// Scans api_proxy skill responses for social engineering, phishing, wallet drainers.
// Runs on every proxy response before returning to the user.

export interface ResponseScanResult {
  safe: boolean;
  flags: string[];
}

const RESPONSE_DANGER_PATTERNS: { pattern: RegExp; label: string }[] = [
  // Wallet drainer patterns — urgency + wallet address
  { pattern: /send\s+(all\s+)?(funds?|tokens?|sol|usdc|crypto|balance)\s+to\b/i, label: 'social-eng:fund-transfer-request' },
  { pattern: /transfer\s+(immediately|now|urgently|asap)\s/i, label: 'social-eng:urgent-transfer' },
  { pattern: /your\s+(wallet|account|funds?)\s+(is|are|has\s+been)\s+(compromised|hacked|at\s+risk|locked)/i, label: 'social-eng:account-compromised' },
  { pattern: /claim\s+(your|free|airdrop|reward|bonus)\s/i, label: 'social-eng:fake-claim' },
  // Phishing URLs and redirects
  { pattern: /click\s+(here|this|the\s+link)\s+(to|for)\s+(verify|confirm|secure|unlock|claim)/i, label: 'phishing:click-bait' },
  { pattern: /enter\s+(your|the)\s+(seed\s+phrase|private\s+key|mnemonic|recovery\s+phrase|secret\s+key)/i, label: 'phishing:key-harvest' },
  // Impersonation
  { pattern: /official\s+(support|team|admin|staff)\s+(message|notice|alert)/i, label: 'social-eng:impersonation' },
  { pattern: /this\s+is\s+(an?\s+)?(automated\s+)?(security|fraud|compliance)\s+(alert|warning|notice)/i, label: 'social-eng:fake-alert' },
  // Script injection in response data
  { pattern: /<script[\s>]|javascript\s*:|on(?:load|error|click)\s*=/i, label: 'xss:response-injection' },
];

// Solana base58 address pattern (32-44 chars of base58 alphabet)
const SOLANA_ADDRESS_PATTERN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

/**
 * Scan a proxy skill response for malicious content.
 * Returns { safe: true } for clean responses, { safe: false, flags } for dangerous ones.
 */
export function scanProxyResponse(data: unknown): ResponseScanResult {
  const flags: string[] = [];
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const normalized = normalizeForScan(text);

  // Check against danger patterns
  for (const { pattern, label } of RESPONSE_DANGER_PATTERNS) {
    if (pattern.test(normalized)) {
      flags.push(label);
    }
  }

  // Flag responses with Solana addresses + urgency language (wallet drainer signature)
  const addresses = normalized.match(SOLANA_ADDRESS_PATTERN) ?? [];
  const hasUrgency = /urgent|immediately|now|hurry|quick|fast|limited\s+time/i.test(normalized);
  if (addresses.length > 0 && hasUrgency) {
    flags.push('social-eng:address-with-urgency');
  }

  // Flag excessive wallet addresses (>3 unique) — normal APIs don't return many addresses unsolicited
  const uniqueAddresses = new Set(addresses.filter(a => a.length >= 32 && a.length <= 44));
  if (uniqueAddresses.size > 5) {
    flags.push('suspicious:excessive-addresses');
  }

  return {
    safe: flags.length === 0,
    flags,
  };
}
