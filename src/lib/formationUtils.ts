import type { Formation, DetailedPosition, FormationSlot, FootballPlayer } from '../types/game';

// ─── Formation Slot Definitions ──────────────────────────────────────────────
const FORMATION_SLOTS: Record<Formation, DetailedPosition[]> = {
  '4-4-2':   ['GK','RB','CB','CB','LB','RM','CM','CM','LM','ST','ST'],
  '4-3-3':   ['GK','RB','CB','CB','LB','CM','CM','CM','RW','ST','LW'],
  '4-2-3-1': ['GK','RB','CB','CB','LB','CDM','CDM','CAM','RW','LW','ST'],
  '3-5-2':   ['GK','CB','CB','CB','RM','CM','CDM','CM','LM','ST','ST'],
  '5-3-2':   ['GK','RB','CB','CB','CB','LB','CM','CM','CM','ST','ST'],
  '4-5-1':   ['GK','RB','CB','CB','LB','RM','CM','CDM','CM','LM','ST'],
  '3-4-3':   ['GK','CB','CB','CB','RM','CM','CM','LM','RW','ST','LW'],
  '4-1-4-1': ['GK','RB','CB','CB','LB','CDM','RM','CM','CM','LM','ST'],
};

// ─── Position Compatibility Matrix ──────────────────────────────────────────
// player.positions lists all positions they can play.
// A player can fill a slot if their positions intersect with slot-compatible set.
const SLOT_COMPAT: Record<DetailedPosition, DetailedPosition[]> = {
  GK:  ['GK'],
  RB:  ['RB', 'CB'],
  CB:  ['CB', 'RB', 'LB', 'CDM'],
  LB:  ['LB', 'CB'],
  CDM: ['CDM', 'CM', 'CB'],
  CM:  ['CM', 'CDM', 'CAM', 'RM', 'LM'],
  CAM: ['CAM', 'CM', 'RW', 'LW'],
  RM:  ['RM', 'CM', 'RW'],
  LM:  ['LM', 'CM', 'LW'],
  RW:  ['RW', 'RM', 'CAM', 'ST'],
  LW:  ['LW', 'LM', 'CAM', 'ST'],
  CF:  ['CF', 'ST', 'CAM'],
  ST:  ['ST', 'CF', 'RW', 'LW'],
};

/**
 * Returns the ordered slot list for a formation, with unique slot IDs.
 */
export function getSlotsForFormation(formation: Formation): FormationSlot[] {
  const positions = FORMATION_SLOTS[formation];
  const counts: Partial<Record<DetailedPosition, number>> = {};
  return positions.map((pos) => {
    counts[pos] = (counts[pos] ?? 0) + 1;
    return {
      slotId: `${pos}_${counts[pos]}`,
      position: pos,
    };
  });
}

/**
 * Returns true if the player can fill the given slot position.
 */
export function canFillSlot(
  playerPositions: DetailedPosition[],
  slotPosition: DetailedPosition,
): boolean {
  const compatible = SLOT_COMPAT[slotPosition];
  return playerPositions.some((p) => compatible.includes(p));
}

/**
 * Returns true if the player can fill any of the given empty slots.
 */
export function hasCompatibleSlot(
  playerPositions: DetailedPosition[],
  emptySlots: FormationSlot[],
): boolean {
  return emptySlots.some((slot) => canFillSlot(playerPositions, slot.position));
}

function getSlotFitScore(
  playerPositions: DetailedPosition[],
  slotPosition: DetailedPosition,
): number {
  const compatible = SLOT_COMPAT[slotPosition];
  return playerPositions.reduce((bestScore, position) => {
    const idx = compatible.indexOf(position);
    if (idx === -1) return bestScore;
    return Math.max(bestScore, compatible.length - idx);
  }, -1);
}

export function assignPlayersToFormation(
  players: FootballPlayer[],
  formation: Formation,
): Array<FormationSlot & { player?: FootballPlayer }> {
  const slots = getSlotsForFormation(formation);
  const remainingPlayers = [...players];
  const assignedPlayersBySlot = new Map<string, FootballPlayer | undefined>();
  const openSlots = [...slots];

  while (openSlots.length > 0) {
    const slotWithFewestOptions = [...openSlots]
      .map((slot) => ({
        slot,
        candidates: remainingPlayers.filter((player) => canFillSlot(player.positions, slot.position)),
      }))
      .sort((left, right) => {
        if (left.candidates.length !== right.candidates.length) {
          return left.candidates.length - right.candidates.length;
        }
        return SLOT_COMPAT[left.slot.position].length - SLOT_COMPAT[right.slot.position].length;
      })[0];

    const slotIndex = openSlots.findIndex((slot) => slot.slotId === slotWithFewestOptions.slot.slotId);
    const [nextSlot] = openSlots.splice(slotIndex, 1);

    const rankedCandidates = slotWithFewestOptions.candidates.sort((left, right) => {
      const scoreDiff = getSlotFitScore(right.positions, nextSlot.position)
        - getSlotFitScore(left.positions, nextSlot.position);
      if (scoreDiff !== 0) return scoreDiff;
      return (right.price ?? 0) - (left.price ?? 0);
    });

    const selectedPlayer = rankedCandidates[0];
    assignedPlayersBySlot.set(nextSlot.slotId, selectedPlayer);

    if (selectedPlayer) {
      const playerIndex = remainingPlayers.findIndex((player) => player.id === selectedPlayer.id);
      if (playerIndex !== -1) remainingPlayers.splice(playerIndex, 1);
    }
  }

  return slots.map((slot) => ({
    ...slot,
    player: assignedPlayersBySlot.get(slot.slotId),
  }));
}

/**
 * Returns the position group (GK/DEF/MID/FWD) for a given draft phase round.
 * Round 1 = GK, 2-5 = DEF, 6-8 = MID, 9-11 = FWD
 */
export function phaseForRound(round: number): 'gk' | 'def' | 'mid' | 'fwd' {
  if (round === 1) return 'gk';
  if (round <= 5) return 'def';
  if (round <= 8) return 'mid';
  return 'fwd';
}

export const FORMATIONS = Object.keys(FORMATION_SLOTS) as Formation[];
export { FORMATION_SLOTS };
