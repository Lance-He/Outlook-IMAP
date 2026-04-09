import { rm } from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { appConfig } from "./config.js";
import { db } from "./db.js";
import { EventBus } from "./services/event-bus.js";
import { ImportService } from "./services/import-service.js";
import { MailSyncService } from "./services/mail-sync-service.js";
import { OutlookOAuthService } from "./services/outlook-oauth-service.js";
import { SchedulerService } from "./services/scheduler-service.js";

const eventBus = new EventBus();
const oauthService = new OutlookOAuthService();
const mailSyncService = new MailSyncService(oauthService, eventBus);
const importService = new ImportService(mailSyncService, eventBus);
const schedulerService = new SchedulerService(mailSyncService);

export async function buildServer() {
  const app = Fastify({
    logger: false
  });

  await app.register(cors, {
    origin: true
  });

  app.get("/api/health", async () => ({
    status: "ok",
    pushMode: "SSE"
  }));

  app.get("/api/settings", async () => db.getSettings());

  app.patch("/api/settings", async (request) => {
    const body = request.body as {
      pullIntervalSec?: number;
      maxConcurrency?: number;
      retryBackoffSec?: number;
    };

    const nextSettings = db.updateSettings({
      pullIntervalSec:
        typeof body.pullIntervalSec === "number" ? Math.max(5, Math.floor(body.pullIntervalSec)) : undefined,
      maxConcurrency:
        typeof body.maxConcurrency === "number"
          ? Math.min(Math.max(Math.floor(body.maxConcurrency), 1), 10)
          : undefined,
      retryBackoffSec:
        typeof body.retryBackoffSec === "number"
          ? Math.max(15, Math.floor(body.retryBackoffSec))
          : undefined
    });

    eventBus.broadcast({
      type: "settings_updated"
    });

    return nextSettings;
  });

  app.get("/api/accounts", async () => db.listAccounts());

  app.post("/api/accounts/import/preview", async (request) => {
    const body = request.body as { bulkText?: string };
    return importService.preview(body.bulkText || "");
  });

  app.post("/api/accounts/import/commit", async (request) => {
    const body = request.body as { bulkText?: string };
    return importService.commit(body.bulkText || "");
  });

  app.patch("/api/accounts/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as {
      displayName?: string;
      note?: string;
      tags?: Array<{
        id?: string;
        name?: string;
        color?: string;
      }>;
    };

    const updated = db.updateAccount(params.id, {
      displayName: body.displayName,
      note: body.note,
      tags: body.tags
        ?.filter((tag) => tag && typeof tag.name === "string")
        .map((tag) => ({
          id: tag.id || "",
          name: tag.name || "",
          color: tag.color || "blue"
        }))
    });

    if (!updated) {
      reply.code(404);
      return { message: "账户不存在" };
    }

    eventBus.broadcast({
      type: "account_status_changed",
      accountId: params.id
    });

    return { success: true };
  });

  app.post("/api/accounts/:id/start", async (request, reply) => {
    const params = request.params as { id: string };
    const account = db.getAccountById(params.id);
    if (!account) {
      reply.code(404);
      return { message: "账户不存在" };
    }

    if (account.verify_status !== "验证成功") {
      reply.code(409);
      return {
        message: account.runtime_status === "导入中" ? "账号仍在导入验证中，请稍后再试" : "账号当前导入失败，无法启动自动抓取"
      };
    }

    db.setAccountEnabled(params.id, true);
    eventBus.broadcast({
      type: "account_status_changed",
      accountId: params.id
    });
    await schedulerService.triggerNow(params.id, "start");
    return { success: true };
  });

  app.post("/api/accounts/:id/stop", async (request, reply) => {
    const params = request.params as { id: string };
    const account = db.getAccountById(params.id);
    if (!account) {
      reply.code(404);
      return { message: "账户不存在" };
    }

    db.setAccountEnabled(params.id, false);
    eventBus.broadcast({
      type: "account_status_changed",
      accountId: params.id
    });
    return { success: true };
  });

  app.post("/api/accounts/:id/sync", async (request, reply) => {
    const params = request.params as { id: string };
    const account = db.getAccountById(params.id);
    if (!account) {
      reply.code(404);
      return { message: "账户不存在" };
    }

    if (account.verify_status !== "验证成功") {
      reply.code(409);
      return {
        message: account.runtime_status === "导入中" ? "账号仍在导入验证中，请稍后再试" : "账号当前导入失败，无法手动刷新"
      };
    }

    await schedulerService.triggerNow(params.id, "start");
    return { success: true };
  });

  app.delete("/api/accounts/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const account = db.getAccountById(params.id);
    if (!account) {
      reply.code(404);
      return { message: "账户不存在" };
    }

    db.deleteAccount(params.id);
    await rm(path.join(appConfig.messagesRoot, params.id), {
      recursive: true,
      force: true
    });

    eventBus.broadcast({
      type: "account_status_changed",
      accountId: params.id
    });

    return { success: true };
  });

  app.get("/api/accounts/:id/messages", async (request, reply) => {
    const params = request.params as { id: string };
    const account = db.getAccountById(params.id);
    if (!account) {
      reply.code(404);
      return { message: "账户不存在" };
    }

    return db.listMessages(params.id);
  });

  app.get("/api/messages/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const message = db.getMessageById(params.id);
    if (!message) {
      reply.code(404);
      return { message: "邮件不存在" };
    }

    return message;
  });

  app.get("/api/messages/:id/raw", async (request, reply) => {
    const params = request.params as { id: string };
    const message = db.getMessageById(params.id);
    if (!message) {
      reply.code(404);
      return { message: "邮件不存在" };
    }

    reply.type("text/plain; charset=utf-8");
    return mailSyncService.readRawMessage(message.rawEmlPath);
  });

  app.get("/api/events/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const clientId = eventBus.subscribe(reply.raw);
    request.raw.on("close", () => {
      eventBus.unsubscribe(clientId);
    });
  });

  app.addHook("onClose", async () => {
    schedulerService.stop();
    eventBus.close();
  });

  schedulerService.start();
  return app;
}

export async function startServer() {
  const app = await buildServer();
  await app.listen({
    host: appConfig.serverHost,
    port: appConfig.serverPort
  });

  return app;
}
