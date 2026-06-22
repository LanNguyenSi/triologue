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
