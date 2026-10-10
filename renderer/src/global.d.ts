type GatewayStatus = "starting" | "ready" | "faulted" | "stopping" | "stopped";

interface Window {
  brainGameDesktop: {
    labList(): Promise<{ id: string; createdAt: string; completed: number }[]>;
    labLoad(id: string): Promise<unknown>;
    labSave(run: unknown): Promise<unknown>;
    labAnalyze(id: string, final: boolean): Promise<unknown>;
    labOpenReport(id: string, final: boolean): Promise<void>;
    getGatewayStatus(): Promise<GatewayStatus>;
    getGatewayConnection(): Promise<{ url: string; token: string; protocolVersion: number } | null>;
    restartGateway(): Promise<void>;
    openSessionFolder(sessionId?: string): Promise<void>;
    onGatewayStatusChanged(listener: (status: GatewayStatus) => void): () => void;
  };
}
