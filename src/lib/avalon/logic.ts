import {
  Alignment,
  MissionCard,
  MissionResolution,
  MissionResult,
  RoleAssignment,
  RoleKnowledge,
  RoleName,
  RoleOptions,
  VoteCard,
  VoteResolution,
} from "./types";

const EVIL_COUNT_BY_PLAYERS: Record<number, number> = {
  5: 2,
  6: 2,
  7: 3,
  8: 3,
  9: 3,
  10: 4,
};

const MISSION_TEAM_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

export function getEvilCount(playerCount: number): number {
  return EVIL_COUNT_BY_PLAYERS[playerCount] ?? 0;
}

export function getMissionTeamSize(
  playerCount: number,
  missionNumber: number
): number {
  const sizes = MISSION_TEAM_SIZES[playerCount] ?? [];
  return sizes[missionNumber - 1] ?? 0;
}

export function getRequiredFails(
  playerCount: number,
  missionNumber: number
): number {
  if (missionNumber === 4 && playerCount >= 7) {
    return 2;
  }

  return 1;
}

export function resolveMission(
  submissions: MissionCard[],
  playerCount: number,
  missionNumber: number
): MissionResolution {
  const failCount = submissions.filter((card) => card === "fail").length;
  const successCount = submissions.length - failCount;
  const requiredFails = getRequiredFails(playerCount, missionNumber);
  const result: MissionResult =
    failCount >= requiredFails ? "fail" : "success";

  return {
    successCount,
    failCount,
    requiredFails,
    result,
  };
}

export function resolveVote(
  votes: VoteCard[],
  currentVoteTrack: number
): VoteResolution {
  const rejectCount = votes.filter((vote) => vote === "reject").length;
  const approveCount = votes.length - rejectCount;
  const approved = approveCount > rejectCount;
  const nextVoteTrack = approved ? 0 : Math.min(currentVoteTrack + 1, 5);

  return {
    approveCount,
    rejectCount,
    approved,
    nextVoteTrack,
    voteTrackFailed: !approved && nextVoteTrack >= 5,
  };
}

export function resolveAssassination(
  guessedPlayerId: string,
  merlinPlayerId: string
): Alignment {
  return guessedPlayerId === merlinPlayerId ? "evil" : "good";
}

export function distributeRoles(
  playerIds: string[],
  options: RoleOptions
): RoleAssignment[] {
  const totalPlayers = playerIds.length;
  const evilCount = getEvilCount(totalPlayers);
  const goodCount = totalPlayers - evilCount;

  const goodRoles: RoleName[] = ["merlin"];
  if (options.percival && goodCount > 1) {
    goodRoles.push("percival");
  }
  while (goodRoles.length < goodCount) {
    goodRoles.push("loyal_servant");
  }

  const evilRoles: RoleName[] = ["assassin"];
  if (options.morgana && evilRoles.length < evilCount) {
    evilRoles.push("morgana");
  }
  if (options.mordred && evilRoles.length < evilCount) {
    evilRoles.push("mordred");
  }
  if (options.oberon && evilRoles.length < evilCount) {
    evilRoles.push("oberon");
  }
  while (evilRoles.length < evilCount) {
    evilRoles.push("minion");
  }

  const roles = shuffle([...goodRoles, ...evilRoles]);

  return shuffle(playerIds).map((playerId, index) => {
    const role = roles[index] ?? "loyal_servant";
    const alignment: Alignment =
      role === "assassin" ||
      role === "morgana" ||
      role === "mordred" ||
      role === "oberon" ||
      role === "minion"
        ? "evil"
        : "good";

    return { playerId, role, alignment };
  });
}

export function buildKnowledge(
  assignments: RoleAssignment[]
): RoleKnowledge[] {
  const evilPlayers = assignments.filter((a) => a.alignment === "evil");
  const evilIds = evilPlayers.map((a) => a.playerId);
  const oberonId = assignments.find((a) => a.role === "oberon")?.playerId;
  const mordredId = assignments.find((a) => a.role === "mordred")?.playerId;
  const merlinId = assignments.find((a) => a.role === "merlin")?.playerId;
  const morganaId = assignments.find((a) => a.role === "morgana")?.playerId;

  return assignments.map((assignment) => {
    const knownEvilIds: string[] = [];
    const seenAsMerlinIds: string[] = [];
    const notes: string[] = [];

    if (assignment.role === "merlin") {
      knownEvilIds.push(
        ...evilIds.filter((id) => id !== mordredId && id !== assignment.playerId)
      );
      notes.push("Sees all evil except Mordred.");
    }

    if (assignment.role === "percival") {
      if (merlinId) {
        seenAsMerlinIds.push(merlinId);
      }
      if (morganaId) {
        seenAsMerlinIds.push(morganaId);
      }
      notes.push("Sees Merlin and Morgana as potential Merlin.");
    }

    if (assignment.alignment === "evil") {
      if (assignment.role === "oberon") {
        notes.push("Oberon sees no other evil and is hidden.");
      } else {
        const visibleEvil = evilIds.filter((id) => id !== oberonId);
        knownEvilIds.push(...visibleEvil.filter((id) => id !== assignment.playerId));
        notes.push("Sees other evil players except Oberon.");
      }
    }

    if (assignment.alignment === "good" && assignment.role === "loyal_servant") {
      notes.push("Has no special knowledge.");
    }

    return {
      playerId: assignment.playerId,
      role: assignment.role,
      alignment: assignment.alignment,
      knownEvilIds,
      seenAsMerlinIds,
      notes,
    };
  });
}

export function getAlignment(role: RoleName): Alignment {
  return role === "assassin" ||
    role === "morgana" ||
    role === "mordred" ||
    role === "oberon" ||
    role === "minion"
    ? "evil"
    : "good";
}

function shuffle<T>(items: T[]): T[] {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
