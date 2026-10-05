// In-memory cache of each conversation's messages, so reopening a thread
// shows what we already have straight away while a fresh copy loads.
// Cleared on sign-out.

import type { Message } from '@/types';

const MAX_CONVERSATIONS = 40;

const cache = new Map<string, Message[]>();

export function getCachedMessages(conversationId: string): Message[] | undefined {
  const hit = cache.get(conversationId);
  if (hit) {
    // Re-insert so the most recently used sits at the back.
    cache.delete(conversationId);
    cache.set(conversationId, hit);
  }
  return hit;
}

export function setCachedMessages(conversationId: string, messages: Message[]) {
  cache.delete(conversationId);
  cache.set(conversationId, messages);
  if (cache.size > MAX_CONVERSATIONS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Keep a cached thread current when a message arrives for it. */
export function appendCachedMessage(conversationId: string, message: Message) {
  const existing = cache.get(conversationId);
  if (!existing || existing.some((m) => m.id === message.id)) return;
  cache.set(conversationId, [...existing, message]);
}

/** Keep a cached thread current when one of its messages changes. */
export function updateCachedMessage(conversationId: string, message: Message) {
  const existing = cache.get(conversationId);
  if (!existing) return;
  cache.set(
    conversationId,
    existing.map((m) => (m.id === message.id ? { ...m, ...message } : m)),
  );
}

export function clearMessageCache() {
  cache.clear();
}
