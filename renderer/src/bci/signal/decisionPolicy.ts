// Scores are shares of summed candidate evidence, not probabilities.
// Keep conservative fallbacks until independent, labelled trials and idle data
// establish false-selection rates for each candidate count.
export const FBCCA_DECISION_POLICIES = {
  2: { confidenceThreshold: 0.52, marginThreshold: 0.08, requiredVotes: 2, validated: false },
  4: { confidenceThreshold: 0.52, marginThreshold: 0.08, requiredVotes: 2, validated: false },
  6: { confidenceThreshold: 0.52, marginThreshold: 0.08, requiredVotes: 2, validated: false },
} as const;
export function fbccaDecisionPolicy(targetCount: number) {
  return FBCCA_DECISION_POLICIES[targetCount as keyof typeof FBCCA_DECISION_POLICIES] ?? FBCCA_DECISION_POLICIES[2];
}
export const FBCCA_POLICY_VERSION = "labelled-validation-pending-v1";
