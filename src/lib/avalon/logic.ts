// Display helpers. The authoritative rules are enforced by avalon_scheme.sql.
const EVIL_COUNTS: Record<number, number> = {
  5: 2,
  6: 2,
  7: 3,
  8: 3,
  9: 3,
  10: 4,
};
const TEAM_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};
export function getEvilCount(players: number) {
  return EVIL_COUNTS[players] ?? 0;
}
export function getMissionTeamSize(players: number, quest: number) {
  return TEAM_SIZES[players]?.[quest - 1] ?? 0;
}
export function getRequiredFails(players: number, quest: number) {
  return players >= 7 && quest === 4 ? 2 : 1;
}
