type GatewayStatus = "starting" | "ready" | "faulted" | "stopping" | "stopped";

interface Window {
  brainGameDesktop: {
    readonly challengeSmokeEnabled: boolean;
    getGatewayStatus(): Promise<GatewayStatus>;
    getGatewayConnection(): Promise<{ url: string; token: string; protocolVersion: number } | null>;
    restartGateway(): Promise<void>;
    openSessionFolder(sessionId?: string): Promise<void>;
    createChallenge(record: import("../../desktop/main/challengeModel").ChallengeRecord): Promise<import("../../desktop/main/challengeModel").ChallengeRecord>;
    getChallenge(id: string): Promise<import("../../desktop/main/challengeModel").ChallengeRecord>;
    listChallenges(): Promise<{ records: import("../../desktop/main/challengeModel").ChallengeRecord[]; warnings: string[] }>;
    saveChallenge(record: import("../../desktop/main/challengeModel").ChallengeRecord): Promise<import("../../desktop/main/challengeModel").ChallengeRecord>;
    onGatewayStatusChanged(listener: (status: GatewayStatus) => void): () => void;
  };
}
