/**
 * Substitute {{variable}} placeholders in a skill prompt template.
 * Each variable value is capped at 500 chars and sanitized against
 * common prompt injection markers before being inserted.
 * Throws if a required variable is missing.
 */

function sanitizeVariableValue(value: string): string {
  return value
    .replace(/\[SYSTEM\]/gi, '[FILTERED]')
    .replace(/\bSYSTEM\s*:/gi, 'FILTERED:')
    .replace(/ignore\s+(previous|all|prior|above)\s+(instructions?|rules?)/gi, '[FILTERED]');
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in variables)) throw new Error(`Missing required variable: ${key}`);
    return sanitizeVariableValue(String(variables[key]).slice(0, 500));
  });
}
