import { appConfig } from "../config.js";
import { db } from "../db.js";
import { MailSyncService } from "./mail-sync-service.js";

export class SchedulerService {
  private timer?: NodeJS.Timeout;
  private running = new Set<string>();

  constructor(private syncService: MailSyncService) {}

  start() {
    this.timer = setInterval(() => {
      void this.tick();
    }, appConfig.schedulerTickMs);

    void this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async triggerNow(accountId: string, triggerType: "start" | "schedule" = "start") {
    if (this.running.has(accountId)) {
      return false;
    }

    void this.runAccount(accountId, triggerType);
    return true;
  }

  private async tick() {
    const availableSlots = Math.max(db.getSettings().maxConcurrency - this.running.size, 0);
    if (availableSlots <= 0) {
      return;
    }

    const dueAccounts = db.listDueAccounts(new Date().toISOString(), availableSlots);
    for (const account of dueAccounts) {
      if (this.running.has(account.id)) {
        continue;
      }

      void this.runAccount(account.id, "schedule");
    }
  }

  private async runAccount(accountId: string, triggerType: "start" | "schedule") {
    this.running.add(accountId);

    try {
      await this.syncService.syncAccount(accountId, triggerType);
    } catch (error) {
      console.error(`账号 ${accountId} 同步失败`, error);
    } finally {
      this.running.delete(accountId);
    }
  }
}
