export type GatewayStatus =
  | "starting"
  | "ready"
  | "faulted"
  | "stopping"
  | "stopped";

export interface GatewayConnection {
  url: string;
  token: string;
  protocolVersion: number;
}

export const IPC = {
  getStatus: "gateway:get-status",
  getConnection: "gateway:get-connection",
  restart: "gateway:restart",
  openSessionFolder: "session:open-folder",
  statusChanged: "gateway:status-changed",
} as const;
