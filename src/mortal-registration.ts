import type { AnalysisHistory } from "./analysis-queue";

export type MortalSourceReceipt = {
  linked: boolean;
  analysis_id: string | null;
  at?: string;
  rank?: number;
  score?: number;
};
export type MortalRegistrationResult = {
  id: string;
  duplicate: boolean;
  source_link?: MortalSourceReceipt;
};
export function storedSourceReceipt(
  id: string | null,
  history?: AnalysisHistory,
): MortalSourceReceipt {
  return {
    linked: !!id,
    analysis_id: id,
    ...(history
      ? {
          at: history.at,
          rank: history.rank,
          score: history.players[history.seat].score,
        }
      : {}),
  };
}
