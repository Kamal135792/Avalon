"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameState } from "@/hooks/useGameState";

export default function LandingClient() {
  const router = useRouter();
  const { createGame, joinGame, error, isLoading } = useGameState();
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const normalizedRoomCode = useMemo(
    () => roomCode.trim().toUpperCase(),
    [roomCode]
  );

  const canSubmit = name.trim().length > 1;

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute left-12 top-20 h-28 w-28 rounded-full bg-amber-500/40 blur-3xl" />
        <div className="absolute right-20 top-10 h-40 w-40 rounded-full bg-teal-400/30 blur-3xl" />
        <div className="absolute bottom-12 left-1/3 h-36 w-36 rounded-full bg-amber-300/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-4xl rounded-3xl border border-white/10 bg-white/5 p-10 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="grid gap-10 md:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <p className="font-display text-sm uppercase tracking-[0.4em] text-amber-300/80">
              Avalon Anonymous
            </p>
            <h1 className="font-display text-4xl leading-tight text-white md:text-5xl">
              Deceive, deduce, and vanish. No accounts. Just the code.
            </h1>
            <p className="text-base text-slate-300/90 md:text-lg">
              Create a private war table in seconds. Share a 4-letter sigil and
              uncover who serves the Light and who plots in the shadows.
            </p>

            <div className="grid gap-3">
              <label className="text-xs uppercase tracking-[0.3em] text-slate-300">
                Display Name
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Sir Kay, Lady Nyx, ..."
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-base text-white outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-400/30"
              />
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/40 p-6">
              <h2 className="text-lg font-semibold text-white">Create a new room</h2>
              <p className="mt-2 text-sm text-slate-300">
                You become the host. Configure roles in the lobby.
              </p>
              <button
                type="button"
                disabled={!canSubmit || isLoading}
                onClick={async () => {
                  const code = await createGame({ name: name.trim() });
                  if (code) {
                    router.push(`/${code}/lobby`);
                  }
                }}
                className="mt-4 w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-semibold text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-400/50"
              >
                {isLoading ? "Forging room..." : "Create Game"}
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/40 p-6">
              <h2 className="text-lg font-semibold text-white">Join with a sigil</h2>
              <p className="mt-2 text-sm text-slate-300">
                Enter the room code from your host.
              </p>
              <input
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value)}
                maxLength={4}
                placeholder="ABCD"
                className="mt-4 w-full rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-center text-lg uppercase tracking-[0.4em] text-white outline-none transition focus:border-teal-300/70 focus:ring-2 focus:ring-teal-400/30"
              />
              <button
                type="button"
                disabled={!canSubmit || normalizedRoomCode.length !== 4 || isLoading}
                onClick={async () => {
                  const code = await joinGame({
                    roomCode: normalizedRoomCode,
                    name: name.trim(),
                  });
                  if (code) {
                    router.push(`/${code}/lobby`);
                  }
                }}
                className="mt-4 w-full rounded-2xl border border-teal-300/50 bg-teal-400/20 px-4 py-3 text-sm font-semibold text-teal-100 transition hover:bg-teal-400/30 disabled:cursor-not-allowed disabled:border-teal-400/20"
              >
                {isLoading ? "Tracing sigil..." : "Join Game"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
