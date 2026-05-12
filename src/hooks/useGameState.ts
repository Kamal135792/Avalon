"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  GameRow,
  MissionRow,
  PlayerRow,
  ProposalRow,
  VoteRow,
} from "@/lib/avalon/types";
import {
  distributeRoles,
  getMissionTeamSize,
  resolveMission,
  resolveVote,
} from "@/lib/avalon/logic";

const SESSION_KEY = "avalon_session_id";

export interface GameStateData {
  sessionId: string | null;
  game: GameRow | null;
  players: PlayerRow[];
  missions: MissionRow[];
  proposals: ProposalRow[];
  votes: VoteRow[];
  isLoading: boolean;
  error: string | null;
}

export interface GameStateActions {
  createGame: (payload: { name: string }) => Promise<string | null>;
  joinGame: (payload: { roomCode: string; name: string }) => Promise<string | null>;
  startGame: (payload: { gameId: string; roleOptions: {
    percival: boolean;
    morgana: boolean;
    mordred: boolean;
    oberon: boolean;
  } }) => Promise<void>;
  submitProposal: (payload: {
    gameId: string;
    missionNumber: number;
    proposerId: string;
    teamPlayerIds: string[];
  }) => Promise<void>;
  submitVote: (payload: {
    gameId: string;
    proposalId: string;
    playerId: string;
    vote: "approve" | "reject";
  }) => Promise<void>;
  finalizeVote: (payload: {
    gameId: string;
    proposalId: string;
  }) => Promise<void>;
  submitMissionCard: (payload: {
    missionId: string;
    playerId: string;
    card: "success" | "fail";
  }) => Promise<void>;
  resolveMission: (payload: {
    gameId: string;
    missionId: string;
    playerCount: number;
    missionNumber: number;
  }) => Promise<void>;
  assassinate: (payload: { gameId: string; guessedPlayerId: string }) => Promise<void>;
}

export type GameStateHook = GameStateData & GameStateActions;

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === "x" ? rand : (rand % 4) + 8;
    return value.toString(16);
  });
}

function generateRoomCode(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}

export function useGameState(roomCode?: string): GameStateHook {
  const sessionId = useSyncExternalStore(
    subscribeSessionId,
    getSessionSnapshot,
    getSessionServerSnapshot
  );
  const [game, setGame] = useState<GameRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { supabase, supabaseInitError } = useMemo(() => {
    if (!sessionId) {
      return { supabase: null, supabaseInitError: null };
    }

    try {
      return { supabase: createSupabaseClient(sessionId), supabaseInitError: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to init Supabase.";
      return { supabase: null, supabaseInitError: message };
    }
  }, [sessionId]);

  const loadGameData = useCallback(async () => {
    if (!supabase || !roomCode) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: gameRow, error: gameError } = await supabase
        .from("games")
        .select("*")
        .eq("room_code", roomCode)
        .maybeSingle();

      if (gameError) {
        throw gameError;
      }

      setGame(gameRow ?? null);

      if (!gameRow) {
        setIsLoading(false);
        return;
      }

      const [playersRes, missionsRes, proposalsRes, votesRes] =
        await Promise.all([
          supabase.from("players").select("*").eq("game_id", gameRow.id),
          supabase.from("missions").select("*").eq("game_id", gameRow.id),
          supabase.from("proposals").select("*").eq("game_id", gameRow.id),
          supabase.from("votes").select("*").eq("game_id", gameRow.id),
        ]);

      if (playersRes.error) throw playersRes.error;
      if (missionsRes.error) throw missionsRes.error;
      if (proposalsRes.error) throw proposalsRes.error;
      if (votesRes.error) throw votesRes.error;
      const missionRows = missionsRes.data ?? [];

      setPlayers(playersRes.data ?? []);
      setMissions(missionRows);
      setProposals(proposalsRes.data ?? []);
      setVotes(votesRes.data ?? []);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err && "message" in err
            ? String((err as { message: string }).message)
            : "Failed to load data.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, roomCode]);

  useEffect(() => {
    if (!supabase || !roomCode) {
      return;
    }

    // FIX: Using a random suffix prevents React Strict Mode from breaking the channel
    const channelId = `room:${roomCode}-${Math.random().toString(36).substring(7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `room_code=eq.${roomCode}` },
        () => {
          console.log("🟢 Realtime Event: Game Room Update");
          loadGameData();
        }
      )
      .subscribe((status) => {
        console.log(`📡 Room Channel Status: ${status}`);
        if (status === "SUBSCRIBED") {
          loadGameData();
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, roomCode, loadGameData]);

  useEffect(() => {
    if (!supabase || !game?.id) {
      return;
    }

    // FIX: Using a random suffix prevents React Strict Mode from breaking the channel
    const channelId = `game:${game.id}-${Math.random().toString(36).substring(7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `id=eq.${game.id}` },
        () => { console.log("🟢 Realtime Event: Game Status Update"); loadGameData(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `game_id=eq.${game.id}` },
        () => { console.log("🟢 Realtime Event: Player Joined/Updated"); loadGameData(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "missions", filter: `game_id=eq.${game.id}` },
        () => { console.log("🟢 Realtime Event: Mission Update"); loadGameData(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "proposals", filter: `game_id=eq.${game.id}` },
        () => { console.log("🟢 Realtime Event: Proposal Update"); loadGameData(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `game_id=eq.${game.id}` },
        () => { console.log("🟢 Realtime Event: Vote Cast"); loadGameData(); }
      )
      .subscribe((status) => {
        console.log(`📡 Game Channel Status: ${status}`);
        if (status === "SUBSCRIBED") {
          loadGameData();
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, game?.id, loadGameData]);

  const createGame = useCallback(
    async ({ name }: { name: string }) => {
      if (!supabase || !sessionId) {
        return null;
      }

      setIsLoading(true);
      setError(null);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const roomCodeCandidate = generateRoomCode();
        const { data: gameRow, error: gameError } = await supabase
          .from("games")
          .insert({ room_code: roomCodeCandidate })
          .select()
          .single();

        if (gameError) {
          if (gameError.code === "23505") {
            continue;
          }
          setError(gameError.message);
          setIsLoading(false);
          return null;
        }

        const { error: playerError } = await supabase.from("players").insert({
          game_id: gameRow.id,
          session_id: sessionId,
          name,
          is_host: true,
        });

        if (playerError) {
          setError(playerError.message);
          setIsLoading(false);
          return null;
        }

        setGame(gameRow);
        setIsLoading(false);
        return roomCodeCandidate;
      }

      setIsLoading(false);
      setError("Failed to generate room code.");
      return null;
    },
    [supabase, sessionId]
  );

  const joinGame = useCallback(
    async ({ roomCode: code, name }: { roomCode: string; name: string }) => {
      if (!supabase || !sessionId) {
        return null;
      }

      setIsLoading(true);
      setError(null);

      const { data: gameRow, error: gameError } = await supabase
        .from("games")
        .select("*")
        .eq("room_code", code)
        .maybeSingle();

      if (gameError || !gameRow) {
        setError(gameError?.message ?? "Room not found.");
        setIsLoading(false);
        return null;
      }

      const { error: playerError } = await supabase.from("players").insert({
        game_id: gameRow.id,
        session_id: sessionId,
        name,
        is_host: false,
      });

      if (playerError) {
        setError(playerError.message);
        setIsLoading(false);
        return null;
      }

      setGame(gameRow);
      setIsLoading(false);
      return code;
    },
    [supabase, sessionId]
  );

  const startGame = useCallback(
    async ({ gameId, roleOptions }: { gameId: string; roleOptions: {
      percival: boolean;
      morgana: boolean;
      mordred: boolean;
      oberon: boolean;
    } }) => {
      if (!supabase) {
        return;
      }

      const { data: playerRows, error: playerError } = await supabase
        .from("players")
        .select("*")
        .eq("game_id", gameId);

      if (playerError || !playerRows) {
        setError(playerError?.message ?? "Failed to load players.");
        return;
      }

      const assignments = distributeRoles(
        playerRows.map((player) => player.id),
        roleOptions
      );

      await Promise.all(
        assignments.map((assignment) =>
          supabase
            .from("players")
            .update({ role: assignment.role })
            .eq("id", assignment.playerId)
        )
      );

      const { error: gameError } = await supabase
        .from("games")
        .update({ status: "in_progress" })
        .eq("id", gameId);

      if (gameError) {
        setError(gameError.message);
      }
    },
    [supabase]
  );

  const submitProposal = useCallback(
    async ({
      gameId,
      missionNumber,
      proposerId,
      teamPlayerIds,
    }: {
      gameId: string;
      missionNumber: number;
      proposerId: string;
      teamPlayerIds: string[];
    }) => {
      if (!supabase) {
        return;
      }

      setIsLoading(true);
      setError(null);

      const proposalNumber =
        proposals.filter((proposal) => proposal.mission_number === missionNumber)
          .length + 1;

      const { error: proposalError } = await supabase.from("proposals").insert({
        game_id: gameId,
        mission_number: missionNumber,
        proposal_number: proposalNumber,
        proposer_id: proposerId,
        team_player_ids: teamPlayerIds,
      });

      if (proposalError) {
        setError(proposalError.message);
      }

      setIsLoading(false);
    },
    [supabase, proposals]
  );

  const submitVote = useCallback(
    async ({
      gameId,
      proposalId,
      playerId,
      vote,
    }: {
      gameId: string;
      proposalId: string;
      playerId: string;
      vote: "approve" | "reject";
    }) => {
      if (!supabase) {
        return;
      }

      const { error: voteError } = await supabase.from("votes").insert({
        game_id: gameId,
        proposal_id: proposalId,
        player_id: playerId,
        vote,
      });

      if (voteError) {
        setError(voteError.message);
      }
    },
    [supabase]
  );

  const finalizeVote = useCallback(
    async ({ gameId, proposalId }: { gameId: string; proposalId: string }) => {
      if (!supabase || !game) {
        return;
      }

      setIsLoading(true);
      setError(null);

      const proposal = proposals.find((item) => item.id === proposalId);
      if (!proposal) {
        setError("Proposal not found.");
        setIsLoading(false);
        return;
      }

      const proposalVotes = votes.filter((vote) => vote.proposal_id === proposalId);
      if (proposalVotes.length < players.length) {
        setError("Waiting on all votes.");
        setIsLoading(false);
        return;
      }

      const resolution = resolveVote(
        proposalVotes.map((vote) => vote.vote),
        game.vote_track
      );

      const { error: proposalError } = await supabase
        .from("proposals")
        .update({ status: resolution.approved ? "approved" : "rejected" })
        .eq("id", proposalId);

      if (proposalError) {
        setError(proposalError.message);
        setIsLoading(false);
        return;
      }

      if (resolution.approved) {
        const existingMission = missions.find(
          (mission) => mission.mission_number === proposal.mission_number
        );

        if (!existingMission) {
          const { error: missionError } = await supabase.from("missions").insert({
            game_id: gameId,
            mission_number: proposal.mission_number,
            team_player_ids: proposal.team_player_ids,
          });

          if (missionError) {
            setError(missionError.message);
          }
        }

        const { error: gameError } = await supabase
          .from("games")
          .update({ vote_track: 0 })
          .eq("id", gameId);

        if (gameError) {
          setError(gameError.message);
        }
      } else {
        const gameUpdate: Partial<GameRow> = {
          vote_track: resolution.nextVoteTrack,
        };

        if (resolution.voteTrackFailed) {
          gameUpdate.winner = "evil";
          gameUpdate.status = "finished";
        }

        const { error: gameError } = await supabase
          .from("games")
          .update(gameUpdate)
          .eq("id", gameId);

        if (gameError) {
          setError(gameError.message);
        }
      }

      setIsLoading(false);
    },
    [supabase, game, proposals, votes, players.length, missions]
  );

  const submitMissionCard = useCallback(
    async ({
      missionId,
      playerId,
      card,
    }: {
      missionId: string;
      playerId: string;
      card: "success" | "fail";
    }) => {
      if (!supabase) {
        return;
      }

      const { error: submissionError } = await supabase
        .from("mission_submissions")
        .insert({ mission_id: missionId, player_id: playerId, card });

      if (submissionError) {
        setError(submissionError.message);
      }
    },
    [supabase]
  );

  const resolveMissionAction = useCallback(
    async ({
      gameId,
      missionId,
      playerCount,
      missionNumber,
    }: {
      gameId: string;
      missionId: string;
      playerCount: number;
      missionNumber: number;
    }) => {
      if (!supabase || !game) {
        return;
      }

      setIsLoading(true);
      setError(null);

      const { data, error: tallyError } = await supabase.rpc("get_mission_tally", {
        mission_id: missionId,
      });

      if (tallyError) {
        setError(tallyError.message);
        setIsLoading(false);
        return;
      }

      const tally = Array.isArray(data) ? data[0] : data;
      const submittedCount = Number(tally?.submitted_count ?? 0);
      const successCount = Number(tally?.success_count ?? 0);
      const failCount = Number(tally?.fail_count ?? 0);

      const teamSize = getMissionTeamSize(playerCount, missionNumber);
      if (submittedCount < teamSize) {
        setError("Waiting on all mission submissions.");
        setIsLoading(false);
        return;
      }

      const missionResolution = resolveMission(
        [
          ...Array(successCount).fill("success"),
          ...Array(failCount).fill("fail"),
        ],
        playerCount,
        missionNumber
      );

      const { error: missionError } = await supabase
        .from("missions")
        .update({
          success_count: missionResolution.successCount,
          fail_count: missionResolution.failCount,
          result: missionResolution.result,
        })
        .eq("id", missionId);

      if (missionError) {
        setError(missionError.message);
        setIsLoading(false);
        return;
      }

      const pastSuccesses = missions.filter((mission) => mission.result === "success")
        .length;
      const pastFails = missions.filter((mission) => mission.result === "fail").length;
      const totalSuccesses =
        pastSuccesses + (missionResolution.result === "success" ? 1 : 0);
      const totalFails = pastFails + (missionResolution.result === "fail" ? 1 : 0);

      if (totalFails >= 3) {
        const { error: gameError } = await supabase
          .from("games")
          .update({ winner: "evil", status: "finished" })
          .eq("id", gameId);
        if (gameError) {
          setError(gameError.message);
        }
        setIsLoading(false);
        return;
      }

      if (totalSuccesses >= 3) {
        const { error: gameError } = await supabase
          .from("games")
          .update({ status: "in_progress" })
          .eq("id", gameId);
        if (gameError) {
          setError(gameError.message);
        }
        setIsLoading(false);
        return;
      }

      const { error: gameError } = await supabase
        .from("games")
        .update({ current_mission: game.current_mission + 1, vote_track: 0 })
        .eq("id", gameId);

      if (gameError) {
        setError(gameError.message);
      }

      setIsLoading(false);
    },
    [supabase, game, missions]
  );

  const assassinate = useCallback(
    async ({ gameId, guessedPlayerId }: { gameId: string; guessedPlayerId: string }) => {
      if (!supabase) {
        return;
      }

      const { error: assassinationError } = await supabase.rpc(
        "resolve_assassination",
        {
          game_id: gameId,
          guessed_player_id: guessedPlayerId,
        }
      );

      if (assassinationError) {
        setError(assassinationError.message);
      }
    },
    [supabase]
  );

  return {
    sessionId,
    game,
    players,
    missions,
    proposals,
    votes,
    isLoading,
    error: error ?? supabaseInitError,
    createGame,
    joinGame,
    startGame,
    submitProposal,
    submitVote,
    finalizeVote,
    submitMissionCard,
    resolveMission: resolveMissionAction,
    assassinate,
  };
}

// FIX: Swapped localStorage to sessionStorage. 
// If you test in multiple tabs of the same browser, they will no longer steal each other's identity!
function getSessionSnapshot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) {
    return existing;
  }

  const generated = generateSessionId();
  window.sessionStorage.setItem(SESSION_KEY, generated);
  return generated;
}

function getSessionServerSnapshot(): string | null {
  return null;
}

function subscribeSessionId(callback: () => void): () => void {
  // sessionStorage does not trigger storage events across tabs, which is exactly what we want.
  return () => undefined;
}