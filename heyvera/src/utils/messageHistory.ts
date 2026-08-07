import type { Message } from '../api/types';

/**
 * Merge message pages and realtime/send results into one canonical history.
 * The newest representation of an id wins so receipt metadata can advance.
 */
export function mergeMessageHistory(current: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return current;

  const byId = new Map<string, Message>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);

  return [...byId.values()].sort(compareMessages);
}

function compareMessages(a: Message, b: Message): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  const byTime = a.created_at.localeCompare(b.created_at);
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}
