export type Suit = "♠" | "♥" | "♣" | "♦";
export type GameMode = "simple" | "difficult1" | "difficult2";
export interface PlayingCard { rank: number; suit: Suit; }
export interface GameRound { reference: PlayingCard; candidates: PlayingCard[]; correctIndex: number; }
export interface GameScore { total: number; streak: number; gained: number; correct: boolean; }

const suits: Suit[] = ["♠", "♥", "♣", "♦"];
const candidateCounts: Record<GameMode, number> = { simple: 2, difficult1: 4, difficult2: 6 };
const scoreRules: Record<GameMode, { base: number; speedBonus: number }> = {
  // Difficulty changes candidate count and selection, never stimulus or score scale.
  simple: { base: 100, speedBonus: 50 }, difficult1: { base: 100, speedBonus: 50 }, difficult2: { base: 100, speedBonus: 50 },
};

export const cardLabel = (card: PlayingCard) => `${card.rank === 1 ? "A" : card.rank === 11 ? "J" : card.rank === 12 ? "Q" : card.rank === 13 ? "K" : card.rank}${card.suit}`;
const integer = (minimum: number, maximum: number, random: () => number) => minimum + Math.floor(random() * (maximum - minimum + 1));

export function generateGameRound(mode: GameMode, random: () => number = Math.random): GameRound {
  const referenceRank = integer(2, 12, random);
  const availableRanks = Array.from({ length: 13 }, (_, index) => index + 1).filter((rank) => rank !== referenceRank);
  for (let index = availableRanks.length - 1; index > 0; index -= 1) {
    const swapIndex = integer(0, index, random);
    [availableRanks[index], availableRanks[swapIndex]] = [availableRanks[swapIndex], availableRanks[index]];
  }
  const selectedRanks = availableRanks.slice(0, candidateCounts[mode]);
  if (!selectedRanks.some((rank) => rank > referenceRank)) selectedRanks[0] = referenceRank + 1;
  const reference = { rank: referenceRank, suit: suits[integer(0, 3, random)] } as PlayingCard;
  const candidates = selectedRanks.map((rank) => ({ rank, suit: suits[integer(0, 3, random)] } as PlayingCard));
  const winningRank = Math.min(...candidates.filter((card) => card.rank > referenceRank).map((card) => card.rank));
  return { reference, candidates, correctIndex: candidates.findIndex((card) => card.rank === winningRank) };
}

export function scoreChoice(mode: GameMode, previousTotal: number, previousStreak: number, choiceIndex: number | null,
  correctIndex: number, decisionTimeMs: number): GameScore {
  const correct = choiceIndex === correctIndex;
  if (!correct) return { total: previousTotal, streak: choiceIndex === null ? previousStreak : 0, gained: 0, correct: false };
  const speedRatio = Math.max(0, Math.min(1, (3500 - decisionTimeMs) / 2000));
  const rule = scoreRules[mode]; const gained = rule.base + Math.round(rule.speedBonus * speedRatio);
  return { total: previousTotal + gained, streak: previousStreak + 1, gained, correct: true };
}

export function assertGameEngine(): void {
  for (const mode of ["simple", "difficult1", "difficult2"] as GameMode[]) {
    for (let seed = 0; seed < 30; seed += 1) {
      let value = seed + 1;
      const round = generateGameRound(mode, () => { value = value * 16807 % 2147483647; return (value - 1) / 2147483646; });
      if (round.candidates.length !== candidateCounts[mode]) throw new Error(`${mode} candidate count self-test failed`);
      const valid = round.candidates.map((card, index) => ({ card, index })).filter(({ card }) => card.rank > round.reference.rank)
        .sort((left, right) => left.card.rank - right.card.rank);
      if (valid.length === 0 || valid[0].index !== round.correctIndex) throw new Error(`${mode} answer self-test failed`);
    }
  }
  const score = scoreChoice("simple", 0, 0, 0, 0, 1500);
  if (score.total !== 150 || score.streak !== 1) throw new Error("scoring self-test failed");
}
