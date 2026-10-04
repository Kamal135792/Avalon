"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameState } from "@/hooks/useGameState";
import Rules from "./Rules";

export default function LandingClient() {
  const router = useRouter();
  const { createGame, joinGame, recover, error, isLoading } = useGameState();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const [last, setLast] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      const invite = new URLSearchParams(location.search).get("room");
      if (invite && /^[A-Z]{4}$/i.test(invite)) setCode(invite.toUpperCase());
      try {
        setLast(localStorage.getItem("avalon_last_room") ?? "");
      } catch {
        /* Storage errors are reported by the hook. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const valid = name.trim().length >= 2 && name.trim().length <= 24;
  return (
    <main className="room min-h-screen content-center">
      <section className="panel space-y-6">
        <p className="eyebrow">Avalon Anonymous · 5–10 friends</p>
        <h1 className="font-display text-5xl">
          A secret role.
          <br />A table full of suspects.
        </h1>
        <p className="max-w-2xl text-slate-300">
          Create a room, share its code, and find whom to trust. Play together
          in person, in a voice call, or using table chat.
        </p>
        <label className="block max-w-md">
          Your display name
          <input
            className="mt-2"
            aria-label="Display name"
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sir Kay"
            autoComplete="nickname"
          />
        </label>
        <fieldset disabled={isLoading} className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3">
            <h2>Host a table</h2>
            <p>Choose roles and start when everyone is ready.</p>
            <button
              className="primary"
              disabled={!valid}
              onClick={async () => {
                const c = await createGame({ name });
                if (c) router.push(`/${c}/lobby`);
              }}
            >
              Create room
            </button>
          </div>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const c = await joinGame({ roomCode: code, name });
              if (c) router.push(`/${c}/lobby`);
            }}
          >
            <h2>Join your friends</h2>
            <input
              aria-label="Room code"
              placeholder="ABCD"
              maxLength={4}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
              }
            />
            <button type="submit" disabled={!valid || code.length !== 4}>
              Join room
            </button>
          </form>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {last && (
          <button onClick={() => router.push(`/${last}/lobby`)}>
            Return to room {last}
          </button>
        )}
        <p className="text-sm text-slate-400">
          Your identity stays in this browser. Tabs share one player. Use
          another browser profile or a private window for a second player.
        </p>
        <details>
          <summary>Recover an existing player</summary>
          <p className="my-3">
            Paste the private recovery key you saved in your room. This replaces
            this browser’s player identity; then use the room code to return.
          </p>
          <input
            type="password"
            autoComplete="off"
            aria-label="Recovery key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            className="mt-3"
            onClick={() => {
              if (recover(key)) {
                setKey("");
                setNotice(
                  "Player restored. Enter your room code and join, or return to your last room.",
                );
              }
            }}
          >
            Restore player
          </button>
        </details>
      </section>
      <Rules />
    </main>
  );
}
