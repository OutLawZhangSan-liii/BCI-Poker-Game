import { contextBridge, ipcRenderer } from "electron";
import type { ChallengeRecord } from "../main/challengeModel.js";

type GatewayStatus = "starting" | "ready" | "faulted" | "stopping" | "stopped";
interface GatewayConnection { url: string; token: string; protocolVersion: number; }
interface BrainGameDesktopApi {
  readonly challengeSmokeEnabled: boolean;
  getGatewayStatus(): Promise<GatewayStatus>;
  getGatewayConnection(): Promise<GatewayConnection | null>;
  restartGateway(): Promise<void>;
  openSessionFolder(sessionId?: string): Promise<void>;
  createChallenge(record: ChallengeRecord): Promise<ChallengeRecord>;
  getChallenge(id: string): Promise<ChallengeRecord>;
  listChallenges(): Promise<{ records: ChallengeRecord[]; warnings: string[] }>;
  saveChallenge(record: ChallengeRecord): Promise<ChallengeRecord>;
  onGatewayStatusChanged(listener: (status: GatewayStatus) => void): () => void;
}

const IPC = {
  getStatus: "gateway:get-status",
  getConnection: "gateway:get-connection",
  restart: "gateway:restart",
  openSessionFolder: "session:open-folder",
  statusChanged: "gateway:status-changed",
  challengeCreate: "challenge:create",
  challengeGet: "challenge:get",
  challengeList: "challenge:list",
  challengeSave: "challenge:save",
} as const;

const api: BrainGameDesktopApi = {
  challengeSmokeEnabled: process.argv.includes("--challenge-smoke"),
  getGatewayStatus: () => ipcRenderer.invoke(IPC.getStatus),
  getGatewayConnection: () => ipcRenderer.invoke(IPC.getConnection),
  restartGateway: () => ipcRenderer.invoke(IPC.restart),
  openSessionFolder: (sessionId) => ipcRenderer.invoke(IPC.openSessionFolder, sessionId),
  createChallenge: (record) => ipcRenderer.invoke(IPC.challengeCreate, record),
  getChallenge: (id) => ipcRenderer.invoke(IPC.challengeGet, id),
  listChallenges: () => ipcRenderer.invoke(IPC.challengeList),
  saveChallenge: (record) => ipcRenderer.invoke(IPC.challengeSave, record),
  onGatewayStatusChanged: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: GatewayStatus) => listener(status);
    ipcRenderer.on(IPC.statusChanged, wrapped);
    return () => ipcRenderer.removeListener(IPC.statusChanged, wrapped);
  },
};

contextBridge.exposeInMainWorld("brainGameDesktop", api);
