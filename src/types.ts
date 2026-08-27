export type View = "home" | "library" | "activity" | "leaderboard" | "studios" | "chat" | "friend-profile" | "profile" | "settings";

export type AppStatus = "running" | "idle";

export interface TrackedApp {
  id: string;
  name: string;
  shortName: string;
  category: string;
  color: string;
  glow: string;
  totalSeconds: number;
  todaySeconds: number;
  lastOpened: string;
  status: AppStatus;
  processNames?: string[];
}

export interface HeatmapDay {
  date: string;
  seconds: number;
}

export interface AppActivityDay extends HeatmapDay {
  appId: string;
}

export interface Friend {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  avatarColor: string;
  avatarUrl?: string | null;
  status: "online" | "away" | "offline";
  currentApp?: string;
  currentAppColor?: string;
  currentActivity?: string;
  lastSeen?: string;
  mutualFriends?: number;
  isFriend?: boolean;
}

export interface Message {
  id: string;
  authorId: string;
  text?: string;
  sentAt: string;
  file?: TransferFile;
}

export interface TransferFile {
  transferId?: string;
  name: string;
  size: number;
  mime: string;
  progress: number;
  state: "offered" | "transferring" | "complete" | "failed";
  direction: "incoming" | "outgoing";
  previewKind?: "audio" | "image";
  previewUrl?: string;
  receivedBlob?: Blob;
  saved?: boolean;
  savedPath?: string;
}

export interface ActivitySnapshot {
  apps: TrackedApp[];
  heatmap: HeatmapDay[];
  appDaily: AppActivityDay[];
  trackedAt: string;
  isAway: boolean;
}
