export interface MessageReaction {
  emoji: string;
  userId: string;
}

export interface MessageAttachment {
  id: string;
  filename: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  type: string;
}

export interface Message {
  id: string;
  content: string;
  roomId?: string;
  /** Set on a reply inside a thread; absent or null on a top-level message. */
  threadId?: string | null;
  messageType?: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    userType: string;
  };
  createdAt: string;
  reactions?: MessageReaction[];
  attachments?: MessageAttachment[];
  isPinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: { id: string; username: string; displayName: string } | null;
}

export interface ApprovalRequestPayload {
  type: 'approval_request';
  approvalId: string;
  connectorId: string;
  actionId: string;
  riskLevel: string;
  reason?: string;
}

export interface Thread {
  id: string;
  title: string;
  roomId: string;
  /** Null after the creator deleted their account. */
  createdBy: string | null;
  /** The room message the thread is about; null when that row is gone. */
  rootMessageId: string | null;
  isResolved: boolean;
  messageCount: number;
  lastActivity: string;
  createdAt: string;
  updatedAt: string;
}
