/** Mask an API key for display — shows first 4 + last 4, rest as bullets. */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}
