import { invoke } from "@tauri-apps/api/core";
import { mockApps, mockHeatmap } from "../data/mockData";
import type { ActivitySnapshot, TrackedApp } from "../types";

type NativeApp = {
  id: string;
  name: string;
  category: string;
  color: string;
  process_names: string[];
  total_seconds: number;
  today_seconds: number;
  last_opened: string | null;
  is_running: boolean;
};

type NativeSnapshot = {
  apps: NativeApp[];
  heatmap: { date: string; seconds: number }[];
  app_daily: { date: string; app_id: string; seconds: number }[];
  tracked_at: string;
  is_away: boolean;
};

const metadata: Record<string, Pick<TrackedApp, "shortName" | "glow">> = {
  "after-effects": { shortName: "Ae", glow: "rgba(153,153,255,.3)" },
  "premiere-pro": { shortName: "Pr", glow: "rgba(105,85,255,.28)" },
  blender: { shortName: "B", glow: "rgba(245,121,42,.28)" },
  photoshop: { shortName: "Ps", glow: "rgba(49,168,255,.28)" },
  figma: { shortName: "F", glow: "rgba(162,89,255,.3)" }
};

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

const customAppKey = "workdeck.custom-apps";

function browserCustomApps(): TrackedApp[] {
  try {
    return JSON.parse(localStorage.getItem(customAppKey) ?? "[]") as TrackedApp[];
  } catch {
    return [];
  }
}

function normalize(native: NativeSnapshot): ActivitySnapshot {
  return {
    trackedAt: native.tracked_at,
    isAway: native.is_away,
    heatmap: native.heatmap,
    appDaily: native.app_daily.map((day) => ({ date: day.date, appId: day.app_id, seconds: day.seconds })),
    apps: native.apps.map((app) => ({
      id: app.id,
      name: app.name,
      category: app.category,
      color: app.color,
      shortName: metadata[app.id]?.shortName ?? app.name.slice(0, 2),
      glow: metadata[app.id]?.glow ?? `${app.color}44`,
      totalSeconds: app.total_seconds,
      todaySeconds: app.today_seconds,
      lastOpened: app.is_running ? "Active now" : app.last_opened ?? "Never opened",
      status: app.is_running ? "running" : "idle",
      processNames: app.process_names
    }))
  };
}

export async function getActivitySnapshot(): Promise<ActivitySnapshot> {
  if (!isTauri()) {
    const apps = [...mockApps, ...browserCustomApps()];
    const weightTotal = Math.max(1, apps.reduce((sum, app) => sum + app.totalSeconds, 0));
    return {
      apps,
      heatmap: mockHeatmap,
      appDaily: mockHeatmap.flatMap((day) => apps.map((app) => ({
        date: day.date,
        appId: app.id,
        seconds: Math.round(day.seconds * (app.totalSeconds / weightTotal))
      }))),
      trackedAt: new Date().toISOString(),
      isAway: false
    };
  }
  return normalize(await invoke<NativeSnapshot>("sync_activity"));
}

export async function addTrackedApp(name: string, processName: string, color: string) {
  if (!isTauri()) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const custom: TrackedApp = {
      id,
      name,
      shortName: name.slice(0, 2),
      category: "Custom software",
      color,
      glow: `${color}44`,
      totalSeconds: 0,
      todaySeconds: 0,
      lastOpened: "Not opened yet",
      status: "idle",
      processNames: [processName]
    };
    const existing = browserCustomApps().filter((app) => app.id !== id);
    localStorage.setItem(customAppKey, JSON.stringify([...existing, custom]));
    return;
  }
  await invoke("add_tracked_app", { name, processNames: [processName], color });
}
