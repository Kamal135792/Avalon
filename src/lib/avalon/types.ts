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
export type MissionCard = "success" | "fail";
export type MissionResult = MissionCard;
export type VoteCard = "approve" | "reject";
export interface RoleOptions {
  percival: boolean;
  morgana: boolean;
  mordred: boolean;
  oberon: boolean;
}
export interface Options extends RoleOptions {
  lady: boolean;
  targeting: boolean;
}
export type Phase =
  "lobby" | "team" | "vote" | "quest" | "lady" | "assassination" | "finished";
export interface Game {
  id: string;
  code: string;
  round_id: string;
  phase: Phase;
  quest: number;
  rejections: number;
  leader_id: string | null;
  lady_id: string | null;
  lady_used: string[];
  options: Options;
  winner: Alignment | null;
  reason: string | null;
  assassin_target: string | null;
}
export interface Player {
  id: string;
  name: string;
  host: boolean;
  ready: boolean;
  online: boolean;
  seat: number;
  role: RoleName | null;
}
export interface Proposal {
  id: string;
  number: number;
  quest: number;
  leader_id: string;
  team: string[];
  status: "pending" | "approved" | "rejected";
  votes: { player_id: string; card: VoteCard | null }[];
}
export interface Quest {
  id: string;
  number: number;
  team: string[];
  result: MissionResult | null;
  fails: number | null;
  submitted: number;
  my_card: MissionCard | null;
}
export interface Snapshot {
  game: Game;
  me: string;
  players: Player[];
  hand: {
    role: RoleName | null;
    alignment: Alignment | null;
    knownEvilIds: string[];
    seenAsMerlinIds: string[];
    inspections: { target: string; alignment: Alignment }[];
  };
  proposals: Proposal[];
  quests: Quest[];
  can_claim_host: boolean;
  messages: {
    id: number;
    player_id: string;
    name: string;
    body: string;
    created_at: string;
  }[];
}
