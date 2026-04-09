import type {
  Account,
  ImportResult,
  MessageDetail,
  MessageSummary,
  Settings
} from "./types";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init?.body !== null;

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        throw new Error(parsed.message || parsed.error || text);
      } catch {
        throw new Error(text);
      }
    }

    throw new Error(`请求失败: ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  getSettings() {
    return requestJson<Settings>("/api/settings");
  },

  updateSettings(payload: {
    pullIntervalSec?: number;
    maxConcurrency?: number;
    retryBackoffSec?: number;
  }) {
    return requestJson<Settings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  getAccounts() {
    return requestJson<Account[]>("/api/accounts");
  },

  importAccounts(bulkText: string) {
    return requestJson<{ results: ImportResult[] }>("/api/accounts/import/commit", {
      method: "POST",
      body: JSON.stringify({ bulkText })
    });
  },

  updateAccount(
    accountId: string,
    payload: {
      displayName?: string;
      note?: string;
    }
  ) {
    return requestJson<{ success: boolean }>(`/api/accounts/${accountId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  startAccount(accountId: string) {
    return requestJson<{ success: boolean }>(`/api/accounts/${accountId}/start`, {
      method: "POST"
    });
  },

  stopAccount(accountId: string) {
    return requestJson<{ success: boolean }>(`/api/accounts/${accountId}/stop`, {
      method: "POST"
    });
  },

  syncAccount(accountId: string) {
    return requestJson<{ success: boolean }>(`/api/accounts/${accountId}/sync`, {
      method: "POST"
    });
  },

  deleteAccount(accountId: string) {
    return requestJson<{ success: boolean }>(`/api/accounts/${accountId}`, {
      method: "DELETE"
    });
  },

  getMessages(accountId: string) {
    return requestJson<MessageSummary[]>(`/api/accounts/${accountId}/messages`);
  },

  getMessage(messageId: string) {
    return requestJson<MessageDetail>(`/api/messages/${messageId}`);
  },

  async getRawMessage(messageId: string) {
    const response = await fetch(`/api/messages/${messageId}/raw`);
    if (!response.ok) {
      throw new Error((await response.text()) || "原始邮件读取失败");
    }

    return response.text();
  }
};
