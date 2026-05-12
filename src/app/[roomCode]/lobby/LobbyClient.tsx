"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useGameState } from "@/hooks/useGameState";

interface LobbyClientProps {
  roomCode: string;
}

export default function LobbyClient({ roomCode }: LobbyClientProps) {
  const router = useRouter();
  const isMounted = useSyncExternalStore(
    subscribeToHydration,
    getHydrationSnapshot,
    getHydrationServerSnapshot
  );
  const {
    sessionId,
    game,
    players,
    isLoading,
    error,
    startGame,
  } = useGameState(roomCode);

  const [roleOptions, setRoleOptions] = useState({
    percival: true,
    morgana: true,
    mordred: false,
    oberon: false,
  });

  const currentPlayer = useMemo(
    () => players.find((player) => player.session_id === sessionId) ?? null,
    [players, sessionId]
  );

  const isHost = currentPlayer?.is_host ?? false;

  // Auto-redirect all players to the game page once the status changes to "in_progress" or "finished"
  useEffect(() => {
    if (game?.status === "in_progress" || game?.status === "finished") {
      router.push(`/${roomCode}/game`);
    }
  }, [game?.status, roomCode, router]);

  if (!isMounted) {
    return null;
  }

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.4em] text-amber-300/80">
            Room Sigil
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-display text-4xl text-white">{roomCode}</h1>
            <div className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-300">
              {game?.status ?? "lobby"}
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-300">
            Share the code and wait until everyone arrives. The host can fine
            tune roles before the game begins.
          </p>
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-black/40 p-6">
            <h2 className="text-lg font-semibold text-white">Connected Players</h2>
            <p className="mt-2 text-sm text-slate-300">
              {players.length} players connected.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {players.map((player) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <span className="text-sm text-white">{player.name}</span>
                  {player.is_host ? (
                    <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">
                      Host
                    </span>
                  ) : null}
                </div>
              ))}
              {players.length === 0 && !isLoading ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-400">
                  Waiting for the first knight to arrive.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/40 p-6">
            <h2 className="text-lg font-semibold text-white">Optional Roles</h2>
            <p className="mt-2 text-sm text-slate-300">
              Toggle the advanced roles for extra deception.
            </p>
            <div className="mt-6 space-y-3">
              {(
                [
                  { key: "percival", label: "Percival", hint: "Sees Merlin/Morgana" },
                  { key: "morgana", label: "Morgana", hint: "Mimics Merlin" },
                  { key: "mordred", label: "Mordred", hint: "Hidden from Merlin" },
                  { key: "oberon", label: "Oberon", hint: "Unknown to evil" },
                ] as const
              ).map((role) => (
                <button
                  key={role.key}
                  type="button"
                  disabled={!isHost}
                  onClick={() =>
                    setRoleOptions((prev) => ({
                      ...prev,
                      [role.key]: !prev[role.key],
                    }))
                  }
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    roleOptions[role.key]
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                      : "border-white/10 bg-white/5 text-slate-300"
                  } ${!isHost ? "cursor-not-allowed opacity-60" : "hover:border-amber-400/60"}`}
                >
                  <div>
                    <p className="font-semibold">{role.label}</p>
                    <p className="text-xs text-slate-400">{role.hint}</p>
                  </div>
                  <span className="text-xs uppercase tracking-[0.3em]">
                    {roleOptions[role.key] ? "On" : "Off"}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={!isHost || isLoading || players.length < 5}
              onClick={async () => {
                if (!game) return;
                await startGame({ gameId: game.id, roleOptions });
              }}
              className="mt-6 w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-400/40"
            >
              {players.length < 5
                ? "Need at least 5 players"
                : isLoading
                  ? "Starting..."
                  : "Start Game"}
            </button>
          </section>
        </div>
      </div>
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