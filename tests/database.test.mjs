import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
let db;
before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated;");
  await db.exec(await readFile("avalon_scheme.sql", "utf8"));
});
after(async () => {
  await db?.close();
});
async function rpc(secret, name, args = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.headers',$1,true)", [
      JSON.stringify({ "x-session-id": secret }),
    ]);
    await tx.exec("set local role anon");
    const r = await tx.query(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
      args,
    );
    return r.rows[0].result;
  });
}
async function room(n = 5, options = {}) {
  const secrets = Array.from({ length: n }, () => randomUUID());
  const code = await rpc(secrets[0], "avalon_create", ["Player 1"]);
  for (let i = 1; i < n; i++)
    await rpc(secrets[i], "avalon_join", [code, `Player ${i + 1}`]);
  let state = await rpc(secrets[0], "avalon_state", [code]);
  const ids = state.players.map((p) => p.id);
  const secretFor = (id) => secrets[ids.indexOf(id)];
  const get = (id = ids[0]) => rpc(secretFor(id), "avalon_state", [code]);
  const act = (id, action, payload = {}) =>
    rpc(secretFor(id), "avalon_action", [
      code,
      state.game.round_id,
      action,
      payload,
    ]);
  if (Object.keys(options).length) await act(ids[0], "options", { options });
  return {
    code,
    secrets,
    ids,
    secretFor,
    get,
    act,
    start: async () => {
      for (const id of ids) await act(id, "ready", { ready: true });
      await act(ids[0], "start");
      return get();
    },
  };
}
async function roles(r) {
  return (
    await db.query(
      "select id,role from avalon_private.players where game_id=(select id from avalon_private.games where code=$1)",
      [r.code],
    )
  ).rows;
}
async function propose(r, team, quest) {
  let s = await r.get();
  await r.act(s.game.leader_id, "propose", {
    team,
    quest: quest ?? s.game.quest,
    turn: s.proposals.length,
  });
  return (await r.get()).proposals.at(-1);
}
async function approve(r, p) {
  for (const id of r.ids)
    await r.act(id, "vote", { proposal: p.id, card: "approve" });
  return (await r.get()).quests.find((q) => q.number === p.quest);
}
async function quest(r, fail = false, number) {
  const s = await r.get();
  const n = number ?? s.game.quest;
  const sizes = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
  };
  const rs = await roles(r);
  const evil = rs
    .filter((p) =>
      ["assassin", "morgana", "mordred", "oberon", "minion"].includes(p.role),
    )
    .map((p) => p.id);
  const team = [...evil, ...r.ids.filter((id) => !evil.includes(id))].slice(
    0,
    sizes[r.ids.length][n - 1],
  );
  const p = await propose(r, team, n);
  const q = await approve(r, p);
  for (const id of team)
    await r.act(id, "card", {
      quest_id: q.id,
      card: fail && evil.includes(id) ? "fail" : "success",
    });
  return r.get();
}
test("schema reset is repeatable and invalid anonymous requests fail", async () => {
  await db.exec(await readFile("avalon_scheme.sql", "utf8"));
  await assert.rejects(
    rpc(null, "avalon_create", ["Ab"]),
    /Missing player identity/,
  );
  await assert.rejects(rpc(randomUUID(), "avalon_create", ["A"]), /2–24/);
});
test("membership, four-letter codes, readiness, start limits and rejoin", async () => {
  const r = await room();
  assert.match(r.code, /^[A-Z]{4}$/);
  await assert.rejects(
    rpc(randomUUID(), "avalon_state", [r.code]),
    /not in this room/,
  );
  await assert.rejects(r.act(r.ids[1], "start"), /Only the host/);
  await assert.rejects(r.act(r.ids[0], "start"), /ready/);
  await r.start();
  assert.equal(
    await rpc(r.secrets[0], "avalon_join", [r.code, "Renamed"]),
    r.code,
  );
  await assert.rejects(
    rpc(randomUUID(), "avalon_join", [r.code, "Late player"]),
    /started/,
  );
  const ten = await room(10);
  await assert.rejects(
    rpc(randomUUID(), "avalon_join", [ten.code, "Eleven"]),
    /full/,
  );
  const four = await room(4);
  await assert.rejects(four.start(), /5–10/);
});
test("all player counts and all valid role combinations have correct teams and private knowledge", async () => {
  for (let n = 5; n <= 10; n++)
    for (let bits = 0; bits < 16; bits++) {
      const opts = {
        percival: !!(bits & 1),
        morgana: !!(bits & 2),
        mordred: !!(bits & 4),
        oberon: !!(bits & 8),
      };
      const ev = n <= 6 ? 2 : n <= 9 ? 3 : 4;
      const r = await room(n, opts);
      if (
        1 + ["morgana", "mordred", "oberon"].filter((k) => opts[k]).length >
          ev ||
        (n === 5 && opts.percival && !opts.morgana && !opts.mordred)
      ) {
        await assert.rejects(r.start(), /Too many|Percival/);
        continue;
      }
      await r.start();
      const rs = await roles(r);
      const evil = rs.filter((p) =>
        ["assassin", "morgana", "mordred", "oberon", "minion"].includes(p.role),
      );
      assert.equal(evil.length, ev);
      for (const p of rs) {
        const s = await r.get(p.id);
        assert.equal(s.hand.role, p.role);
        assert.ok(
          s.players.every(
            (x) => x.role === null && !("secret" in x) && !("session_id" in x),
          ),
        );
        const expected =
          p.role === "merlin"
            ? evil.filter((e) => e.role !== "mordred")
            : ["assassin", "morgana", "mordred", "minion"].includes(p.role)
              ? evil.filter((e) => e.role !== "oberon" && e.id !== p.id)
              : [];
        assert.deepEqual(
          [...s.hand.knownEvilIds].sort(),
          expected.map((e) => e.id).sort(),
        );
        assert.deepEqual(
          [...s.hand.seenAsMerlinIds].sort(),
          (p.role === "percival"
            ? rs
                .filter((e) => ["merlin", "morgana"].includes(e.role))
                .map((e) => e.id)
            : []
          ).sort(),
        );
      }
    }
});
test("secret tables are inaccessible, votes sealed until complete, duplicate submissions harmless", async () => {
  const r = await room();
  let s = await r.start();
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select * from avalon_private.players");
    }),
    /permission denied/,
  );
  await assert.rejects(
    r.act(
      r.ids.find((id) => id !== s.game.leader_id),
      "propose",
      { team: r.ids.slice(0, 2), turn: 0 },
    ),
    /turn/,
  );
  await assert.rejects(propose(r, [r.ids[0], r.ids[0]]), /different/);
  const p = await propose(r, r.ids.slice(0, 2));
  await r.act(r.ids[0], "vote", { proposal: p.id, card: "approve" });
  s = await r.get(r.ids[1]);
  assert.equal(s.proposals[0].votes[0].card, null);
  await r.act(r.ids[0], "vote", { proposal: p.id, card: "reject" });
  assert.equal((await r.get()).proposals[0].votes.length, 1);
  for (const id of r.ids.slice(1))
    await r.act(id, "vote", { proposal: p.id, card: "approve" });
  s = await r.get();
  assert.equal(s.game.phase, "quest");
  assert.ok(s.proposals[0].votes.every((v) => v.card === "approve"));
  await assert.rejects(
    r.act(r.ids[2], "card", { quest_id: s.quests[0].id, card: "success" }),
    /not on/,
  );
  for (const id of r.ids.slice(0, 2))
    await r.act(id, "card", { quest_id: s.quests[0].id, card: "success" });
  await r.act(r.ids[0], "card", { quest_id: s.quests[0].id, card: "success" });
  assert.equal((await r.get()).game.quest, 2);
});
test("ties reject, leadership rotates continuously, five consecutive rejections end the game", async () => {
  const r = await room(6);
  let s = await r.start();
  let prev = s.game.leader_id;
  for (let i = 0; i < 5; i++) {
    const p = await propose(r, r.ids.slice(0, 2));
    for (let j = 0; j < 6; j++)
      await r.act(r.ids[j], "vote", {
        proposal: p.id,
        card: j < 3 ? "approve" : "reject",
      });
    s = await r.get();
    assert.equal(s.game.rejections, i + 1);
    assert.equal(s.game.leader_id, r.ids[(r.ids.indexOf(prev) + 1) % 6]);
    prev = s.game.leader_id;
  }
  assert.equal(s.game.phase, "finished");
  assert.equal(s.game.winner, "evil");
});
test("good cannot sabotage, cards remain private, three failures win for evil", async () => {
  const r = await room();
  await r.start();
  const rs = await roles(r);
  const good = rs.find((p) =>
    ["merlin", "percival", "loyal_servant"].includes(p.role),
  );
  const p = await propose(
    r,
    [good.id, ...r.ids.filter((id) => id !== good.id)].slice(0, 2),
  );
  const q = await approve(r, p);
  await assert.rejects(
    r.act(good.id, "card", { quest_id: q.id, card: "fail" }),
    /Good players/,
  );
  for (const id of q.team)
    await r.act(id, "card", { quest_id: q.id, card: "success" });
  for (let i = 0; i < 3; i++) await quest(r, true);
  const s = await r.get();
  assert.equal(s.game.winner, "evil");
  assert.equal(s.game.reason, "Three quests failed.");
});
test("both assassination outcomes, role reveal, rematch and stale-round rejection", async () => {
  for (const hit of [true, false]) {
    const r = await room();
    await r.start();
    for (let i = 0; i < 3; i++) await quest(r);
    let s = await r.get();
    assert.equal(s.game.phase, "assassination");
    assert.ok(s.players.every((p) => p.role === null));
    const rs = await roles(r),
      assassin = rs.find((p) => p.role === "assassin"),
      merlin = rs.find((p) => p.role === "merlin"),
      other = rs.find((p) => p.role === "loyal_servant");
    await assert.rejects(
      r.act(merlin.id, "assassinate", { target: merlin.id }),
      /Only the Assassin/,
    );
    await r.act(assassin.id, "assassinate", {
      target: hit ? merlin.id : other.id,
    });
    s = await r.get();
    assert.equal(s.game.winner, hit ? "evil" : "good");
    assert.ok(s.players.every((p) => p.role));
    await assert.rejects(
      r.act(assassin.id, "assassinate", { target: merlin.id }),
      /Only the Assassin/,
    );
    await r.act(r.ids[0], "rematch");
    s = await r.get();
    assert.equal(s.game.phase, "lobby");
    assert.equal(s.hand.role, null);
    assert.equal(s.proposals.length, 0);
    await assert.rejects(r.act(r.ids[0], "ready", { ready: true }), /new game/);
  }
});
test("Lady of the Lake inspections stay private and previous holders cannot be selected", async () => {
  const r = await room(7, { lady: true });
  await r.start();
  await quest(r);
  await quest(r, true);
  let s = await r.get();
  assert.equal(s.game.phase, "lady");
  const holder = s.game.lady_id,
    target = r.ids.find((id) => id !== holder);
  await assert.rejects(
    r.act(holder, "inspect", { target: holder }),
    /Choose someone/,
  );
  await r.act(holder, "inspect", { target });
  assert.equal((await r.get(holder)).hand.inspections.length, 1);
  assert.equal((await r.get(target)).hand.inspections.length, 0);
  await quest(r);
  s = await r.get();
  assert.equal(s.game.lady_id, target);
  assert.equal(s.game.phase, "lady");
  await assert.rejects(
    r.act(target, "inspect", { target: holder }),
    /Choose someone/,
  );
});
test("targeting protects quest 5, quest 4 requires two fails with 7+ players", async () => {
  const r = await room(7, { targeting: true });
  await r.start();
  await assert.rejects(propose(r, r.ids.slice(0, 4), 5), /two successful/);
  const rs = await roles(r);
  const evil = rs.find((p) =>
    ["assassin", "morgana", "minion"].includes(p.role),
  );
  const team = [evil.id, ...r.ids.filter((id) => id !== evil.id)].slice(0, 4);
  const p = await propose(r, team, 4);
  const q = await approve(r, p);
  for (const id of team)
    await r.act(id, "card", {
      quest_id: q.id,
      card: id === evil.id ? "fail" : "success",
    });
  let s = await r.get();
  assert.equal(s.quests[0].result, "success");
  assert.equal(s.quests[0].fails, 1);
  await quest(r, false, 1);
  await quest(r, false, 5);
  s = await r.get();
  assert.equal(s.game.phase, "assassination");
});
test("host recovery, chat escaping data, kick, transfer, leave and abort", async () => {
  const r = await room();
  await r.act(r.ids[0], "chat", { body: "<script>hello</script>" });
  assert.equal((await r.get()).messages[0].body, "<script>hello</script>");
  await assert.rejects(r.act(r.ids[0], "chat", { body: "again" }), /wait/);
  await assert.rejects(r.act(r.ids[1], "claim_host"), /still connected/);
  await db.query(
    "update avalon_private.players set last_seen=now()-interval '2 minutes' where id=$1",
    [r.ids[0]],
  );
  await r.act(r.ids[1], "claim_host");
  assert.equal(
    (await r.get()).players.find((p) => p.id === r.ids[1]).host,
    true,
  );
  await r.act(r.ids[1], "transfer_host", { target: r.ids[0] });
  await r.start();
  await assert.rejects(r.act(r.ids[0], "leave"), /Finish or abandon/);
  await r.act(r.ids[0], "abort");
  const s = await r.get();
  assert.equal(s.game.phase, "lobby");
  await rpc(r.secrets[0], "avalon_action", [
    r.code,
    s.game.round_id,
    "kick",
    { target: r.ids[1] },
  ]);
  await assert.rejects(r.get(r.ids[1]), /not in this room/);
});
test("both SQL filenames stay identical and snapshots never expose other quest cards", async () => {
  assert.equal(
    await readFile("avalon_scheme.sql", "utf8"),
    await readFile("avalon_schema.sql", "utf8"),
  );
  const r = await room();
  await r.start();
  const p = await propose(r, r.ids.slice(0, 2));
  const q = await approve(r, p);
  await r.act(r.ids[0], "card", { quest_id: q.id, card: "success" });
  const own = await r.get();
  assert.equal(own.quests[0].my_card, "success");
  const other = await r.get(r.ids[1]);
  assert.equal(other.quests[0].my_card, null);
  assert.equal(other.quests[0].fails, null);
  assert.equal(other.quests[0].submitted, 1);
});
test("all quest team sizes and fourth-quest thresholds are correct at every player count", async () => {
  const expected = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
  };
  for (let n = 5; n <= 10; n++) {
    for (let q = 1; q <= 5; q++)
      assert.equal(
        (await db.query("select avalon_private.team_size($1,$2) n", [n, q]))
          .rows[0].n,
        expected[n][q - 1],
      );
    const r = await room(n, { targeting: true });
    await r.start();
    const rs = await roles(r);
    const evil = rs.filter((p) =>
      ["assassin", "morgana", "mordred", "oberon", "minion"].includes(p.role),
    );
    const good = rs.filter((p) => !evil.some((e) => e.id === p.id));
    const team = [evil[0].id, ...good.map((p) => p.id)].slice(
      0,
      expected[n][3],
    );
    const p = await propose(r, team, 4);
    const q = await approve(r, p);
    for (const id of team)
      await r.act(id, "card", {
        quest_id: q.id,
        card: id === evil[0].id ? "fail" : "success",
      });
    assert.equal((await r.get()).quests[0].result, n >= 7 ? "success" : "fail");
  }
});
test("cross-room mutation, tampered phase/turn, null payloads and legacy RPCs are rejected", async () => {
  const r = await room();
  const r2 = await room();
  await r.start();
  await r2.start();
  const s = await r.get();
  await assert.rejects(
    r.act(s.game.leader_id, "propose", { team: r2.ids.slice(0, 2), turn: 0 }),
    /different/,
  );
  await assert.rejects(
    r.act(s.game.leader_id, "propose", { team: r.ids.slice(0, 2), turn: 100 }),
    /turn/,
  );
  await assert.rejects(
    r.act(s.game.leader_id, "propose", { team: null, turn: 0 }),
    /scalar/,
  );
  await assert.rejects(
    r.act(r.ids[0], "assassinate", { target: r.ids[1] }),
    /Only the Assassin/,
  );
  const p2 = await propose(r2, r2.ids.slice(0, 2));
  await assert.rejects(
    r.act(r.ids[0], "vote", { proposal: p2.id, card: "approve" }),
    /not found/,
  );
  const legacy = (
    await db.query(
      "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('get_my_hand','create_game','resolve_assassination')",
    )
  ).rows;
  assert.equal(legacy.length, 0);
});
