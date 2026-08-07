import type { MessageRequest } from '../api/types';

export function mergeMessageRequestHead(
  current: MessageRequest[],
  head: MessageRequest[],
): MessageRequest[] {
  const headIds = new Set(head.map((request) => request.id));
  return [...head, ...current.filter((request) => !headIds.has(request.id))];
}

export function appendMessageRequestPage(
  current: MessageRequest[],
  page: MessageRequest[],
): MessageRequest[] {
  const incoming = new Map(page.map((request) => [request.id, request]));
  const merged = current.map((request) => incoming.get(request.id) ?? request);
  const known = new Set(current.map((request) => request.id));
  for (const request of page) {
    if (!known.has(request.id)) merged.push(request);
  }
  return merged;
}

export function removeMessageRequest(
  current: MessageRequest[],
  requestId: string,
): MessageRequest[] {
  return current.filter((request) => request.id !== requestId);
}

export function messageRequestCountLabel(count: number, hasMore: boolean): string | null {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safeCount === 0) return null;
  return hasMore ? `${safeCount}+` : String(safeCount);
}

export function formatMessageRequestSharedContext(request: MessageRequest): string | null {
  const context = request.shared_context;
  const communities = Math.max(0, Math.floor(context?.shared_community_count ?? 0));
  const details: string[] = [];
  if (context?.sender_follows_you && context.you_follow_sender) {
    details.push('You follow each other');
  } else if (context?.sender_follows_you) {
    details.push('Follows you');
  } else if (context?.you_follow_sender) {
    details.push('You follow them');
  }
  if (communities > 0) {
    details.push(`${communities} shared ${communities === 1 ? 'Guild' : 'Guilds'}`);
  }
  return details.length > 0 ? details.join(' · ') : null;
}
