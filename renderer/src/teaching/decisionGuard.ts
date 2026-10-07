import type { BciDecision } from "../bci/signal/types";

export function isCurrentTeachingDecision(decision: BciDecision, sessionId: string | null, trialId: string | null) {
  return sessionId !== null && trialId !== null && decision.sessionId === sessionId && decision.trialId === trialId;
}
