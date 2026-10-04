import { test, expect, type BrowserContext } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { Snapshot } from "../../src/lib/avalon/types";

test("five isolated browsers complete a game, reconnect, refresh and rematch", async ({
  browser,
}) => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated");
  await db.exec(await readFile("avalon_scheme.sql", "utf8"));
  const contexts: BrowserContext[] = [];
  const browserErrors: string[] = [];
  const rpcNames: Record<string, string[]> = {
    avalon_create: ["p_name"],
    avalon_join: ["p_code", "p_name"],
    avalon_state: ["p_code"],
    avalon_action: ["p_code", "p_round", "p_action", "p_payload"],
  };
  let offline = "";
  const rpc = async (secret: string, name: string, args: unknown[]) =>
    db.transaction(async (tx) => {
      await tx.query("select set_config('request.headers',$1,true)", [
        JSON.stringify({ "x-session-id": secret }),
      ]);
      await tx.exec("set local role anon");
      return (
        await tx.query(
          `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
          args,
        )
      ).rows[0] as { value: unknown };
    });
  try {
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext(
        i === 4 ? { viewport: { width: 390, height: 844 } } : {},
      );
      contexts.push(context);
      await context.route("**/rest/v1/rpc/*", async (route) => {
        const request = route.request();
        const secret = request.headers()["x-session-id"];
        if (secret === offline) return route.abort("internetdisconnected");
        const name = new URL(request.url()).pathname.split("/").at(-1)!;
        if (!rpcNames[name])
          return route.fulfill({ status: 404, body: "Unknown RPC" });
        const payload = request.postDataJSON();
        try {
          const { value } = await rpc(
            secret,
            name,
            rpcNames[name].map((k) => payload[k]),
          );
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(value),
          });
        } catch (e) {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              message: (e as Error).message,
              code: "P0001",
            }),
          });
        }
      });
    }
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    pages.forEach((p) =>
      p.on("pageerror", (e) => browserErrors.push(e.message)),
    );
    await pages[0].goto("/");
    await pages[0].getByLabel("Display name").fill("Knight 1");
    await pages[0]
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    await expect(
      pages[0].getByRole("heading", { name: "Prepare the game" }),
    ).toBeVisible();
    const code = new URL(pages[0].url()).pathname.split("/")[1];
    for (let i = 1; i < 5; i++) {
      await pages[i].goto(`/?room=${code}`);
      await pages[i].getByLabel("Display name").fill(`Knight ${i + 1}`);
      await expect(pages[i].getByLabel("Room code")).toHaveValue(code);
      await pages[i]
        .getByRole("button", { name: "Join room", exact: true })
        .click();
      await expect(
        pages[i].getByRole("heading", { name: "Prepare the game" }),
      ).toBeVisible();
    }
    const secrets = await Promise.all(
      pages.map((p) =>
        p.evaluate(() => localStorage.getItem("avalon_identity_v2")!),
      ),
    );
    const state = async (i = 0) =>
      (await rpc(secrets[i], "avalon_state", [code])).value as Snapshot;
    const s0 = await state();
    const ids = s0.players.map((p) => p.id);
    const pageFor = (id: string) => pages[ids.indexOf(id)];
    await pages[4]
      .getByLabel("Message", { exact: true })
      .fill("Ready for a quest!");
    await pages[4].getByRole("button", { name: "Send", exact: true }).click();
    await expect(pages[0].getByRole("log")).toContainText("Ready for a quest!");
    for (const p of pages)
      await p.getByRole("button", { name: "I’m ready", exact: true }).click();
    await expect(
      pages[0].getByRole("button", { name: "Start game", exact: true }),
    ).toBeEnabled({ timeout: 10000 });
    await pages[0]
      .getByRole("button", { name: "Start game", exact: true })
      .click();
    await expect(
      pages[0].getByText("Reveal my role and knowledge", { exact: true }),
    ).toBeVisible();
    for (let round = 1; round <= 3; round++) {
      const s = await state();
      const leader = pageFor(s.game.leader_id!);
      const size = round === 2 ? 3 : 2;
      const names = s.players.slice(0, size).map((p) => p.name);
      for (const name of names)
        await leader.getByRole("checkbox", { name, exact: true }).check();
      await leader
        .getByRole("button", { name: `Propose ${size}/${size} players` })
        .click();
      for (const p of pages)
        await p.getByRole("button", { name: "Approve", exact: true }).click();
      const teamPages = pages.slice(0, size);
      await teamPages[0]
        .getByRole("button", { name: "Play Success", exact: true })
        .click();
      if (round === 1) {
        await teamPages[0].reload();
        await expect(
          teamPages[0].getByText(
            "Your card is submitted. Waiting for the team.",
            { exact: true },
          ),
        ).toBeVisible();
        offline = secrets[4];
        await expect(pages[4].getByRole("status").first()).toContainText(
          "Connection lost",
          { timeout: 10000 },
        );
        offline = "";
        await expect(pages[4].getByRole("status").first()).toContainText(
          "Connected",
          { timeout: 10000 },
        );
      }
      for (const p of teamPages.slice(1))
        await p
          .getByRole("button", { name: "Play Success", exact: true })
          .click();
      await expect
        .poll(async () => (await state()).game.phase)
        .toBe(round === 3 ? "assassination" : "team");
    }
    const hands = await Promise.all(secrets.map((_, i) => state(i)));
    const assassinIndex = hands.findIndex((s) => s.hand.role === "assassin");
    const survivorIndex = hands.findIndex(
      (s) => s.hand.role === "loyal_servant",
    );
    const assassin = pages[assassinIndex];
    await assassin
      .getByLabel("Choose a player", { exact: true })
      .selectOption(ids[survivorIndex]);
    assassin.once("dialog", (d) => d.accept());
    await assassin
      .getByRole("button", { name: "Make final guess", exact: true })
      .click();
    for (const p of pages)
      await expect(
        p.getByRole("heading", { name: "The Light Prevails" }),
      ).toBeVisible();
    await pages[4].screenshot({
      path: "test-results/avalon-mobile-finished.png",
      fullPage: true,
    });
    await pages[0]
      .getByRole("button", { name: "Play again with this group" })
      .click();
    for (const p of pages)
      await expect(
        p.getByRole("heading", { name: "Prepare the game" }),
      ).toBeVisible();
    await expect(
      pages[0].getByText("0/5 players ready.", { exact: false }),
    ).toBeVisible();
    {
      const s = await state();
      expect(s.players.every((p) => p.role === null)).toBeTruthy();
      expect(s.hand.role).toBeNull();
      expect(JSON.stringify(s)).not.toContain(secrets[1]);
    }
    expect(browserErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await db.close();
  }
});
