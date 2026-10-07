import { GATEWAY_PROTOCOL_VERSION, parseEegChunk, type EegChunk } from "./protocol";

interface GatewayConnection { url: string; token: string; protocolVersion: number; }
export interface CommandResult<T = unknown> {
  protocolVersion: number; requestId: string; type: "command_result"; command: string;
  ok: boolean; confirmation: string; error: { code: string; message: string } | null; data: T;
}
type PendingRequest = { resolve: (result: CommandResult) => void; reject: (error: Error) => void; timer: number; };

export class GatewayClient extends EventTarget {
  private socket: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private authenticated = false;
  get connected(): boolean { return this.authenticated && this.socket?.readyState === WebSocket.OPEN; }

  async connect(connection: GatewayConnection): Promise<void> {
    this.disconnect();
    if (connection.protocolVersion !== GATEWAY_PROTOCOL_VERSION) throw new Error("preload and renderer gateway versions do not match");
    const socket = new WebSocket(connection.url); socket.binaryType = "arraybuffer"; this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("gateway hello timed out")), 3_000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "hello", token: connection.token, protocolVersion: GATEWAY_PROTOCOL_VERSION })));
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as { type?: string; ok?: boolean };
          if (message.type !== "hello_result") return;
          window.clearTimeout(timer);
          if (!message.ok) reject(new Error("gateway rejected hello"));
          else { this.authenticated = true; resolve(); }
        } catch (error) { reject(error); }
      }, { once: true });
      socket.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("gateway WebSocket connection failed")); }, { once: true });
    });
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("close", this.onClose, { once: true });
    this.dispatchEvent(new Event("connected"));
  }

  private onMessage = (event: MessageEvent<string | ArrayBuffer>) => {
    if (event.data instanceof ArrayBuffer) {
      try {
        this.dispatchEvent(new CustomEvent<EegChunk>("eeg", { detail: parseEegChunk(event.data) }));
        this.dispatchEvent(new CustomEvent<ArrayBuffer>("eeg-binary", { detail: event.data }));
      }
      catch (error) { this.dispatchEvent(new CustomEvent<Error>("protocol-error", { detail: error as Error })); }
      return;
    }
    try {
      const result = JSON.parse(event.data) as CommandResult;
      if (result.type !== "command_result") return;
      const pending = this.pending.get(result.requestId); if (!pending) return;
      window.clearTimeout(pending.timer); this.pending.delete(result.requestId);
      if (result.ok) pending.resolve(result); else pending.reject(new Error(result.error?.message ?? `${result.command} failed`));
    } catch (error) { this.dispatchEvent(new CustomEvent<Error>("protocol-error", { detail: error as Error })); }
  };

  private onClose = () => {
    this.authenticated = false;
    for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(new Error("gateway disconnected")); }
    this.pending.clear(); this.dispatchEvent(new Event("disconnected"));
  };

  command<T = unknown>(type: string, data: Record<string, unknown> = {}): Promise<CommandResult<T>> {
    if (!this.connected || !this.socket) return Promise.reject(new Error("gateway is not connected"));
    const requestId = crypto.randomUUID();
    return new Promise<CommandResult<T>>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(requestId); reject(new Error(`${type} timed out`)); }, 5_000);
      this.pending.set(requestId, { resolve: resolve as (result: CommandResult) => void, reject, timer });
      this.socket!.send(JSON.stringify({ protocolVersion: GATEWAY_PROTOCOL_VERSION, requestId, type, ...data }));
    });
  }

  disconnect(): void {
    const socket = this.socket; this.socket = null; this.authenticated = false;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "renderer disconnect");
    for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(new Error("gateway disconnected")); }
    this.pending.clear();
  }
}
