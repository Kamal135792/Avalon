export type GameStatus = "lobby" | "in_progress" | "finished";
export type MissionResult = "success" | "fail";
export type ProposalStatus = "pending" | "approved" | "rejected";
export type VoteCard = "approve" | "reject";
export type MissionCard = "success" | "fail";

export type RoleName =
  | "merlin"
  | "percival"
  | "loyal_servant"
  | "assassin"
  | "morgana"
  | "mordred"
  | "oberon"
  | "minion";

export type Alignment = "good" | "evil";

export interface GameRow {
  id: string;
  room_code: string;
  status: GameStatus;
  current_mission: number;
  vote_track: number;
  winner: Alignment | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerRow {
  id: string;
  game_id: string;
  session_id: string;
  name: string;
  role: RoleName | null;
  is_host: boolean;
  created_at: string;
}

export interface MissionRow {
  id: string;
  game_id: string;
  mission_number: number;
  team_player_ids: string[];
  success_count: number;
  fail_count: number;
  result: MissionResult | null;
  created_at: string;
}

export interface ProposalRow {
  id: string;
  game_id: string;
  mission_number: number;
  proposal_number: number;
  proposer_id: string | null;
  team_player_ids: string[];
  status: ProposalStatus;
  created_at: string;
}

export interface VoteRow {
  id: string;
  game_id: string;
  proposal_id: string;
  player_id: string;
  vote: VoteCard;
  created_at: string;
}

export interface MissionSubmissionRow {
  id: string;
  mission_id: string;
  player_id: string;
  card: MissionCard;
  created_at: string;
}

export interface RoleOptions {
  percival: boolean;
  morgana: boolean;
  mordred: boolean;
  oberon: boolean;
}

export interface RoleAssignment {
  playerId: string;
  role: RoleName;
  alignment: Alignment;
}

export interface RoleKnowledge {
  playerId: string;
  role: RoleName;
  alignment: Alignment;
  knownEvilIds: string[];
  seenAsMerlinIds: string[];
  notes: string[];
}

export interface VoteResolution {
  approveCount: number;
  rejectCount: number;
  approved: boolean;
  nextVoteTrack: number;
  voteTrackFailed: boolean;
}

export interface MissionResolution {
  successCount: number;
  failCount: number;
  requiredFails: number;
  result: MissionResult;
}
