"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createSupabaseClient } from "@/lib/supabase";
import type { Snapshot } from "@/lib/avalon/types";

const ID_KEY = "avalon_identity_v2";
const ID_EVENT = "avalon-identity";
function identity() {
  // Storage access stays in a browser effect; cached snapshots are pure.
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}
function subscribe(callback: () => void) {
  window.addEventListener(ID_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(ID_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
function snapshotIdentity() {
  try {
    return localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}
function serverIdentity() {
  return null;
}
function message(error: unknown) {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Unable to reach the game. Please try again.";
}

export function useGameState(code?: string) {
  const sessionId = useSyncExternalStore(
    subscribe,
    snapshotIdentity,
    serverIdentity,
  );
  const [loaded, setLoaded] = useState<{
    identity: string;
    code: string;
    snapshot: Snapshot;
  } | null>(null);
  const data =
    loaded?.identity === sessionId && loaded?.code === code
      ? loaded.snapshot
      : null;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "online" | "offline"
  >("connecting");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const request = useRef(0);
  const applied = useRef(0);
  const { client, initError } = useMemo(() => {
    try {
      return {
        client: sessionId ? createSupabaseClient(sessionId) : null,
        initError: null,
      };
    } catch (e) {
      return { client: null, initError: message(e) };
    }
  }, [sessionId]);

  useEffect(() => {
    try {
      identity();
      window.dispatchEvent(new Event(ID_EVENT));
    } catch {
      setTimeout(
        () =>
          setError(
            "Enable browser storage and use HTTPS to keep your player identity.",
          ),
        0,
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !code) return;
    const epoch = generation.current;
    const seq = ++request.current;
    try {
      const result = await client.rpc("avalon_state", { p_code: code });
      if (epoch !== generation.current || seq < applied.current) return;
      applied.current = seq;
      if (result.error) {
        if (result.error.code === "P0001") setLoaded(null);
        throw result.error;
      }
      setLoaded({
        identity: sessionId!,
        code,
        snapshot: result.data as Snapshot,
      });
      setConnection("online");
      setLoadError(null);
    } catch (e) {
      if (epoch === generation.current) {
        setConnection("offline");
        setLoadError(message(e));
      }
    }
  }, [client, code, sessionId]);

  useEffect(() => {
    generation.current += 1;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(poll, document.hidden ? 10000 : 2000);
    };
    const initial = setTimeout(poll, 0);
    const wake = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelled = true;
      generation.current += 1;
      clearTimeout(initial);
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh]);

  const run = useCallback(
    async (rpc: string, args: Record<string, unknown>) => {
      if (busy.current || !client) return { ok: false, value: null };
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await client.rpc(rpc, args);
        if (result.error) throw result.error;
        await refresh();
        return { ok: true, value: result.data };
      } catch (e) {
        setError(message(e));
        await refresh();
        return { ok: false, value: null };
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [client, refresh],
  );

  const action = async (
    name: string,
    payload: Record<string, unknown> = {},
  ) => {
    if (!data || !code) return false;
    const result = await run("avalon_action", {
      p_code: code,
      p_round: data.game.round_id,
      p_action: name,
      p_payload: payload,
    });
    return result.ok;
  };
  const createGame = async ({ name }: { name: string }) => {
    const result = await run("avalon_create", { p_name: name.trim() });
    if (result.ok)
      localStorage.setItem("avalon_last_room", String(result.value));
    return result.ok ? String(result.value) : null;
  };
  const joinGame = async ({
    roomCode,
    name,
  }: {
    roomCode: string;
    name: string;
  }) => {
    const result = await run("avalon_join", {
      p_code: roomCode.trim().toUpperCase(),
      p_name: name.trim(),
    });
    if (result.ok)
      localStorage.setItem("avalon_last_room", String(result.value));
    return result.ok ? String(result.value) : null;
  };
  const recover = (key: string) => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key.trim(),
      )
    ) {
      setError("Enter a valid recovery key.");
      return false;
    }
    localStorage.setItem(ID_KEY, key.trim());
    window.dispatchEvent(new Event(ID_EVENT));
    return true;
  };
  return {
    data,
    sessionId,
    connection,
    error: error ?? initError ?? loadError,
    isLoading: pending || !client,
    action,
    createGame,
    joinGame,
    recover,
    refresh,
  };
}
