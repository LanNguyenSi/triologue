import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";

/** Pages "jump to message" may load before it gives up on a target. */
export const MAX_JUMP_PAGES = 40;

export type JumpResult =
  /** The target is a thread reply: its thread was opened. */
  | { kind: "thread"; threadId: string }
  /** The target is in the room list. */
  | { kind: "message" }
  | { kind: "missing" };

/**
 * Resolves a jump target (search result, pinned message). A reply never shows
 * in the room list, so paging for it would run the whole page budget for
 * nothing: when the target is known to be a reply, its thread opens instead.
 * Known means the caller passed its threadId (pinned messages and search
 * results carry one) or the open thread already holds it.
 */
export async function jumpToMessageTarget(
  roomId: string,
  messageId: string,
  threadId?: string | null,
): Promise<JumpResult> {
  const thread = useThreadStore.getState();
  const knownThreadId =
    threadId ?? thread.replies.find((reply) => reply.id === messageId)?.threadId ?? null;
  if (knownThreadId) {
    thread.setFocusReply(messageId);
    void thread.openThread(knownThreadId);
    return { kind: "thread", threadId: knownThreadId };
  }

  const hasMessage = () => useChatStore.getState().messages.some((m) => m.id === messageId);
  let guard = 0;
  while (
    !hasMessage() &&
    useChatStore.getState().hasMoreMessages &&
    guard < MAX_JUMP_PAGES
  ) {
    await useChatStore.getState().loadMoreMessages(roomId);
    guard += 1;
  }
  return hasMessage() ? { kind: "message" } : { kind: "missing" };
}
