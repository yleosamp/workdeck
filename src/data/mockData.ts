import type { Friend, HeatmapDay, Message, TrackedApp } from "../types";

const now = new Date();

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

function seededValue(index: number) {
  const wave = Math.sin(index * 1.87) + Math.cos(index * 0.41);
  if (index % 7 === 0 || index % 13 === 0) return 0;
  return Math.max(0, Math.round((wave + 1.5) * 5_400));
}

export const mockHeatmap: HeatmapDay[] = Array.from({ length: 364 }, (_, index) => {
  const day = new Date(now);
  day.setDate(now.getDate() - (363 - index));
  const recency = index > 320 ? 1.45 : index > 240 ? 1.15 : 0.82;
  return { date: dateKey(day), seconds: Math.round(seededValue(index) * recency) };
});

export const mockApps: TrackedApp[] = [
  {
    id: "after-effects",
    name: "After Effects",
    shortName: "Ae",
    category: "Motion design",
    color: "#9999ff",
    glow: "rgba(153,153,255,.3)",
    totalSeconds: 814 * 3600 + 24 * 60,
    todaySeconds: 2 * 3600 + 18 * 60,
    lastOpened: "Active now",
    status: "running"
  },
  {
    id: "premiere-pro",
    name: "Premiere Pro",
    shortName: "Pr",
    category: "Video editing",
    color: "#9999ff",
    glow: "rgba(105,85,255,.28)",
    totalSeconds: 632 * 3600 + 42 * 60,
    todaySeconds: 46 * 60,
    lastOpened: "Today, 11:42 AM",
    status: "idle"
  },
  {
    id: "blender",
    name: "Blender",
    shortName: "B",
    category: "3D creation",
    color: "#f5792a",
    glow: "rgba(245,121,42,.28)",
    totalSeconds: 428 * 3600 + 7 * 60,
    todaySeconds: 0,
    lastOpened: "Yesterday",
    status: "idle"
  },
  {
    id: "photoshop",
    name: "Photoshop",
    shortName: "Ps",
    category: "Image editing",
    color: "#31a8ff",
    glow: "rgba(49,168,255,.28)",
    totalSeconds: 295 * 3600 + 13 * 60,
    todaySeconds: 31 * 60,
    lastOpened: "Today, 9:06 AM",
    status: "idle"
  },
  {
    id: "figma",
    name: "Figma",
    shortName: "F",
    category: "Interface design",
    color: "#a259ff",
    glow: "rgba(162,89,255,.3)",
    totalSeconds: 186 * 3600 + 51 * 60,
    todaySeconds: 0,
    lastOpened: "Monday",
    status: "idle"
  }
];

export const friends: Friend[] = [
  {
    id: "maya",
    name: "Maya Chen",
    handle: "@mayamakes",
    avatar: "MC",
    avatarColor: "#f2977a",
    status: "online",
    currentApp: "Blender",
    currentAppColor: "#f5792a",
    currentActivity: "Modeling · 1h 22m",
    mutualFriends: 8
  },
  {
    id: "leo",
    name: "Leo Martins",
    handle: "@leocuts",
    avatar: "LM",
    avatarColor: "#79a7ff",
    status: "online",
    currentApp: "Premiere Pro",
    currentAppColor: "#9999ff",
    currentActivity: "Editing · 38m",
    mutualFriends: 12
  },
  {
    id: "ana",
    name: "Ana Souza",
    handle: "@anatype",
    avatar: "AS",
    avatarColor: "#c786f4",
    status: "away",
    currentApp: "Figma",
    currentAppColor: "#a259ff",
    currentActivity: "Away · 6m",
    mutualFriends: 4
  },
  {
    id: "noah",
    name: "Noah Williams",
    handle: "@nwframes",
    avatar: "NW",
    avatarColor: "#71cfa3",
    status: "offline",
    lastSeen: "3 hours ago",
    mutualFriends: 6
  },
  {
    id: "sofia",
    name: "Sofia Reed",
    handle: "@sofiacolor",
    avatar: "SR",
    avatarColor: "#e5b660",
    status: "offline",
    lastSeen: "Yesterday",
    mutualFriends: 3
  }
];

export const initialMessages: Record<string, Message[]> = {
  maya: [
    { id: "m1", authorId: "maya", text: "Hey! The lighting pass is finally starting to work.", sentAt: "10:31" },
    { id: "m2", authorId: "me", text: "Nice. Send me the scene when you have a second?", sentAt: "10:33" },
    {
      id: "m3",
      authorId: "maya",
      sentAt: "10:34",
      file: {
        name: "studio-lighting-v07.blend",
        size: 284_164_096,
        mime: "application/x-blender",
        progress: 100,
        state: "complete",
        direction: "incoming"
      }
    },
    { id: "m4", authorId: "maya", text: "Straight from my machine to yours ✦", sentAt: "10:34" }
  ],
  leo: [
    { id: "l1", authorId: "leo", text: "That transition pack was perfect. Thanks!", sentAt: "Yesterday" }
  ],
  ana: [{ id: "a1", authorId: "ana", text: "Want to review the new dashboard tomorrow?", sentAt: "Monday" }]
};
