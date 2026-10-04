"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameState } from "@/hooks/useGameState";
import {
  getEvilCount,
  getMissionTeamSize,
  getRequiredFails,
} from "@/lib/avalon/logic";
import type { Snapshot, RoleName } from "@/lib/avalon/types";
import Rules from "./Rules";

const labels: Record<RoleName, string> = {
  merlin: "Merlin",
  percival: "Percival",
  loyal_servant: "Loyal Servant",
  assassin: "Assassin",
  morgana: "Morgana",
  mordred: "Mordred",
  oberon: "Oberon",
  minion: "Minion of Mordred",
};
type Act = (
  name: string,
  payload?: Record<string, unknown>,
) => Promise<boolean>;
const phases = {
  lobby: "Gather at the table",
  team: "Choose a quest team",
  vote: "Vote on the team",
  quest: "Play quest cards",
  lady: "Lady of the Lake",
  assassination: "The Assassin’s final guess",
  finished: "Game over",
};

export default function RoomClient({ roomCode }: { roomCode: string }) {
  const state = useGameState(roomCode);
  const [notice, setNotice] = useState("");
  const router = useRouter();
  if (!state.data)
    return (
      <main className="room">
        <section className="panel space-y-4">
          <h1 className="font-display text-3xl">Room {roomCode}</h1>
          <p role="status">
            {state.connection === "offline"
              ? "Unable to load this room. Check your connection, join the room, or recover your player identity from the home page."
              : "Connecting to the table…"}
          </p>
          {state.error && <p role="alert">{state.error}</p>}
          <button onClick={() => void state.refresh()}>Try again</button>{" "}
          <Link href={`/?room=${encodeURIComponent(roomCode)}`}>
            Join or recover player
          </Link>
        </section>
      </main>
    );
  const s = state.data;
  const me = s.players.find((p) => p.id === s.me)!;
  const names = (ids: string[]) =>
    ids
      .map((id) => s.players.find((p) => p.id === id)?.name ?? "Former player")
      .join(", ");
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?room=${s.game.code}`,
      );
      setNotice("Invite link copied.");
    } catch {
      setNotice(`Share room code ${s.game.code}.`);
    }
  };
  return (
    <main className="room">
      <header className="panel space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Avalon · {me.name}</p>
            <h1 className="font-display text-4xl">{s.game.code}</h1>
          </div>
          <button onClick={copyInvite}>Copy invite link</button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <span>{phases[s.game.phase]}</span>
          <span role="status">
            {state.connection === "online"
              ? "Connected · updates every 2s"
              : "Connection lost · retrying…"}
          </span>
        </div>
        {notice && <p role="status">{notice}</p>}
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
      </header>
      <fieldset
        disabled={state.isLoading || state.connection !== "online"}
        className="contents"
      >
        {s.game.phase === "lobby" ? (
          <Lobby s={s} act={state.action} />
        ) : (
          <>
            <section className="panel">
              <div className="flex flex-wrap justify-between gap-4">
                <h2>{phases[s.game.phase]}</h2>
                <span>
                  {s.quests.filter((q) => q.result === "success").length}{" "}
                  successes ·{" "}
                  {s.quests.filter((q) => q.result === "fail").length} failures
                  · {s.game.rejections}/5 rejected teams
                </span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const q = s.quests.find((x) => x.number === n);
                  return (
                    <div key={n} className={`quest ${q?.result ?? ""}`}>
                      <strong>Quest {n}</strong>
                      <p>{getMissionTeamSize(s.players.length, n)} players</p>
                      <p>
                        {getRequiredFails(s.players.length, n)} fail
                        {getRequiredFails(s.players.length, n) > 1 ? "s" : ""}{" "}
                        needed
                      </p>
                      <p>
                        {q?.result
                          ? `${q.result} · ${q.fails} fail cards`
                          : s.game.quest === n
                            ? "Current quest"
                            : "Unplayed"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="panel">
              <details key={s.game.round_id}>
                <summary>Reveal my role and knowledge</summary>
                <div className="mt-4 space-y-3">
                  <h2>
                    {s.hand.role ? labels[s.hand.role] : "Awaiting role"} ·{" "}
                    {s.hand.alignment}
                  </h2>
                  <p>
                    Keep this panel private. Close it before sharing your
                    screen.
                  </p>
                  {!!s.hand.knownEvilIds.length && (
                    <p>
                      Known evil: <strong>{names(s.hand.knownEvilIds)}</strong>
                    </p>
                  )}
                  {!!s.hand.seenAsMerlinIds.length && (
                    <p>
                      Possible Merlin:{" "}
                      <strong>{names(s.hand.seenAsMerlinIds)}</strong>. With
                      Morgana in play, you cannot distinguish them.
                    </p>
                  )}
                  {s.hand.role === "merlin" && (
                    <p>
                      You see evil players including Oberon, but not Mordred.
                      Keep your identity hidden.
                    </p>
                  )}
                  {s.hand.role === "oberon" && (
                    <p>
                      You are evil. You do not know the other evil players, and
                      they do not know you. Merlin can see you.
                    </p>
                  )}
                  {s.hand.role === "loyal_servant" && (
                    <p>
                      You are good and have no special knowledge. Watch the
                      discussion and voting history.
                    </p>
                  )}
                  {s.hand.role === "assassin" && (
                    <p>
                      If three quests succeed, you must identify Merlin to win
                      for evil.
                    </p>
                  )}
                  {s.hand.inspections.map((x, i) => (
                    <p key={i}>
                      Lady inspection: {names([x.target])} is{" "}
                      <strong>{x.alignment}</strong>.
                    </p>
                  ))}
                </div>
              </details>
            </section>
            <GameTurn
              key={`${s.game.round_id}:${s.game.phase}:${s.proposals.length}`}
              s={s}
              act={state.action}
            />
          </>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="panel space-y-4">
            <h2>Players · {s.players.length}/10</h2>
            <ul className="space-y-3">
              {s.players.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {p.name}
                    {p.id === s.me ? " (you)" : ""} {p.host ? "· host" : ""}{" "}
                    {p.id === s.game.leader_id ? "· leader" : ""}{" "}
                    {p.id === s.game.lady_id ? "· Lady" : ""}{" "}
                    <span className="text-slate-400">
                      · {p.online ? "online" : "away"}
                    </span>
                    {s.game.phase === "finished" && p.role && (
                      <>
                        {" "}
                        · <strong>{labels[p.role]}</strong>
                      </>
                    )}
                  </span>
                  {me.host && p.id !== me.id && (
                    <span className="flex gap-2">
                      <button
                        className="small"
                        onClick={() => {
                          if (confirm(`Make ${p.name} the host?`))
                            void state.action("transfer_host", {
                              target: p.id,
                            });
                        }}
                      >
                        Make host
                      </button>
                      {s.game.phase === "lobby" && (
                        <button
                          className="small"
                          onClick={() => {
                            if (confirm(`Remove ${p.name} from this lobby?`))
                              void state.action("kick", { target: p.id });
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {s.can_claim_host && !me.host && (
              <button onClick={() => void state.action("claim_host")}>
                Take over as host
              </button>
            )}
            <p className="text-sm text-slate-400">
              If the host is away for 90 seconds, another player can take over.
              Votes and quests finish automatically.
            </p>
            {s.game.phase === "lobby" || s.game.phase === "finished" ? (
              <button
                onClick={async () => {
                  if (confirm("Leave this room?")) {
                    if (await state.action("leave")) {
                      localStorage.removeItem("avalon_last_room");
                      router.push("/");
                    }
                  }
                }}
              >
                Leave room
              </button>
            ) : (
              me.host && (
                <button
                  className="danger"
                  onClick={() => {
                    if (
                      confirm(
                        "Abandon this game and return everyone to the lobby? Roles and game history will be cleared.",
                      )
                    )
                      void state.action("abort");
                  }}
                >
                  Abandon game
                </button>
              )
            )}
          </section>
          <Chat s={s} act={state.action} />
        </div>
        {!!s.proposals.length && (
          <section className="panel">
            <h2>Voting history</h2>
            <div className="mt-4 space-y-4">
              {[...s.proposals].reverse().map((p) => (
                <details key={p.id}>
                  <summary>
                    #{p.number} · Quest {p.quest} · {p.status} · {names(p.team)}
                  </summary>
                  <p className="mt-2">Proposed by {names([p.leader_id])}</p>
                  <ul>
                    {p.votes.map((v) => (
                      <li key={v.player_id}>
                        {names([v.player_id])}: {v.card ?? "vote sealed"}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>
        )}
      </fieldset>
      <Rules />
      <section className="panel">
        <details>
          <summary>Save my recovery key</summary>
          <p className="my-3">
            This private key restores your player on another browser. Anyone
            with it can act as you. Save it somewhere private; do not send it in
            room chat.
          </p>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.sessionId!);
                setNotice("Private recovery key copied. Keep it secret.");
              } catch {
                setNotice(
                  "Clipboard unavailable. Select the key below to copy it.",
                );
              }
            }}
          >
            Copy private key
          </button>
          <code className="mt-3 block break-all">{state.sessionId}</code>
        </details>
      </section>
    </main>
  );
}

function Lobby({ s, act }: { s: Snapshot; act: Act }) {
  const me = s.players.find((p) => p.id === s.me)!;
  const evilOptions = ["morgana", "mordred", "oberon"] as const;
  const tooMany =
    1 + evilOptions.filter((k) => s.game.options[k]).length >
    getEvilCount(s.players.length);
  const unbalanced =
    s.players.length === 5 &&
    s.game.options.percival &&
    !s.game.options.morgana &&
    !s.game.options.mordred;
  const ready = s.players.every((p) => p.ready && p.online);
  const descriptions = {
    percival: "Good · sees Merlin and Morgana as possible Merlin",
    morgana: "Evil · appears as Merlin to Percival",
    mordred: "Evil · hidden from Merlin",
    oberon: "Evil · unknown to other evil; visible to Merlin",
    lady: "Inspect loyalty after quests 2, 3 and 4 (recommended for 7+)",
    targeting:
      "Leaders choose the order of quests; quest 5 needs two successes",
  };
  return (
    <section className="panel space-y-5">
      <h2>Prepare the game</h2>
      <p>
        5–10 players. Merlin and the Assassin are always included.{" "}
        {s.players.length >= 5 && (
          <>
            This table has {getEvilCount(s.players.length)} evil and{" "}
            {s.players.length - getEvilCount(s.players.length)} good roles.
          </>
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(descriptions) as (keyof typeof descriptions)[]).map(
          (k) => (
            <label className="option" key={k}>
              <input
                type="checkbox"
                checked={s.game.options[k]}
                disabled={!me.host}
                onChange={(e) =>
                  void act("options", { options: { [k]: e.target.checked } })
                }
              />
              <span>
                <strong className="capitalize">
                  {k === "lady" ? "Lady of the Lake" : k}
                </strong>
                <span className="block text-sm text-slate-400">
                  {descriptions[k]}
                </span>
              </span>
            </label>
          ),
        )}
      </div>
      {s.players.length >= 5 && tooMany && (
        <p className="error">
          Too many special evil roles. Include the Assassin within the{" "}
          {getEvilCount(s.players.length)} evil slots.
        </p>
      )}
      {unbalanced && (
        <p className="error">
          For 5 players with Percival, enable Morgana or Mordred.
        </p>
      )}
      <p>
        {s.players.filter((p) => p.ready).length}/{s.players.length} players
        ready. Changing options or the roster resets readiness.
      </p>
      <div className="flex flex-wrap gap-3">
        <button onClick={() => void act("ready", { ready: !me.ready })}>
          {me.ready ? "Not ready" : "I’m ready"}
        </button>
        {me.host && (
          <button
            className="primary"
            disabled={!ready || s.players.length < 5 || tooMany || unbalanced}
            onClick={() => void act("start")}
          >
            Start game
          </button>
        )}
      </div>
      {!me.host && (
        <p className="text-sm text-slate-400">
          The host starts once everyone is ready.
        </p>
      )}
    </section>
  );
}

function GameTurn({ s, act }: { s: Snapshot; act: Act }) {
  const [team, setTeam] = useState<string[]>([]);
  const [chosenQuest, setChosenQuest] = useState(s.game.quest);
  const [target, setTarget] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const names = (ids: string[]) =>
    ids
      .map((id) => s.players.find((p) => p.id === id)?.name ?? "Former player")
      .join(", ");
  const pr = s.proposals.find((p) => p.status === "pending");
  const q = s.quests.find((q) => q.number === s.game.quest);
  const size = getMissionTeamSize(s.players.length, chosenQuest);
  const phase = s.game.phase;
  const isLeader = s.game.leader_id === s.me;
  if (phase === "finished")
    return (
      <section className="panel space-y-4 text-center">
        <p className="eyebrow">Game over</p>
        <h2 className="font-display text-4xl">
          {s.game.winner === "good" ? "The Light Prevails" : "Shadows Triumph"}
        </h2>
        <p>{s.game.reason}</p>
        {s.game.assassin_target && (
          <p>Assassin’s target: {names([s.game.assassin_target])}</p>
        )}
        {s.players.find((p) => p.id === s.me)?.host && (
          <button className="primary" onClick={() => void act("rematch")}>
            Play again with this group
          </button>
        )}
      </section>
    );
  return (
    <section className="panel space-y-5">
      {phase === "team" && (
        <>
          <h2>Leader: {names([s.game.leader_id!])}</h2>
          <p>Discuss a team before submitting. Every player gets a vote.</p>
          {s.game.options.targeting && (
            <label>
              Choose quest{" "}
              <select
                aria-label="Choose quest"
                value={chosenQuest}
                disabled={!isLeader}
                onChange={(e) => {
                  setChosenQuest(Number(e.target.value));
                  setTeam([]);
                }}
              >
                {[1, 2, 3, 4, 5]
                  .filter((n) => !s.quests.some((q) => q.number === n))
                  .map((n) => (
                    <option
                      key={n}
                      value={n}
                      disabled={
                        n === 5 &&
                        s.quests.filter((q) => q.result === "success").length <
                          2
                      }
                    >
                      Quest {n} · {getMissionTeamSize(s.players.length, n)}{" "}
                      players
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p>Select exactly {size} players. The leader may be on the team.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.players.map((p) => (
              <label className="option" key={p.id}>
                <input
                  type="checkbox"
                  checked={team.includes(p.id)}
                  disabled={
                    !isLeader || (!team.includes(p.id) && team.length >= size)
                  }
                  onChange={() =>
                    setTeam((old) =>
                      old.includes(p.id)
                        ? old.filter((id) => id !== p.id)
                        : [...old, p.id],
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
          <button
            className="primary"
            disabled={!isLeader || team.length !== size}
            onClick={() =>
              void act("propose", {
                team,
                quest: chosenQuest,
                turn: s.proposals.length,
              })
            }
          >
            Propose {team.length}/{size} players
          </button>
        </>
      )}
      {phase === "vote" && pr && (
        <>
          <h2>Quest {pr.quest}: proposed team</h2>
          <p className="text-xl">{names(pr.team)}</p>
          <p>
            Leader: {names([pr.leader_id])}. A strict majority approves; a tie
            rejects.
          </p>
          <p>
            {pr.votes.length}/{s.players.length} votes submitted. Choices are
            revealed together.
          </p>
          <p>
            Waiting for:{" "}
            {names(
              s.players
                .filter((p) => !pr.votes.some((v) => v.player_id === p.id))
                .map((p) => p.id),
            ) || "Resolving…"}
          </p>
          {pr.votes.some((v) => v.player_id === s.me) ? (
            <p role="status">Your vote is sealed.</p>
          ) : (
            <div className="flex gap-3">
              {(["approve", "reject"] as const).map((card) => (
                <button
                  className={card === "approve" ? "primary" : "danger"}
                  key={card}
                  onClick={() => void act("vote", { proposal: pr.id, card })}
                >
                  {card === "approve" ? "Approve" : "Reject"}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {phase === "quest" && q && (
        <>
          <h2>Quest team: {names(q.team)}</h2>
          <p>
            {q.submitted}/{q.team.length} cards submitted. Only the final counts
            will be revealed.
          </p>
          {q.team.includes(s.me) ? (
            q.my_card || submitted ? (
              <p role="status">Your card is submitted. Waiting for the team.</p>
            ) : (
              <div className="flex gap-3">
                {(["success", "fail"] as const).map((card) => (
                  <button
                    key={card}
                    className={card === "success" ? "primary" : "danger"}
                    disabled={card === "fail" && s.hand.alignment !== "evil"}
                    onClick={async () => {
                      if (await act("card", { quest_id: q.id, card }))
                        setSubmitted(true);
                    }}
                  >
                    {card === "success" ? "Play Success" : "Play Fail"}
                  </button>
                ))}
              </div>
            )
          ) : (
            <p>You are not on this team. Wait for its members to submit.</p>
          )}
        </>
      )}
      {(phase === "lady" || phase === "assassination") && (
        <>
          <h2>
            {phase === "lady"
              ? `${names([s.game.lady_id!])} holds the Lady of the Lake`
              : "Three quests succeeded. Can the Assassin identify Merlin?"}
          </h2>
          <p>
            {phase === "lady"
              ? "The holder privately learns one player’s alignment, then passes them the token. Previous holders cannot be inspected."
              : "Discuss before the final guess. Roles stay hidden until the Assassin chooses."}
          </p>
          {(
            phase === "lady"
              ? s.game.lady_id === s.me
              : s.hand.role === "assassin"
          ) ? (
            <>
              <label>
                Choose a player{" "}
                <select
                  aria-label="Choose a player"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Select player</option>
                  {s.players
                    .filter((p) =>
                      phase === "lady"
                        ? p.id !== s.me && !s.game.lady_used.includes(p.id)
                        : p.id !== s.me && !s.hand.knownEvilIds.includes(p.id),
                    )
                    .map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={!target}
                onClick={() => {
                  if (
                    phase === "lady" ||
                    confirm(
                      `Identify ${names([target])} as Merlin? This ends the game.`,
                    )
                  )
                    void act(phase === "lady" ? "inspect" : "assassinate", {
                      target,
                    });
                }}
              >
                {phase === "lady" ? "Inspect loyalty" : "Make final guess"}
              </button>
            </>
          ) : (
            <p>
              Waiting for{" "}
              {phase === "lady" ? "the Lady holder" : "the Assassin"}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Chat({ s, act }: { s: Snapshot; act: Act }) {
  const [body, setBody] = useState("");
  return (
    <section className="panel space-y-4">
      <h2>Table talk</h2>
      <p className="text-sm text-slate-400">
        Discuss here or in your voice call. Claims and deception are part of the
        game.
      </p>
      <div
        className="max-h-72 overflow-y-auto space-y-2"
        role="log"
        aria-label="Room chat"
      >
        {!s.messages.length && <p>No messages yet.</p>}
        {s.messages.map((m) => (
          <p key={m.id} className="break-words">
            <strong>{m.name}: </strong>
            {m.body}
          </p>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act("chat", { body })) setBody("");
        }}
      >
        <input
          aria-label="Message"
          maxLength={500}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Discuss the quest…"
        />
        <button type="submit" disabled={!body.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
