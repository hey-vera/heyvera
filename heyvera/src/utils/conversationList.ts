import type { Conversation } from '../api/types';

export function mergeConversationHead(
  current: Conversation[],
  head: Conversation[],
): Conversation[] {
  const headIds = new Set(head.map((conversation) => conversation.id));
  return [...head, ...current.filter((conversation) => !headIds.has(conversation.id))];
}

export function appendConversationPage(
  current: Conversation[],
  page: Conversation[],
): Conversation[] {
  const incoming = new Map(page.map((conversation) => [conversation.id, conversation]));
  const merged = current.map((conversation) => incoming.get(conversation.id) ?? conversation);
  const known = new Set(current.map((conversation) => conversation.id));
  for (const conversation of page) {
    if (!known.has(conversation.id)) merged.push(conversation);
  }
  return merged;
}

export function promoteConversation(
  current: Conversation[],
  conversationId: string,
  update: (conversation: Conversation) => Conversation,
): Conversation[] {
  const conversation = current.find((item) => item.id === conversationId);
  if (!conversation) return current;
  return [
    update(conversation),
    ...current.filter((item) => item.id !== conversationId),
  ];
}
