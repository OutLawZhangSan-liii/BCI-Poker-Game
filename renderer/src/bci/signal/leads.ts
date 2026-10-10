/** Fixed analysis order; device metadata and raw samples retain their real names. */
export const ANALYSIS_LEADS = ["P3", "P4", "Oz", "Pz"] as const;
export const DEFAULT_DISPLAY_LEAD = "Oz" as const;

export function missingAnalysisLeads(names: readonly string[]): string[] {
  const normalized = names.map(name => name.trim().toUpperCase());
  return ANALYSIS_LEADS.filter(lead => !normalized.includes(lead.toUpperCase()));
}

export function analysisChannelIndices(names: readonly string[]): number[] {
  const missing = missingAnalysisLeads(names);
  if (missing.length) {
    throw new Error(`信号分析需要导联：${ANALYSIS_LEADS.join("、")}；缺少：${missing.join("、")}`);
  }
  const normalized = names.map(name => name.trim().toUpperCase());
  return ANALYSIS_LEADS.map(lead => normalized.indexOf(lead.toUpperCase()));
}
