import { encryptText } from "../crypto.js";
import { db } from "../db.js";
import { EventBus } from "./event-bus.js";
import { MailSyncService } from "./mail-sync-service.js";

type ParsedLine = {
  lineNumber: number;
  raw: string;
  email: string | null;
  password: string | null;
  clientId: string | null;
  refreshToken: string | null;
  parseError?: string;
};

type ImportResult = {
  lineNumber: number;
  email: string | null;
  status: "success" | "error";
  message: string;
  accountId?: string;
};

type QueuedImport = {
  email: string;
  clientId: string;
  refreshToken: string;
  accountId: string;
};

function parseBulkText(bulkText: string) {
  return bulkText
    .split(/\r?\n/)
    .map((raw, index): ParsedLine | null => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return null;
      }

      const parts = trimmed.split("----").map((item) => item.trim());
      if (parts.length !== 4 || parts.some((part) => !part)) {
        return {
          lineNumber: index + 1,
          raw,
          email: null,
          password: null,
          clientId: null,
          refreshToken: null,
          parseError: "格式错误，必须严格是 邮箱----密码----client_id----refresh_token"
        };
      }

      return {
        lineNumber: index + 1,
        raw,
        email: parts[0],
        password: parts[1],
        clientId: parts[2],
        refreshToken: parts[3]
      };
    })
    .filter(Boolean) as ParsedLine[];
}

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function consume() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()));
  return results;
}

export class ImportService {
  constructor(
    private syncService: MailSyncService,
    private eventBus: EventBus
  ) {}

  preview(bulkText: string) {
    return parseBulkText(bulkText).map((line) => ({
      lineNumber: line.lineNumber,
      email: line.email,
      status: line.parseError ? "error" : "success",
      message: line.parseError ? line.parseError : "格式检查通过"
    }));
  }

  async commit(bulkText: string) {
    const parsedLines = parseBulkText(bulkText);
    const results: ImportResult[] = [];
    const queuedImports: QueuedImport[] = [];
    const globalPullIntervalSec = db.getSettings().pullIntervalSec;

    for (const line of parsedLines) {
      if (line.parseError) {
        results.push({
          lineNumber: line.lineNumber,
          email: line.email,
          status: "error",
          message: line.parseError || "格式错误"
        });
        continue;
      }

      if (!line.email || !line.password || !line.clientId || !line.refreshToken) {
        results.push({
          lineNumber: line.lineNumber,
          email: line.email,
          status: "error",
          message: "关键信息缺失"
        });
        continue;
      }

      if (db.getAccountByEmail(line.email)) {
        results.push({
          lineNumber: line.lineNumber,
          email: line.email,
          status: "error",
          message: "该邮箱已存在"
        });
        continue;
      }

      const accountId = db.createAccount({
        email: line.email,
        displayName: line.email,
        passwordEncrypted: encryptText(line.password),
        clientId: line.clientId,
        refreshTokenEncrypted: encryptText(line.refreshToken)!,
        tenant: "common",
        verifyStatus: "导入中",
        runtimeStatus: "导入中",
        pullIntervalSec: globalPullIntervalSec,
        enabled: false
      });

      queuedImports.push({
        email: line.email,
        clientId: line.clientId,
        refreshToken: line.refreshToken,
        accountId
      });

      results.push({
        lineNumber: line.lineNumber,
        email: line.email,
        status: "success",
        message: "已加入导入队列",
        accountId
      });
    }

    if (queuedImports.length > 0) {
      this.eventBus.broadcast({
        type: "account_status_changed"
      });
      this.processQueuedImports(queuedImports);
    }

    return {
      results: results.sort((left, right) => left.lineNumber - right.lineNumber)
    };
  }

  private processQueuedImports(items: QueuedImport[]) {
    void runWithLimit(items, 3, async (item) => {
      await this.verifyQueuedImport(item);
      return null;
    }).catch((error) => {
      console.error("后台导入验证任务异常", error);
    });
  }

  private async verifyQueuedImport(item: QueuedImport) {
    try {
      const verified = await this.syncService.verifyCredentials({
        email: item.email,
        clientId: item.clientId,
        refreshToken: item.refreshToken
      });

      db.updateRefreshToken(item.accountId, encryptText(verified.refreshToken)!);
      db.updateAccountStatus(item.accountId, {
        verifyStatus: "验证成功",
        runtimeStatus: "等待中",
        lastError: null,
        uidValidity: verified.uidValidity,
        nextSyncAt: null
      });

      this.eventBus.broadcast({
        type: "account_verified",
        accountId: item.accountId
      });
      this.eventBus.broadcast({
        type: "account_status_changed",
        accountId: item.accountId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "验证失败";
      db.updateAccountStatus(item.accountId, {
        verifyStatus: "导入失败",
        runtimeStatus: "导入失败",
        lastError: message,
        nextSyncAt: null
      });

      this.eventBus.broadcast({
        type: "account_import_failed",
        accountId: item.accountId,
        status: "failed"
      });
      this.eventBus.broadcast({
        type: "account_status_changed",
        accountId: item.accountId
      });
    }
  }
}
