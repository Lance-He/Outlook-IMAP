export type AccountTag = {
  id: string;
  name: string;
  color: "blue" | "emerald" | "amber" | "rose" | "cyan" | "slate";
};

export type Account = {
  id: string;
  email: string;
  displayName: string;
  note: string;
  tags: AccountTag[];
  verifyStatus: string;
  runtimeStatus: string;
  pullIntervalSec: number;
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  totalMessages: number;
  lastMessageAt: string | null;
};

export type MessageSummary = {
  id: string;
  accountId: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  textPreview: string | null;
  hasHtml: boolean;
  hasAttachments: boolean;
};

export type MessageDetail = MessageSummary & {
  headers: Record<string, string>;
  htmlContent: string | null;
  textContent: string | null;
};

export type ImportResult = {
  lineNumber: number;
  email: string | null;
  status: "success" | "error";
  message: string;
  accountId?: string;
};

export type Settings = {
  pullIntervalSec: number;
  maxConcurrency: number;
  retryBackoffSec: number;
  pushMode: string;
  schedulerTickMs: number;
  dataRoot: string;
  messagesRoot: string;
};

export type AppEvent = {
  type: string;
  accountId?: string;
  messageId?: string;
  status?: string;
  insertedCount?: number;
};
