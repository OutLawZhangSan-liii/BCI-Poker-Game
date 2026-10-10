import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import readline from "node:readline";
import type { GatewayConnection, GatewayStatus } from "./types.js";

interface ReadyMessage {
  type: "gateway_ready";
  url: string;
  protocolVersion: number;
}

export interface SidecarOptions {
  projectRoot: string;
  logsDirectory: string;
  sessionsDirectory: string;
  packagedExecutable?: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export class GatewaySidecar extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: GatewayStatus = "stopped";
  private connection: GatewayConnection | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private shutdownTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: SidecarOptions) {
    super();
  }

  getStatus(): GatewayStatus {
    return this.status;
  }

  getConnection(): GatewayConnection | null {
    return this.status === "ready" ? this.connection : null;
  }

  private setStatus(status: GatewayStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.emit("status", status);
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.setStatus("starting");
    const readiness = new Promise<void>((resolve, reject) => {
      const onStatus = (status: GatewayStatus) => {
        if (status === "ready") {
          this.off("status", onStatus);
          resolve();
        } else if (status === "faulted") {
          this.off("status", onStatus);
          reject(new Error("device gateway failed to become ready"));
        }
      };
      this.on("status", onStatus);
    });
    const token = randomBytes(32).toString("base64url");
    const executable = this.options.packagedExecutable ?? "python";
    const args = this.options.packagedExecutable
      ? ["--port", "0"]
      : ["-m", "device_gateway.gateway_app", "--port", "0"];
    const child = spawn(executable, args, {
      // app.asar is a virtual directory, unsuitable as a child process cwd.
      cwd: this.options.packagedExecutable
        ? path.dirname(this.options.packagedExecutable)
        : this.options.projectRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        BRAIN_GAME_GATEWAY_TOKEN: token,
        BRAIN_GAME_LOGS_DIR: this.options.logsDirectory,
        BRAIN_GAME_SESSIONS_DIR: this.options.sessionsDirectory,
      },
    });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line) as ReadyMessage;
        if (message.type !== "gateway_ready") return;
        this.connection = {
          url: message.url,
          token,
          protocolVersion: message.protocolVersion,
        };
        if (this.startupTimer) clearTimeout(this.startupTimer);
        this.startupTimer = null;
        this.setStatus("ready");
      } catch {
        // Non-JSON stdout is diagnostic output, never exposed as connection data.
      }
    });
    child.stderr.on("data", (chunk: Buffer) => this.emit("stderr", chunk.toString("utf8")));
    child.once("error", (error) => {
      this.emit("stderr", String(error));
      this.connection = null;
      this.child = null;
      this.setStatus("faulted");
    });
    child.once("exit", (code, signal) => {
      if (this.startupTimer) clearTimeout(this.startupTimer);
      if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
      this.startupTimer = null;
      this.shutdownTimer = null;
      this.connection = null;
      this.child = null;
      if (this.status === "stopping") this.setStatus("stopped");
      else {
        this.emit("stderr", `gateway exited unexpectedly: code=${code} signal=${signal}`);
        this.setStatus("faulted");
      }
    });
    this.startupTimer = setTimeout(() => {
      this.emit("stderr", "gateway readiness timed out");
      child.kill();
      this.setStatus("faulted");
    }, this.options.startupTimeoutMs ?? 10_000);
    await readiness;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.connection = null;
      this.setStatus("stopped");
      return;
    }
    this.setStatus("stopping");
    child.stdin.write("shutdown\n");
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      this.shutdownTimer = setTimeout(() => {
        if (this.child === child) child.kill();
        resolve();
      }, this.options.shutdownTimeoutMs ?? 5_000);
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
