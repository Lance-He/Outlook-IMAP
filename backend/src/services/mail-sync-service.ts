import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { appConfig } from "../config.js";
import { decryptText, encryptText } from "../crypto.js";
import { db } from "../db.js";
import { EventBus } from "./event-bus.js";
import { OutlookOAuthService } from "./outlook-oauth-service.js";

function stripMarkup(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function stringifyHeaderValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyHeaderValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export class MailSyncService {
  constructor(
    private oauthService: OutlookOAuthService,
    private eventBus: EventBus
  ) {}

  async verifyCredentials(input: {
    email: string;
    clientId: string;
    refreshToken: string;
    tenant?: string;
  }) {
    const token = await this.oauthService.refreshAccessToken(input);
    const client = new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: {
        user: input.email,
        accessToken: token.accessToken
      }
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      const uidValidity = client.mailbox ? String(client.mailbox.uidValidity || "") : "";
      lock.release();
      await client.logout();

      return {
        refreshToken: token.refreshToken ?? input.refreshToken,
        uidValidity
      };
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  async syncAccount(accountId: string, triggerType: "schedule" | "start" | "verify" = "schedule") {
    const account = db.getAccountById(accountId);
    if (!account) {
      throw new Error("账户不存在");
    }

    const refreshToken = decryptText(account.refresh_token_encrypted);
    if (!refreshToken) {
      throw new Error("refresh_token 缺失");
    }

    const syncJobId = db.createSyncJob(account.id, triggerType);
    db.updateAccountStatus(account.id, {
      runtimeStatus: "同步中",
      lastError: null
    });
    this.eventBus.broadcast({
      type: "sync_started",
      accountId: account.id
    });

    const token = await this.oauthService.refreshAccessToken({
      clientId: account.client_id,
      refreshToken,
      tenant: account.tenant
    });

    if (token.refreshToken && token.refreshToken !== refreshToken) {
      db.updateRefreshToken(account.id, encryptText(token.refreshToken)!);
    }

    const client = new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: {
        user: account.email,
        accessToken: token.accessToken
      }
    });

    let insertedCount = 0;
    let latestUid = account.last_uid;

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      const range = latestUid > 0 ? `${latestUid + 1}:*` : "1:*";
      const uidValidity = client.mailbox
        ? String(client.mailbox.uidValidity || account.uid_validity || "")
        : String(account.uid_validity || "");

      for await (const item of client.fetch(range, {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
        bodyStructure: true,
        source: true
      }, {
        uid: true
      })) {
        if (!item.uid || item.uid <= latestUid) {
          continue;
        }

        latestUid = Math.max(latestUid, item.uid);

        const rawBuffer = item.source;
        if (!rawBuffer) {
          continue;
        }

        const parsed = await simpleParser(rawBuffer);
        const relativePath = path.join(account.id, `${item.uid}.eml`);
        const absolutePath = path.join(appConfig.messagesRoot, relativePath);

        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, rawBuffer);

        const headers = Object.fromEntries(
          [...parsed.headers.entries()].map(([key, value]) => [key, stringifyHeaderValue(value)])
        );
        const textPreview = (parsed.text || stripMarkup(parsed.html ? String(parsed.html) : ""))
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240);

        const internalDate =
          item.internalDate instanceof Date
            ? item.internalDate.toISOString()
            : item.internalDate
              ? new Date(item.internalDate).toISOString()
              : new Date().toISOString();

        const messageId = db.insertMessage({
          accountId: account.id,
          imapUid: item.uid,
          messageId: parsed.messageId || null,
          subject: parsed.subject || item.envelope?.subject || "(无主题)",
          fromName: parsed.from?.value?.[0]?.name || item.envelope?.from?.[0]?.name || null,
          fromAddress:
            parsed.from?.value?.[0]?.address || item.envelope?.from?.[0]?.address || null,
          toAddresses: JSON.stringify(parsed.to?.value || []),
          receivedAt: parsed.date?.toISOString() || internalDate,
          hasHtml: Boolean(parsed.html),
          hasText: Boolean(parsed.text),
          hasAttachments: (parsed.attachments?.length || 0) > 0,
          textPreview,
          flagsJson: JSON.stringify(item.flags ? [...item.flags] : []),
          headersJson: JSON.stringify(headers),
          rawEmlPath: relativePath,
          htmlCache: parsed.html ? String(parsed.html) : null,
          textCache: parsed.text || null
        });

        if (messageId) {
          insertedCount += 1;
          this.eventBus.broadcast({
            type: "new_message",
            accountId: account.id,
            messageId
          });
        }
      }

      lock.release();
      await client.logout();

      const intervalSec = db.getSettings().pullIntervalSec;
      const nextSyncAt = new Date(Date.now() + intervalSec * 1000).toISOString();
      db.updateAccountStatus(account.id, {
        verifyStatus: "验证成功",
        runtimeStatus: account.enabled ? "正常" : "等待中",
        lastError: null,
        lastSyncAt: new Date().toISOString(),
        lastUid: latestUid,
        uidValidity,
        nextSyncAt
      });
      db.finishSyncJob(syncJobId, "success", null);

      this.eventBus.broadcast({
        type: "sync_succeeded",
        accountId: account.id,
        status: "success",
        insertedCount
      });

      return { insertedCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      const retryBackoffSec = db.getSettings().retryBackoffSec;
      db.updateAccountStatus(account.id, {
        runtimeStatus: "异常",
        lastError: message,
        nextSyncAt: new Date(Date.now() + retryBackoffSec * 1000).toISOString()
      });
      db.finishSyncJob(syncJobId, "failed", message);
      this.eventBus.broadcast({
        type: "sync_failed",
        accountId: account.id,
        status: "failed"
      });
      throw error;
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  async readRawMessage(relativePath: string) {
    const absolutePath = path.join(appConfig.messagesRoot, relativePath);
    return readFile(absolutePath, "utf8");
  }
}
