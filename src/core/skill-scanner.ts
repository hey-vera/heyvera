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
];

export function scanSkillTemplate(promptTemplate: string): ScanResult {
  const flags: string[] = [];

  for (const { pattern, label } of SUSPICIOUS_PATTERNS) {
    if (pattern.test(promptTemplate)) {
      flags.push(label);
    }
  }

  return {
    status: flags.length > 0 ? 'SUSPICIOUS' : 'CLEAN',
    flags,
  };
}
