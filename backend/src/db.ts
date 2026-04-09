import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appConfig } from "./config.js";

export type AccountRow = {
  id: string;
  email: string;
  display_name: string;
  note: string;
  password_encrypted: string | null;
  client_id: string;
  refresh_token_encrypted: string;
  tenant: string;
  verify_status: string;
  runtime_status: string;
  pull_interval_sec: number;
  enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
  last_uid: number;
  uid_validity: string | null;
  next_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  account_id: string;
  subject: string;
  from_name: string | null;
  from_address: string | null;
  received_at: string | null;
  text_preview: string | null;
  has_html: number;
  has_attachments: number;
  headers_json: string;
  html_cache: string | null;
  text_cache: string | null;
  raw_eml_path: string;
};

type SanitizedAccount = {
  id: string;
  email: string;
  displayName: string;
  note: string;
  verifyStatus: string;
  runtimeStatus: string;
  pullIntervalSec: number;
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  totalMessages: number;
  lastMessageAt: string | null;
};

type MessageSummary = {
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

type SettingsRow = {
  default_pull_interval_sec: number;
  max_concurrency: number;
  retry_backoff_sec: number;
};

type AppSettings = {
  pullIntervalSec: number;
  maxConcurrency: number;
  retryBackoffSec: number;
  pushMode: string;
  schedulerTickMs: number;
  dataRoot: string;
  messagesRoot: string;
};

mkdirSync(path.dirname(appConfig.databaseFile), { recursive: true });
mkdirSync(appConfig.messagesRoot, { recursive: true });

const database = new Database(appConfig.databaseFile);
database.pragma("journal_mode = WAL");

database.exec(`
  CREATE TABLE IF NOT EXISTS mail_accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    password_encrypted TEXT,
    client_id TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    tenant TEXT NOT NULL DEFAULT 'common',
    verify_status TEXT NOT NULL,
    runtime_status TEXT NOT NULL,
    pull_interval_sec INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT,
    last_error TEXT,
    last_uid INTEGER NOT NULL DEFAULT 0,
    uid_validity TEXT,
    next_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_jobs (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    imap_uid INTEGER NOT NULL,
    message_id TEXT,
    subject TEXT NOT NULL,
    from_name TEXT,
    from_address TEXT,
    to_addresses TEXT,
    received_at TEXT,
    has_html INTEGER NOT NULL DEFAULT 0,
    has_text INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    text_preview TEXT,
    flags_json TEXT NOT NULL,
    headers_json TEXT NOT NULL,
    raw_eml_path TEXT NOT NULL,
    html_cache TEXT,
    text_cache TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(account_id, imap_uid)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    default_pull_interval_sec INTEGER NOT NULL,
    max_concurrency INTEGER NOT NULL,
    retry_backoff_sec INTEGER NOT NULL
  );
`);

export const db = {
  ensureDefaults() {
    database.prepare(
      `
        INSERT OR IGNORE INTO app_settings (
          singleton,
          default_pull_interval_sec,
          max_concurrency,
          retry_backoff_sec
        ) VALUES (1, ?, ?, ?)
      `
    ).run(appConfig.defaultPullIntervalSec, appConfig.maxConcurrency, appConfig.retryBackoffSec);
  },

  getSettings(): AppSettings {
    this.ensureDefaults();
    const row = database
      .prepare(
        `
          SELECT
            default_pull_interval_sec,
            max_concurrency,
            retry_backoff_sec
          FROM app_settings
          WHERE singleton = 1
        `
      )
      .get() as SettingsRow | undefined;

    return {
      pullIntervalSec: row?.default_pull_interval_sec ?? appConfig.defaultPullIntervalSec,
      maxConcurrency: row?.max_concurrency ?? appConfig.maxConcurrency,
      retryBackoffSec: row?.retry_backoff_sec ?? appConfig.retryBackoffSec,
      pushMode: "SSE",
      schedulerTickMs: appConfig.schedulerTickMs,
      dataRoot: appConfig.dataRoot,
      messagesRoot: appConfig.messagesRoot
    };
  },

  updateSettings(patch: {
    pullIntervalSec?: number;
    maxConcurrency?: number;
    retryBackoffSec?: number;
  }): AppSettings {
    this.ensureDefaults();
    const current = this.getSettings();
    const nextIntervalSec = patch.pullIntervalSec ?? current.pullIntervalSec;

    database.prepare(
      `
        UPDATE app_settings
        SET default_pull_interval_sec = ?,
            max_concurrency = ?,
            retry_backoff_sec = ?
        WHERE singleton = 1
      `
    ).run(
      nextIntervalSec,
      patch.maxConcurrency ?? current.maxConcurrency,
      patch.retryBackoffSec ?? current.retryBackoffSec
    );

    if (Object.prototype.hasOwnProperty.call(patch, "pullIntervalSec")) {
      this.rescheduleAccounts(nextIntervalSec);
    }

    return this.getSettings();
  },

  rescheduleAccounts(intervalSec: number) {
    const nextSyncAt = new Date(Date.now() + intervalSec * 1000).toISOString();
    database
      .prepare(
        `
          UPDATE mail_accounts
          SET pull_interval_sec = ?,
              next_sync_at = CASE
                WHEN enabled = 1 AND verify_status = '验证成功' THEN ?
                ELSE next_sync_at
              END,
              updated_at = ?
        `
      )
      .run(intervalSec, nextSyncAt, new Date().toISOString());
  },

  listAccounts(): SanitizedAccount[] {
    const rows = database
      .prepare(
        `
          SELECT
            a.id,
            a.email,
            a.display_name AS displayName,
            a.note,
            a.verify_status AS verifyStatus,
            a.runtime_status AS runtimeStatus,
            a.pull_interval_sec AS pullIntervalSec,
            a.enabled,
            a.last_sync_at AS lastSyncAt,
            a.last_error AS lastError,
            COUNT(m.id) AS totalMessages,
            MAX(m.received_at) AS lastMessageAt
          FROM mail_accounts a
          LEFT JOIN messages m ON m.account_id = a.id
          GROUP BY a.id
          ORDER BY a.created_at DESC
        `
      )
      .all() as Array<Omit<SanitizedAccount, "enabled"> & { enabled: number }>;

    return rows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled)
    }));
  },

  getAccountById(accountId: string) {
    return database.prepare(`SELECT * FROM mail_accounts WHERE id = ?`).get(accountId) as AccountRow | undefined;
  },

  getAccountByEmail(email: string) {
    return database.prepare(`SELECT * FROM mail_accounts WHERE email = ?`).get(email) as AccountRow | undefined;
  },

  createAccount(input: {
    email: string;
    displayName: string;
    note?: string;
    passwordEncrypted: string | null;
    clientId: string;
    refreshTokenEncrypted: string;
    tenant: string;
    verifyStatus: string;
    runtimeStatus: string;
    pullIntervalSec: number;
    enabled: boolean;
  }) {
    const now = new Date().toISOString();
    const id = randomUUID();

    database.prepare(
      `
        INSERT INTO mail_accounts (
          id, email, display_name, note, password_encrypted, client_id,
          refresh_token_encrypted, tenant, verify_status, runtime_status,
          pull_interval_sec, enabled, created_at, updated_at
        ) VALUES (
          @id, @email, @display_name, @note, @password_encrypted, @client_id,
          @refresh_token_encrypted, @tenant, @verify_status, @runtime_status,
          @pull_interval_sec, @enabled, @created_at, @updated_at
        )
      `
    ).run({
      id,
      email: input.email,
      display_name: input.displayName,
      note: input.note ?? "",
      password_encrypted: input.passwordEncrypted,
      client_id: input.clientId,
      refresh_token_encrypted: input.refreshTokenEncrypted,
      tenant: input.tenant,
      verify_status: input.verifyStatus,
      runtime_status: input.runtimeStatus,
      pull_interval_sec: input.pullIntervalSec,
      enabled: input.enabled ? 1 : 0,
      created_at: now,
      updated_at: now
    });

    return id;
  },

  updateAccount(accountId: string, patch: { displayName?: string; note?: string }) {
    const current = this.getAccountById(accountId);
    if (!current) return null;

    const next = {
      display_name: patch.displayName ?? current.display_name,
      note: patch.note ?? current.note,
      pull_interval_sec: current.pull_interval_sec,
      next_sync_at: current.next_sync_at,
      updated_at: new Date().toISOString(),
      id: accountId
    };

    database.prepare(
      `
        UPDATE mail_accounts
        SET display_name = @display_name,
            note = @note,
            pull_interval_sec = @pull_interval_sec,
            next_sync_at = @next_sync_at,
            updated_at = @updated_at
        WHERE id = @id
      `
    ).run(next);

    return this.getAccountById(accountId);
  },

  deleteAccount(accountId: string) {
    const existing = this.getAccountById(accountId);
    if (!existing) {
      return false;
    }

    const transaction = database.transaction((id: string) => {
      database.prepare(`DELETE FROM messages WHERE account_id = ?`).run(id);
      database.prepare(`DELETE FROM sync_jobs WHERE account_id = ?`).run(id);
      database.prepare(`DELETE FROM mail_accounts WHERE id = ?`).run(id);
    });

    transaction(accountId);
    return true;
  },

  setAccountEnabled(accountId: string, enabled: boolean) {
    const intervalSec = this.getSettings().pullIntervalSec;
    const nextSyncAt = enabled ? new Date(Date.now() + intervalSec * 1000).toISOString() : null;
    database.prepare(
      `
        UPDATE mail_accounts
        SET enabled = ?, runtime_status = ?, next_sync_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `
    ).run(
      enabled ? 1 : 0,
      enabled ? "排队中" : "等待中",
      nextSyncAt,
      enabled ? null : null,
      new Date().toISOString(),
      accountId
    );
  },

  updateAccountStatus(
    accountId: string,
    patch: {
      verifyStatus?: string;
      runtimeStatus?: string;
      lastError?: string | null;
      lastSyncAt?: string | null;
      lastUid?: number;
      uidValidity?: string | null;
      nextSyncAt?: string | null;
    }
  ) {
    const current = this.getAccountById(accountId);
    if (!current) return;

    database.prepare(
      `
        UPDATE mail_accounts
        SET verify_status = @verify_status,
            runtime_status = @runtime_status,
            last_error = @last_error,
            last_sync_at = @last_sync_at,
            last_uid = @last_uid,
            uid_validity = @uid_validity,
            next_sync_at = @next_sync_at,
            updated_at = @updated_at
        WHERE id = @id
      `
    ).run({
      id: accountId,
      verify_status: Object.prototype.hasOwnProperty.call(patch, "verifyStatus")
        ? patch.verifyStatus
        : current.verify_status,
      runtime_status: Object.prototype.hasOwnProperty.call(patch, "runtimeStatus")
        ? patch.runtimeStatus
        : current.runtime_status,
      last_error: Object.prototype.hasOwnProperty.call(patch, "lastError")
        ? patch.lastError
        : current.last_error,
      last_sync_at: Object.prototype.hasOwnProperty.call(patch, "lastSyncAt")
        ? patch.lastSyncAt
        : current.last_sync_at,
      last_uid: Object.prototype.hasOwnProperty.call(patch, "lastUid")
        ? patch.lastUid
        : current.last_uid,
      uid_validity: Object.prototype.hasOwnProperty.call(patch, "uidValidity")
        ? patch.uidValidity
        : current.uid_validity,
      next_sync_at: Object.prototype.hasOwnProperty.call(patch, "nextSyncAt")
        ? patch.nextSyncAt
        : current.next_sync_at,
      updated_at: new Date().toISOString()
    });
  },

  updateRefreshToken(accountId: string, refreshTokenEncrypted: string) {
    database.prepare(
      `
        UPDATE mail_accounts
        SET refresh_token_encrypted = ?, updated_at = ?
        WHERE id = ?
      `
    ).run(refreshTokenEncrypted, new Date().toISOString(), accountId);
  },

  listDueAccounts(nowIso: string, limit: number) {
    return database
      .prepare(
        `
          SELECT *
          FROM mail_accounts
          WHERE enabled = 1
            AND verify_status = '验证成功'
            AND (next_sync_at IS NULL OR next_sync_at <= ?)
          ORDER BY COALESCE(next_sync_at, created_at) ASC
          LIMIT ?
        `
      )
      .all(nowIso, limit) as AccountRow[];
  },

  createSyncJob(accountId: string, jobType: string) {
    const id = randomUUID();
    database.prepare(
      `
        INSERT INTO sync_jobs (id, account_id, job_type, status, started_at)
        VALUES (?, ?, ?, 'running', ?)
      `
    ).run(id, accountId, jobType, new Date().toISOString());

    return id;
  },

  finishSyncJob(syncJobId: string, status: string, errorMessage: string | null) {
    database.prepare(
      `
        UPDATE sync_jobs
        SET status = ?, error_message = ?, finished_at = ?
        WHERE id = ?
      `
    ).run(status, errorMessage, new Date().toISOString(), syncJobId);
  },

  insertMessage(input: {
    accountId: string;
    imapUid: number;
    messageId: string | null;
    subject: string;
    fromName: string | null;
    fromAddress: string | null;
    toAddresses: string | null;
    receivedAt: string | null;
    hasHtml: boolean;
    hasText: boolean;
    hasAttachments: boolean;
    textPreview: string | null;
    flagsJson: string;
    headersJson: string;
    rawEmlPath: string;
    htmlCache: string | null;
    textCache: string | null;
  }) {
    const id = randomUUID();
    const result = database.prepare(
      `
        INSERT OR IGNORE INTO messages (
          id, account_id, imap_uid, message_id, subject, from_name, from_address,
          to_addresses, received_at, has_html, has_text, has_attachments, text_preview,
          flags_json, headers_json, raw_eml_path, html_cache, text_cache, created_at
        ) VALUES (
          @id, @account_id, @imap_uid, @message_id, @subject, @from_name, @from_address,
          @to_addresses, @received_at, @has_html, @has_text, @has_attachments, @text_preview,
          @flags_json, @headers_json, @raw_eml_path, @html_cache, @text_cache, @created_at
        )
      `
    ).run({
      id,
      account_id: input.accountId,
      imap_uid: input.imapUid,
      message_id: input.messageId,
      subject: input.subject,
      from_name: input.fromName,
      from_address: input.fromAddress,
      to_addresses: input.toAddresses,
      received_at: input.receivedAt,
      has_html: input.hasHtml ? 1 : 0,
      has_text: input.hasText ? 1 : 0,
      has_attachments: input.hasAttachments ? 1 : 0,
      text_preview: input.textPreview,
      flags_json: input.flagsJson,
      headers_json: input.headersJson,
      raw_eml_path: input.rawEmlPath,
      html_cache: input.htmlCache,
      text_cache: input.textCache,
      created_at: new Date().toISOString()
    });

    return result.changes > 0 ? id : null;
  },

  listMessages(accountId: string) {
    type MessageSummaryRow = {
      id: string;
      accountId: string;
      subject: string;
      fromName: string | null;
      fromAddress: string | null;
      receivedAt: string | null;
      textPreview: string | null;
      hasHtml: number;
      hasAttachments: number;
    };

    const rows = database
      .prepare(
        `
          SELECT
            id,
            account_id AS accountId,
            subject,
            from_name AS fromName,
            from_address AS fromAddress,
            received_at AS receivedAt,
            text_preview AS textPreview,
            has_html AS hasHtml,
            has_attachments AS hasAttachments
          FROM messages
          WHERE account_id = ?
          ORDER BY COALESCE(received_at, created_at) DESC
          LIMIT 200
        `
      )
      .all(accountId) as MessageSummaryRow[];

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      subject: row.subject,
      fromName: row.fromName,
      fromAddress: row.fromAddress,
      receivedAt: row.receivedAt,
      textPreview: row.textPreview,
      hasHtml: Boolean(row.hasHtml),
      hasAttachments: Boolean(row.hasAttachments)
    }));
  },

  getMessageById(messageId: string) {
    const row = database
      .prepare(
        `
          SELECT
            id,
            account_id AS account_id,
            subject,
            from_name,
            from_address,
            received_at,
            text_preview,
            has_html,
            has_attachments,
            headers_json,
            html_cache,
            text_cache,
            raw_eml_path
          FROM messages
          WHERE id = ?
        `
      )
      .get(messageId) as MessageRow | undefined;

    if (!row) return null;

    return {
      id: row.id,
      accountId: row.account_id,
      subject: row.subject,
      fromName: row.from_name,
      fromAddress: row.from_address,
      receivedAt: row.received_at,
      textPreview: row.text_preview,
      hasHtml: Boolean(row.has_html),
      hasAttachments: Boolean(row.has_attachments),
      headers: JSON.parse(row.headers_json) as Record<string, string>,
      htmlContent: row.html_cache,
      textContent: row.text_cache,
      rawEmlPath: row.raw_eml_path
    };
  }
};
