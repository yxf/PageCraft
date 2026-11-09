export interface ConversationEntry {
  id: string;
  prompt: string;
  targetId?: string;
  targetName?: string;
  status: 'pending' | 'saved' | 'error';
  message: string;
  versionId?: string;
  summary?: string;
  priorVersionId?: string;
  undone?: boolean;
}
export interface Conversation {
  targetId?: string;
  draft: string;
  entries: ConversationEntry[];
}
export const emptyConversation = (): Conversation => ({ draft: '', entries: [] });
export function conversationHistory(entries: ConversationEntry[], targetId?: string) {
  if (!targetId) return [];
  return entries
    .filter((e) => e.targetId === targetId && e.status === 'saved' && !e.undone)
    .slice(-6)
    .map((e) => e.prompt.slice(0, 1500));
}
