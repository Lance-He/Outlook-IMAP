import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(currentDir, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const dataRoot = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : path.join(workspaceRoot, "data");

export const appConfig = {
  backendRoot,
  workspaceRoot,
  dataRoot,
  messagesRoot: path.join(dataRoot, "messages"),
  databaseFile: path.join(dataRoot, "mail-collector.db"),
  secretFile: path.join(dataRoot, "app-secret.key"),
  serverHost: process.env.HOST ?? "127.0.0.1",
  serverPort: Number(process.env.PORT ?? 3030),
  defaultPullIntervalSec: Number(process.env.DEFAULT_PULL_INTERVAL_SEC ?? 60),
  schedulerTickMs: Number(process.env.SCHEDULER_TICK_MS ?? 5000),
  maxConcurrency: Number(process.env.MAX_CONCURRENCY ?? 3),
  retryBackoffSec: Number(process.env.RETRY_BACKOFF_SEC ?? 30)
} as const;
