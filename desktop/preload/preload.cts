import { contextBridge, ipcRenderer } from "electron";

type GatewayStatus = "starting" | "ready" | "faulted" | "stopping" | "stopped";
interface GatewayConnection { url: string; token: string; protocolVersion: number; }
interface BrainGameDesktopApi {
  getGatewayStatus(): Promise<GatewayStatus>;
  getGatewayConnection(): Promise<GatewayConnection | null>;
  restartGateway(): Promise<void>;
  openSessionFolder(sessionId?: string): Promise<void>;
  onGatewayStatusChanged(listener: (status: GatewayStatus) => void): () => void;
}

const IPC = {
  getStatus: "gateway:get-status",
  getConnection: "gateway:get-connection",
  restart: "gateway:restart",
  openSessionFolder: "session:open-folder",
  statusChanged: "gateway:status-changed",
} as const;

const api: BrainGameDesktopApi = {
  getGatewayStatus: () => ipcRenderer.invoke(IPC.getStatus),
  getGatewayConnection: () => ipcRenderer.invoke(IPC.getConnection),
  restartGateway: () => ipcRenderer.invoke(IPC.restart),
  openSessionFolder: (sessionId) => ipcRenderer.invoke(IPC.openSessionFolder, sessionId),
  onGatewayStatusChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: GatewayStatus) => listener(status);
    ipcRenderer.on(IPC.statusChanged, wrapped);
    return () => ipcRenderer.removeListener(IPC.statusChanged, wrapped);
  },
};

contextBridge.exposeInMainWorld("brainGameDesktop", api);
