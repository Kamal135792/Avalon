"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useGameState } from "@/hooks/useGameState";
import { getMissionTeamSize, getRequiredFails } from "@/lib/avalon/logic";
import { Alignment, RoleName } from "@/lib/avalon/types";

interface GameClientProps {
  roomCode: string;
}

const ROLE_LABELS: Record<RoleName, string> = {
  merlin: "Merlin",
  percival: "Percival",
  loyal_servant: "Loyal Servant",
  assassin: "Assassin",
  morgana: "Morgana",
  mordred: "Mordred",
  oberon: "Oberon",
  minion: "Minion of Mordred",
};

const ROLE_ALIGNMENT: Record<RoleName, Alignment> = {
  merlin: "good",
  percival: "good",
  loyal_servant: "good",
  assassin: "evil",
  morgana: "evil",
  mordred: "evil",
  oberon: "evil",
  minion: "evil",
};

export default function GameClient({ roomCode }: GameClientProps) {
  const isMounted = useSyncExternalStore(
    subscribeToHydration,
    getHydrationSnapshot,
    getHydrationServerSnapshot
  );
  const {
    sessionId,
    game,
    players,
    missions,
    proposals,
    votes,
    isLoading,
    error,
    submitProposal,
    submitVote,
    finalizeVote,
    submitMissionCard,
    resolveMission,
    assassinate,
  } = useGameState(roomCode);
  
  const [showRole, setShowRole] = useState(false);
  const [teamSelection, setTeamSelection] = useState<string[]>([]);
  const [assassinTarget, setAssassinTarget] = useState<string | null>(null);
  
  // FIX: Track the specific mission number submitted instead of using an effect to reset a boolean.
  const [submittedMissionNumber, setSubmittedMissionNumber] = useState<number | null>(null);

  const currentPlayer = useMemo(
    () => players.find((player) => player.session_id === sessionId) ?? null,
    [players, sessionId]
  );

  const playerCount = players.length;
  const currentMission = game?.current_mission ?? 1;
  
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [players]
  );

  const missionProposals = proposals
    .filter((proposal) => proposal.mission_number === currentMission)
    .sort((a, b) => b.proposal_number - a.proposal_number);
    
  const activeProposal = missionProposals.find((proposal) => proposal.status === "pending") ?? null;
  const approvedProposal = missionProposals.find((proposal) => proposal.status === "approved") ?? null;

  const leaderIndex = sortedPlayers.length
    ? (activeProposal ? proposals.length - 1 : proposals.length) % sortedPlayers.length
    : 0;
  const leader = sortedPlayers[leaderIndex] ?? null;
  const teamSize = getMissionTeamSize(playerCount, currentMission);

  const activeVotes = activeProposal
    ? votes.filter((vote) => vote.proposal_id === activeProposal.id)
    : [];
  const hasVoted =
    !!activeProposal &&
    !!currentPlayer &&
    activeVotes.some((vote) => vote.player_id === currentPlayer.id);

  const missionRow = missions.find((mission) => mission.mission_number === currentMission) ?? null;
  const missionTeam = missionRow?.team_player_ids ?? approvedProposal?.team_player_ids ?? [];
  const isOnMissionTeam = currentPlayer ? missionTeam.includes(currentPlayer.id) : false;
  const missionResolved = !!missionRow?.result;
  const missionInProgress = !!approvedProposal && !missionResolved;

  const successCount = missions.filter((mission) => mission.result === "success").length;
  const failCount = missions.filter((mission) => mission.result === "fail").length;
  const isAssassinPhase = successCount >= 3 && !game?.winner;

  const roleLabel = currentPlayer?.role
    ? ROLE_LABELS[currentPlayer.role]
    : "Awaiting role";
  const roleAlignment = currentPlayer?.role
    ? ROLE_ALIGNMENT[currentPlayer.role]
    : null;

  // Deriving this state dynamically prevents the need for useEffect resets
  const hasSubmittedMissionCard = submittedMissionNumber === currentMission;
  const canSubmitCard = !!approvedProposal && !!missionRow && isOnMissionTeam && !hasSubmittedMissionCard;

  if (!isMounted) {
    return null;
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-amber-300/80">
                War Table
              </p>
              <h1 className="font-display text-3xl text-white">
                Room {roomCode}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setShowRole(true)}
              className="rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-amber-200 transition hover:bg-amber-400/20"
            >
              Reveal Role
            </button>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-300">
              Mission {currentMission} in progress. Team size: {teamSize}.
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-300">
              Vote track: {game?.vote_track ?? 0} / 5
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-300">
              Score: {successCount} success / {failCount} fail
            </div>
          </div>
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </header>

        <section className="rounded-3xl border border-white/10 bg-black/40 p-6">
          <h2 className="text-lg font-semibold text-white">Quest Tracker</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => {
              const missionNumber = index + 1;
              const mission = missions.find(
                (item) => item.mission_number === missionNumber
              );
              const size = getMissionTeamSize(playerCount, missionNumber);
              const requiredFails = getRequiredFails(playerCount, missionNumber);

              return (
                <div
                  key={missionNumber}
                  className={`rounded-2xl border px-4 py-4 text-center ${
                    mission?.result === "success"
                      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-100"
                      : mission?.result === "fail"
                        ? "border-rose-400/50 bg-rose-500/10 text-rose-100"
                        : "border-white/10 bg-white/5 text-slate-300"
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.3em]">Quest {missionNumber}</p>
                  <p className="mt-2 text-lg font-semibold">{size} players</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {requiredFails} fail{requiredFails > 1 ? "s" : ""} needed
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {game?.status === "finished" ? (
          <section className="rounded-3xl border border-white/10 bg-black/40 p-6 text-center">
            <p className="text-xs uppercase tracking-[0.4em] text-amber-300/80">
              Game Over
            </p>
            <h2 className="mt-3 font-display text-3xl text-white">
              {game?.winner === "good" ? "The Light Prevails" : "Shadows Triumph"}
            </h2>
          </section>
        ) : isAssassinPhase ? (
          <section className="rounded-3xl border border-rose-400/30 bg-rose-500/10 p-6">
            <h2 className="text-lg font-semibold text-white">Assassin&apos;s Guess</h2>
            <p className="mt-2 text-sm text-rose-100/80">
              The Light has won three missions. The Assassin must identify Merlin.
            </p>
            {currentPlayer?.role === "assassin" ? (
              <div className="mt-6 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {players.map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => setAssassinTarget(player.id)}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                        assassinTarget === player.id
                          ? "border-rose-400/60 bg-rose-500/20 text-rose-100"
                          : "border-white/10 bg-white/5 text-slate-300"
                      }`}
                    >
                      {player.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!assassinTarget || isLoading}
                  onClick={async () => {
                    if (!game || !assassinTarget) return;
                    await assassinate({ gameId: game.id, guessedPlayerId: assassinTarget });
                  }}
                  className="w-full rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-rose-500/50"
                >
                  {isLoading ? "Striking..." : "Reveal Merlin"}
                </button>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300">
                Awaiting the Assassin&apos;s choice.
              </div>
            )}
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-3xl border border-white/10 bg-black/40 p-6">
              <h2 className="text-lg font-semibold text-white">Team Proposal</h2>
              <p className="mt-2 text-sm text-slate-300">
                {leader
                  ? `Leader: ${leader.name}. Select ${teamSize} players.`
                  : "Waiting for leader."}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {players.map((player) => {
                  const selected = teamSelection.includes(player.id);
                  const disabled =
                    !currentPlayer ||
                    currentPlayer.id !== leader?.id ||
                    !!activeProposal ||
                    missionInProgress;
                  return (
                    <button
                      key={player.id}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setTeamSelection((prev) =>
                          prev.includes(player.id)
                            ? prev.filter((id) => id !== player.id)
                            : [...prev, player.id]
                        )
                      }
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                        selected
                          ? "border-teal-400/60 bg-teal-400/10 text-teal-100"
                          : "border-white/10 bg-white/5 text-slate-300"
                      } ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-teal-300/60"}`}
                    >
                      <span>{player.name}</span>
                      {selected ? (
                        <span className="text-xs uppercase tracking-[0.3em]">Selected</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={
                  !currentPlayer ||
                  currentPlayer.id !== leader?.id ||
                  teamSelection.length !== teamSize ||
                  !!activeProposal ||
                  missionInProgress ||
                  isLoading
                }
                onClick={async () => {
                  if (!game || !currentPlayer) return;
                  await submitProposal({
                    gameId: game.id,
                    missionNumber: currentMission,
                    proposerId: currentPlayer.id,
                    teamPlayerIds: teamSelection,
                  });
                  setTeamSelection([]);
                }}
                className="mt-6 w-full rounded-2xl border border-teal-300/50 bg-teal-400/10 px-4 py-3 text-sm font-semibold text-teal-100 transition hover:bg-teal-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activeProposal ? "Proposal in voting" : "Submit Proposal"}
              </button>
            </section>

            <section className="flex flex-col gap-6">
              <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
                <h2 className="text-lg font-semibold text-white">Vote on Team</h2>
                <p className="mt-2 text-sm text-slate-300">
                  {activeProposal
                    ? `Vote on team (${activeProposal.team_player_ids.length} selected).`
                    : "Waiting for a proposal."}
                </p>
                <div className="mt-4 text-xs uppercase tracking-[0.3em] text-slate-400">
                  Votes {activeVotes.length} / {players.length}
                </div>
                <div className="mt-6 grid gap-3">
                  <button
                    type="button"
                    disabled={!activeProposal || hasVoted || !currentPlayer}
                    onClick={() =>
                      activeProposal &&
                      currentPlayer &&
                      submitVote({
                        gameId: activeProposal.game_id,
                        proposalId: activeProposal.id,
                        playerId: currentPlayer.id,
                        vote: "approve",
                      })
                    }
                    className="w-full rounded-2xl bg-emerald-400/20 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={!activeProposal || hasVoted || !currentPlayer}
                    onClick={() =>
                      activeProposal &&
                      currentPlayer &&
                      submitVote({
                        gameId: activeProposal.game_id,
                        proposalId: activeProposal.id,
                        playerId: currentPlayer.id,
                        vote: "reject",
                      })
                    }
                    className="w-full rounded-2xl bg-rose-500/20 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!activeProposal || activeVotes.length < players.length || !currentPlayer?.is_host}
                  onClick={async () => {
                    if (!activeProposal) return;
                    await finalizeVote({ gameId: activeProposal.game_id, proposalId: activeProposal.id });
                  }}
                  className="mt-4 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/80 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Finalize Vote
                </button>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
                <h2 className="text-lg font-semibold text-white">Mission Action</h2>
                <p className="mt-2 text-sm text-slate-300">
                  {approvedProposal
                    ? "If you are on the team, submit a success or fail card."
                    : "Waiting for an approved team."}
                </p>
                <div className="mt-6 grid gap-3">
                  <button
                    type="button"
                    disabled={!canSubmitCard}
                    onClick={async () => {
                      if (missionRow && currentPlayer) {
                        await submitMissionCard({
                          missionId: missionRow.id,
                          playerId: currentPlayer.id,
                          card: "success",
                        });
                        setSubmittedMissionNumber(currentMission);
                      }
                    }}
                    className="w-full rounded-2xl bg-emerald-400/20 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {hasSubmittedMissionCard ? "Card Submitted" : "Success"}
                  </button>
                  <button
                    type="button"
                    disabled={!canSubmitCard || roleAlignment !== "evil"}
                    onClick={async () => {
                      if (missionRow && currentPlayer) {
                        await submitMissionCard({
                          missionId: missionRow.id,
                          playerId: currentPlayer.id,
                          card: "fail",
                        });
                        setSubmittedMissionNumber(currentMission);
                      }
                    }}
                    className="w-full rounded-2xl bg-rose-500/20 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {hasSubmittedMissionCard ? "Card Submitted" : "Fail"}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!missionRow || missionResolved || !currentPlayer?.is_host}
                  onClick={async () => {
                    if (!game || !missionRow) return;
                    await resolveMission({
                      gameId: game.id,
                      missionId: missionRow.id,
                      playerCount,
                      missionNumber: currentMission,
                    });
                  }}
                  className="mt-4 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/80 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Resolve Mission
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      {showRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/90 p-8 shadow-[0_30px_120px_rgba(0,0,0,0.6)]">
            <p className="text-xs uppercase tracking-[0.4em] text-amber-300/80">
              Your Role
            </p>
            <h2 className="mt-3 font-display text-3xl text-white">
              {roleLabel}
            </h2>
            <p className="mt-3 text-sm text-slate-300">
              {currentPlayer?.role
                ? roleAlignment === "good"
                  ? "Protect Merlin and steer the quests to victory."
                  : "Sabotage missions without being discovered."
                : "Waiting for the host to begin the game."}
            </p>
            <button
              type="button"
              onClick={() => setShowRole(false)}
              className="mt-6 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Hide Role
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function subscribeToHydration(callback: () => void): () => void {
  return () => callback();
}

function getHydrationSnapshot(): boolean {
  return true;
}

function getHydrationServerSnapshot(): boolean {
  return false;
}