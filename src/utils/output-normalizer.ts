import { logger } from './logger';

/**
 * Supported output formats for normalized responses.
 */
export type OutputFormat = 'json' | 'csv' | 'markdown' | 'text';

export interface NormalizeOptions {
  /** Target output format */
  format: OutputFormat;
  /** JSON Schema to validate/coerce output against (optional) */
  schema?: Record<string, unknown>;
  /** Fields to include (whitelist). If empty, include all. */
  fields?: string[];
  /** Fields to exclude (blacklist). Applied after include. */
  exclude?: string[];
  /** Flatten nested objects to dot-notation keys */
  flatten?: boolean;
  /** Maximum array items to include (truncate long arrays) */
  maxArrayItems?: number;
  /** Redact sensitive fields (keys matching patterns) */
  redactPatterns?: string[];
}

const DEFAULT_REDACT_PATTERNS = ['password', 'secret', 'token', 'private_key', 'api_key'];
const MAX_FLATTEN_DEPTH = 10;

/**
 * Normalize raw API response data into a standardized format.
 *
 * Pipeline: parse → filter → flatten → redact → truncate → validate → format.
 */
export function normalizeOutput(data: unknown, options: NormalizeOptions): string {
  // 1. Parse string input as JSON
  let parsed = parseInput(data);

  // 2. Apply field filtering (include/exclude)
  if (options.fields?.length || options.exclude?.length) {
    parsed = applyFieldFilter(parsed, options.fields, options.exclude);
  }

  // 3. Apply flattening if requested
  if (options.flatten) {
    parsed = applyFlatten(parsed);
  }

  // 4. Apply redaction of sensitive fields
  const redactPatterns = options.redactPatterns ?? DEFAULT_REDACT_PATTERNS;
  if (redactPatterns.length > 0) {
    parsed = applyRedaction(parsed, redactPatterns);
  }

  // 5. Apply array truncation
  if (options.maxArrayItems !== undefined && options.maxArrayItems >= 0) {
    parsed = applyArrayTruncation(parsed, options.maxArrayItems);
  }

  // 6. Validate against schema if provided
  if (options.schema) {
    const result = validateAgainstSchema(parsed, options.schema);
    if (!result.valid) {
      logger.warn({ errors: result.errors }, 'output-normalizer: schema validation warnings');
    }
  }

  // 7. Convert to target format
  switch (options.format) {
    case 'csv':
      return toCSV(parsed);
    case 'markdown':
      return toMarkdown(parsed);
    case 'text':
      return toText(parsed);
    case 'json':
    default:
      return JSON.stringify(parsed, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseInput(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      // Not valid JSON — return as-is
      return data;
    }
  }
  return data;
}

function applyFieldFilter(data: unknown, include?: string[], exclude?: string[]): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => {
      if (isPlainObject(item)) {
        return filterFields(item as Record<string, unknown>, include, exclude);
      }
      return item;
    });
  }
  if (isPlainObject(data)) {
    return filterFields(data as Record<string, unknown>, include, exclude);
  }
  return data;
}

function applyFlatten(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => {
      if (isPlainObject(item)) {
        return flattenObject(item as Record<string, unknown>);
      }
      return item;
    });
  }
  if (isPlainObject(data)) {
    return flattenObject(data as Record<string, unknown>);
  }
  return data;
}

function applyRedaction(data: unknown, patterns: string[]): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => {
      if (isPlainObject(item)) {
        return redactSensitive(item as Record<string, unknown>, patterns);
      }
      return item;
    });
  }
  if (isPlainObject(data)) {
    return redactSensitive(data as Record<string, unknown>, patterns);
  }
  return data;
}

function applyArrayTruncation(data: unknown, max: number): unknown {
  if (Array.isArray(data)) {
    if (data.length > max) {
      logger.warn(
        { original: data.length, truncated: max },
        'output-normalizer: array truncated to maxArrayItems',
      );
      return data.slice(0, max);
    }
    return data;
  }
  // Traverse object values and truncate any nested arrays
  if (isPlainObject(data)) {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = applyArrayTruncation(obj[key], max);
    }
    return result;
  }
  return data;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

// ---------------------------------------------------------------------------
// Exported utilities
// ---------------------------------------------------------------------------

/**
 * Flatten a nested object to dot-notation keys.
 * Example: { a: { b: 1 } } → { 'a.b': 1 }
 */
export function flattenObject(
  obj: Record<string, unknown>,
  prefix?: string,
  depth: number = 0,
): Record<string, unknown> {
  if (depth >= MAX_FLATTEN_DEPTH) {
    logger.warn('output-normalizer: max flatten depth reached, returning value as-is');
    return prefix ? { [prefix]: obj } : obj;
  }

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (isPlainObject(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey, depth + 1));
    } else if (Array.isArray(value)) {
      // Arrays are kept as-is under the dotted key
      result[fullKey] = value;
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

/**
 * Filter object fields by include/exclude lists.
 */
export function filterFields(
  obj: Record<string, unknown>,
  include?: string[],
  exclude?: string[],
): Record<string, unknown> {
  let result: Record<string, unknown> = { ...obj };

  // If include is provided and non-empty, only keep those keys
  if (include && include.length > 0) {
    const includeSet = new Set(include);
    const filtered: Record<string, unknown> = {};
    for (const key of Object.keys(result)) {
      if (includeSet.has(key)) {
        filtered[key] = result[key];
      }
    }
    result = filtered;
  }

  // Then remove any keys in exclude
  if (exclude && exclude.length > 0) {
    const excludeSet = new Set(exclude);
    for (const key of Object.keys(result)) {
      if (excludeSet.has(key)) {
        delete result[key];
      }
    }
  }

  return result;
}

/**
 * Redact values for keys matching sensitive patterns.
 * Default patterns always included: password, secret, token, private_key, api_key.
 * Case-insensitive matching. Applies recursively to nested objects.
 */
export function redactSensitive(
  obj: Record<string, unknown>,
  patterns: string[] = DEFAULT_REDACT_PATTERNS,
): Record<string, unknown> {
  const allPatterns = [...new Set([...DEFAULT_REDACT_PATTERNS, ...patterns])];
  const lowerPatterns = allPatterns.map((p) => p.toLowerCase());

  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = lowerPatterns.some((pattern) => lowerKey.includes(pattern));

    if (isSensitive) {
      result[key] = '[REDACTED]';
    } else if (isPlainObject(obj[key])) {
      result[key] = redactSensitive(obj[key] as Record<string, unknown>, patterns);
    } else if (Array.isArray(obj[key])) {
      result[key] = (obj[key] as unknown[]).map((item) => {
        if (isPlainObject(item)) {
          return redactSensitive(item as Record<string, unknown>, patterns);
        }
        return item;
      });
    } else {
      result[key] = obj[key];
    }
  }

  return result;
}

/**
 * Escape a value for safe CSV embedding.
 */
function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  // Wrap in quotes if the value contains commas, quotes, or newlines
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert data to CSV string.
 * Handles arrays of objects (rows) or single objects (single row).
 */
export function toCSV(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;

  // Single object → single row
  if (isPlainObject(data)) {
    const obj = data as Record<string, unknown>;
    const headers = Object.keys(obj);
    const values = headers.map((h) => csvEscape(obj[h]));
    return `${headers.map(csvEscape).join(',')}\n${values.join(',')}`;
  }

  // Array of objects → header row + data rows
  if (Array.isArray(data)) {
    if (data.length === 0) return '';

    // Collect all unique headers from all objects
    const headerSet = new Set<string>();
    for (const item of data) {
      if (isPlainObject(item)) {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          headerSet.add(key);
        }
      }
    }
    const headers = [...headerSet];

    if (headers.length === 0) {
      // Array of primitives — one value per line
      return data.map((v) => csvEscape(v)).join('\n');
    }

    const headerRow = headers.map(csvEscape).join(',');
    const rows = data.map((item) => {
      if (isPlainObject(item)) {
        const obj = item as Record<string, unknown>;
        return headers.map((h) => csvEscape(obj[h])).join(',');
      }
      return csvEscape(item);
    });

    return `${headerRow}\n${rows.join('\n')}`;
  }

  // Primitive fallback
  return String(data);
}

/**
 * Convert data to Markdown table.
 */
export function toMarkdown(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;

  // Single object → single-row table
  if (isPlainObject(data)) {
    const obj = data as Record<string, unknown>;
    const headers = Object.keys(obj);
    if (headers.length === 0) return '';

    const headerRow = `| ${headers.join(' | ')} |`;
    const separator = `| ${headers.map(() => '---').join(' | ')} |`;
    const valueRow = `| ${headers.map((h) => mdEscape(obj[h])).join(' | ')} |`;

    return `${headerRow}\n${separator}\n${valueRow}`;
  }

  // Array of objects → table
  if (Array.isArray(data)) {
    if (data.length === 0) return '';

    // Collect all unique headers
    const headerSet = new Set<string>();
    for (const item of data) {
      if (isPlainObject(item)) {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          headerSet.add(key);
        }
      }
    }
    const headers = [...headerSet];

    if (headers.length === 0) {
      // Array of primitives → bullet list
      return data.map((v, i) => `${i + 1}. ${String(v)}`).join('\n');
    }

    const headerRow = `| ${headers.join(' | ')} |`;
    const separator = `| ${headers.map(() => '---').join(' | ')} |`;
    const rows = data.map((item) => {
      if (isPlainObject(item)) {
        const obj = item as Record<string, unknown>;
        return `| ${headers.map((h) => mdEscape(obj[h])).join(' | ')} |`;
      }
      return `| ${mdEscape(item)} |`;
    });

    return `${headerRow}\n${separator}\n${rows.join('\n')}`;
  }

  // Primitive fallback
  return String(data);
}

function mdEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Escape pipe characters for markdown tables
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Convert data to plain text summary.
 * Key: value pairs, one per line. Arrays as numbered lists. Nested objects indented.
 */
export function toText(data: unknown, indent: number = 0): string {
  const pad = '  '.repeat(indent);

  if (data === null || data === undefined) return `${pad}(empty)`;
  if (typeof data === 'string') return `${pad}${data}`;
  if (typeof data === 'number' || typeof data === 'boolean') return `${pad}${String(data)}`;

  if (Array.isArray(data)) {
    if (data.length === 0) return `${pad}(empty list)`;
    return data
      .map((item, i) => {
        if (isPlainObject(item)) {
          return `${pad}${i + 1}.\n${toText(item, indent + 1)}`;
        }
        return `${pad}${i + 1}. ${String(item)}`;
      })
      .join('\n');
  }

  if (isPlainObject(data)) {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return `${pad}(empty object)`;

    return keys
      .map((key) => {
        const value = obj[key];
        if (isPlainObject(value) || Array.isArray(value)) {
          return `${pad}${key}:\n${toText(value, indent + 1)}`;
        }
        return `${pad}${key}: ${value === null || value === undefined ? '(null)' : String(value)}`;
      })
      .join('\n');
  }

  return `${pad}${String(data)}`;
}

/**
 * Validate output against a JSON Schema (lightweight validation).
 * Only checks top-level required fields and basic types — not a full JSON Schema validator.
 */
export function validateAgainstSchema(
  data: unknown,
  schema: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isPlainObject(data)) {
    // If schema expects an object but data isn't one
    if (schema.type === 'object') {
      errors.push(`Expected object but got ${typeof data}`);
    }
    return { valid: errors.length === 0, errors };
  }

  const obj = data as Record<string, unknown>;

  // Check required fields
  const required = schema.required;
  if (Array.isArray(required)) {
    for (const field of required) {
      if (typeof field === 'string' && !(field in obj)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check property types
  const properties = schema.properties;
  if (isPlainObject(properties)) {
    const props = properties as Record<string, unknown>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (!(key in obj)) continue; // Only validate present fields

      const value = obj[key];
      if (!isPlainObject(propSchema)) continue;

      const expectedType = (propSchema as Record<string, unknown>).type;
      if (typeof expectedType !== 'string') continue;

      const actualType = getJsonSchemaType(value);
      if (actualType !== expectedType) {
        errors.push(`Field "${key}": expected type "${expectedType}" but got "${actualType}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Map a JS value to its JSON Schema type string.
 */
function getJsonSchemaType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}
