import type { ServerResponse } from "node:http";

type BusEvent = {
  type: string;
  accountId?: string;
  messageId?: string;
  status?: string;
  insertedCount?: number;
};

export class EventBus {
  private clients = new Map<string, ServerResponse>();
  private heartbeatTimer: NodeJS.Timeout;

  constructor() {
    this.heartbeatTimer = setInterval(() => {
      for (const response of this.clients.values()) {
        response.write(": ping\n\n");
      }
    }, 25000);
  }

  subscribe(response: ServerResponse) {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, response);
    response.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    return clientId;
  }

  unsubscribe(clientId: string) {
    this.clients.delete(clientId);
  }

  broadcast(event: BusEvent) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of this.clients.values()) {
      response.write(payload);
    }
  }

  close() {
    clearInterval(this.heartbeatTimer);
    for (const response of this.clients.values()) {
      response.end();
    }
    this.clients.clear();
  }
}
