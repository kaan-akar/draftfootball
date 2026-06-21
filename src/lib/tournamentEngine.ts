import type { Standing, Match } from '../types/game';

/**
 * Generates a round-robin fixture list.
 * Returns an ordered array of [homeId, awayId] pairs.
 */
export function generateFixture(playerIds: string[]): Array<[string, string]> {
  const n = playerIds.length;
  const fixtures: Array<[string, string]> = [];

  if (n < 2) return fixtures;

  // Standard round-robin using circle method
  const ids = [...playerIds];
  if (n % 2 !== 0) ids.push('bye');

  const rounds = ids.length - 1;
  const half = ids.length / 2;

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const home = ids[i];
      const away = ids[ids.length - 1 - i];
      if (home !== 'bye' && away !== 'bye') {
        fixtures.push([home, away]);
      }
    }
    // Rotate all except the first element
    ids.splice(1, 0, ids.pop()!);
  }

  return fixtures;
}

/**
 * Builds a standings table from finished matches.
 */
export function buildStandings(
  playerIds: string[],
  usernames: Record<string, string>,
  matches: Match[],
): Standing[] {
  const table: Record<string, Standing> = {};

  for (const id of playerIds) {
    table[id] = {
      roomId: '',
      userId: id,
      username: usernames[id] ?? id,
      played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, points: 0,
    };
  }

  for (const match of matches) {
    if (match.status !== 'finished') continue;
    const h = table[match.homePlayerId];
    const a = table[match.awayPlayerId];
    if (!h || !a) continue;

    h.played++; a.played++;
    h.goalsFor += match.homeScore; h.goalsAgainst += match.awayScore;
    a.goalsFor += match.awayScore; a.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      h.won++; h.points += 3; a.lost++;
    } else if (match.homeScore < match.awayScore) {
      a.won++; a.points += 3; h.lost++;
    } else {
      h.drawn++; h.points++; a.drawn++; a.points++;
    }
  }

  return Object.values(table).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdA = a.goalsFor - a.goalsAgainst;
    const gdB = b.goalsFor - b.goalsAgainst;
    if (gdB !== gdA) return gdB - gdA;
    return b.goalsFor - a.goalsFor;
  });
}
