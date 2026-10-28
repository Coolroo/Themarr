// The admin data, shared by every page: one snapshot read at one store
// version, the writes, and the notice line that reports them. After every
// write the snapshot is read again, so the next If-Match always matches what
// the page shows. A 412 or 404 reloads the data and says so.

import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Api, ApiError, loadSnapshot, Reloading, type App, type Assignments, type LastCheck, type Policy, type Snapshot } from "./api.ts";
import type { Theme } from "@themarr/tokens";
import { toggleFavourite } from "./logic/picker.ts";
import { policyPath, type Scope } from "./logic/people.ts";
import { withAppAssignment } from "./logic/themes.ts";

export interface Notice {
  id: number;
  kind: "ok" | "error";
  text: string;
}

export interface Data {
  snap: Snapshot | null;
  /** A failure that leaves nothing to show (the first load failed). */
  fatal: string | null;
  notice: Notice | null;
  dismiss(): void;
  refresh(): Promise<void>;
  /** Each returns true when themarr took the change. */
  saveTheme(theme: Theme): Promise<Theme | null>;
  deleteTheme(id: string): Promise<boolean>;
  setGlobal(id: string | null): Promise<boolean>;
  setAppTheme(appId: string, value: string): Promise<boolean>;
  toggleFavourite(id: string): Promise<boolean>;
  putApp(app: App): Promise<boolean>;
  deleteApp(id: string): Promise<boolean>;
  putPolicy(scope: Scope, name: string, policy: Policy): Promise<boolean>;
  deletePolicy(scope: Scope, name: string): Promise<boolean>;
  lastCheck(appId: string): Promise<LastCheck | null>;
}

const DataContext = createContext<Data | null>(null);

export function useData(): Data {
  const d = useContext(DataContext);
  if (d === null) throw new Error("useData outside DataProvider");
  return d;
}

/** The snapshot, for pages shown only once it is loaded. */
export function useSnap(): Snapshot {
  const s = useData().snap;
  if (s === null) throw new Error("useSnap before the data loaded");
  return s;
}

function message(e: unknown): string {
  if (e instanceof ApiError) return e.requestId === "" ? e.message : `${e.message} (request ${e.requestId})`;
  return e instanceof Error ? e.message : String(e);
}

export function DataProvider(props: { api: Api; onChanged?: () => void; children: ComponentChildren }) {
  const { api, onChanged } = props;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const seq = useRef(0);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;

  const say = useCallback((kind: Notice["kind"], text: string) => setNotice({ id: ++seq.current, kind, text }), []);

  const refresh = useCallback(async () => {
    try {
      setSnap(await loadSnapshot(api));
      setFatal(null);
    } catch (e) {
      if (e instanceof Reloading) return;
      if (snapRef.current === null) setFatal(message(e));
      else say("error", message(e));
    }
  }, [api, say]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Run a write; on success read everything again and tell the SDK. */
  const write = useCallback(
    async <T,>(fn: () => Promise<T>, ok: string | null): Promise<{ ok: true; value: T } | { ok: false }> => {
      try {
        const value = await fn();
        await refresh();
        if (ok !== null) say("ok", ok);
        onChanged?.();
        return { ok: true, value };
      } catch (e) {
        if (e instanceof Reloading) return { ok: false };
        if (e instanceof ApiError && (e.status === 412 || e.status === 404)) await refresh();
        say("error", message(e));
        return { ok: false };
      }
    },
    [refresh, say, onChanged],
  );

  const data = useMemo<Data>(() => {
    const assignments = (): Assignments => snapRef.current?.assignments ?? { global: null, perApp: {} };
    return {
      snap,
      fatal,
      notice,
      dismiss: () => setNotice(null),
      refresh,
      async saveTheme(theme) {
        const r = await write(() => api.put<Theme>(`/v1/themes/${theme.id}`, theme), "Saved. Apps pick it up on their next load.");
        return r.ok ? r.value : null;
      },
      async deleteTheme(id) {
        return (await write(() => api.delete(`/v1/themes/${id}`), "Theme deleted.")).ok;
      },
      async setGlobal(id) {
        const a = assignments();
        return (await write(() => api.put("/v1/assignments", { global: id, perApp: a.perApp }), "Global default saved.")).ok;
      },
      async setAppTheme(appId, value) {
        return (await write(() => api.put("/v1/assignments", withAppAssignment(assignments(), appId, value)), `Saved the theme for ${appId}.`)).ok;
      },
      async toggleFavourite(id) {
        const favourites = toggleFavourite(snapRef.current?.favourites ?? [], id);
        return (await write(() => api.put("/v1/favourites", { favourites }), null)).ok;
      },
      async putApp(app) {
        return (await write(() => api.put(`/v1/apps/${app.id}`, app), `Saved the app ${app.id}.`)).ok;
      },
      async deleteApp(id) {
        return (await write(() => api.delete(`/v1/apps/${id}`), `Removed the app ${id}.`)).ok;
      },
      async putPolicy(scope, name, policy) {
        return (await write(() => api.put(policyPath(scope, name), policy), `Saved the policy for ${name}.`)).ok;
      },
      async deletePolicy(scope, name) {
        return (await write(() => api.delete(policyPath(scope, name)), `Removed the policy for ${name}.`)).ok;
      },
      async lastCheck(appId) {
        try {
          const r = await api.get<{ lastCheck: LastCheck | null }>(`/v1/apps/${appId}/last-check`);
          return r.lastCheck;
        } catch {
          return null;
        }
      },
    };
  }, [snap, fatal, notice, refresh, write, api]);

  return <DataContext.Provider value={data}>{props.children}</DataContext.Provider>;
}
