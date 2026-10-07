type GatewayStatus = "starting" | "ready" | "faulted" | "stopping" | "stopped";

interface Window {
  brainGameDesktop: {
    getGatewayStatus(): Promise<GatewayStatus>;
    getGatewayConnection(): Promise<{ url: string; token: string; protocolVersion: number } | null>;
    restartGateway(): Promise<void>;
    openSessionFolder(sessionId?: string): Promise<void>;
    onGatewayStatusChanged(listener: (status: GatewayStatus) => void): () => void;
  };
}
