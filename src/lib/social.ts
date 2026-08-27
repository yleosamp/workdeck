import type { ActivitySnapshot } from "../types";

export type SocialUser = {
  id: string;
  email?: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarColor: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  profileVisibility: "public" | "friends" | "private";
  presenceVisibility: "public" | "friends" | "private";
  createdAt: string;
};

export type ApiFriend = SocialUser & {
  status: "online" | "away" | "offline";
  currentAppId: string | null;
  currentAppName: string | null;
  sessionStartedAt: string | null;
  lastSeenAt: string | null;
  unreadCount: number;
};

export type ApiFriendRequest = { id: string; createdAt: string; user: SocialUser };

export type ApiProfile = {
  profile: SocialUser;
  friendCount: number;
  totals: Array<{ appId: string; appName: string; totalSeconds: number; lastOpenedAt: string | null }>;
  daily: Array<{ date: string; seconds: number }>;
  presence: { status: "online" | "away" | "offline"; currentAppId: string | null; currentAppName: string | null; sessionStartedAt: string | null; updatedAt: string } | null;
  isFriend: boolean;
};

export type ApiMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  text: string | null;
  type: "text" | "file";
  file: { name: string; size: number; mime: string; transferId: string } | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
};

export type LeaderboardPeriod = "day" | "week" | "month" | "year";

export type ApiLeaderboard = {
  period: LeaderboardPeriod;
  startDate: string;
  endDate: string;
  updatedAt: string;
  entries: Array<{
    id: string;
    handle: string;
    displayName: string;
    avatarColor: string;
    avatarUrl: string | null;
    seconds: number;
    rank: number;
    isCurrentUser: boolean;
  }>;
};

export type CommunityChannel = {
  id: string;
  communityId: string;
  name: string;
  kind: "text" | "voice";
  position: number;
  createdAt: string;
};

export type VoiceParticipant = SocialUser & {
  userId: string;
  channelId: string;
  muted: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  joinedAt: string;
  status: "online" | "away" | "offline";
  currentAppId: string | null;
  currentAppName: string | null;
};

export type CommunityMember = SocialUser & {
  role: "owner" | "member";
  joinedAt: string;
  status: "online" | "away" | "offline";
  currentAppId: string | null;
  currentAppName: string | null;
  sessionStartedAt: string | null;
  voice: Omit<VoiceParticipant, keyof SocialUser | "status" | "currentAppId" | "currentAppName"> | null;
};

export type ApiCommunity = {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  iconColor: string;
  role: "owner" | "member";
  createdAt: string;
  channels: CommunityChannel[];
  members: CommunityMember[];
};

export type CommunityInvite = {
  id: string;
  code: string;
  communityId: string;
  communityName: string;
  description: string;
  iconColor: string;
  creatorName: string;
  memberCount: number;
  targetUserId: string | null;
  createdAt: string;
  valid: boolean;
};

export type CommunityMessage = {
  id: string;
  channelId: string;
  senderId: string;
  body: string;
  createdAt: string;
  author: SocialUser;
};

export type RealtimeEvent =
  | { type: "realtime.ready"; userId: string }
  | { type: "presence.updated"; userId: string; presence: { status: "online" | "away" | "offline"; currentAppId: string | null; currentAppName: string | null; sessionStartedAt: string | null; updatedAt: string } }
  | { type: "friend.requested"; request: ApiFriendRequest }
  | { type: "friend.accepted"; user: SocialUser }
  | { type: "friend.removed"; userId: string }
  | { type: "message.created"; message: ApiMessage }
  | { type: "message.read"; messageId: string; readerId: string; readAt: string }
  | { type: "chat.typing"; userId: string; isTyping: boolean }
  | { type: "webrtc.ready"; userId: string; transferId: string }
  | { type: "webrtc.signal"; userId: string; transferId: string; signal: unknown }
  | { type: "community.updated"; communityId: string }
  | { type: "community.invited"; invite: CommunityInvite }
  | { type: "community.message"; communityId: string; message: CommunityMessage }
  | { type: "voice.snapshot"; channelId: string; participants: VoiceParticipant[] }
  | { type: "voice.participant"; action: "joined" | "updated"; participant: VoiceParticipant }
  | { type: "voice.participant"; action: "left"; participant: { userId: string; channelId: string } }
  | { type: "voice.signal"; channelId: string; userId: string; signal: unknown }
  | { type: "voice.media"; channelId: string; userId: string; streamId: string; mediaKind: "microphone" | "camera" | "screen"; active: boolean }
  | { type: "realtime.error"; error: string };

type SessionResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: SocialUser };

const tokenKey = "workdeck.access-token";
const refreshKey = "workdeck.refresh-token";
const apiKey = "workdeck.api-url";
const productionMigrationKey = "workdeck.production-api-v1";
const productionApiUrl = "http://144.22.135.127:8787";
const isDevelopmentClient = window.location.hostname === "localhost" && window.location.port === "1420";

function isLoopbackApi(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

class SocialClient {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private listeners = new Set<(event: RealtimeEvent) => void>();
  private manuallyClosed = false;
  private ignoreRememberedSession = false;

  get apiUrl() {
    let remembered = localStorage.getItem(apiKey);
    // Packaged builds must never silently fall back to a developer's local API.
    // Keep localhost available only when running the Vite development server.
    if (!isDevelopmentClient && (!remembered || isLoopbackApi(remembered))) {
      remembered = productionApiUrl;
      localStorage.setItem(apiKey, remembered);
    } else if (!localStorage.getItem(productionMigrationKey)) {
      localStorage.setItem(productionMigrationKey, "done");
      if (!remembered) {
        remembered = productionApiUrl;
        localStorage.setItem(apiKey, remembered);
      }
    }
    return (remembered || productionApiUrl).replace(/\/$/, "");
  }

  setApiUrl(url: string) {
    const normalized = url.trim().replace(/\/$/, "");
    localStorage.setItem(apiKey, !isDevelopmentClient && isLoopbackApi(normalized) ? productionApiUrl : normalized);
  }

  hasSession() { return Boolean(this.sessionValue(refreshKey)); }

  async register(input: { email: string; handle: string; displayName: string; password: string }) {
    const session = await this.publicRequest<SessionResponse>("/auth/register", { method: "POST", body: JSON.stringify(input) });
    this.saveSession(session);
    return session.user;
  }

  async login(email: string, password: string) {
    const session = await this.publicRequest<SessionResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    this.saveSession(session);
    return session.user;
  }

  async logout() {
    const refreshToken = this.sessionValue(refreshKey);
    if (refreshToken) await this.publicRequest("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(refreshKey);
    if (localStorage.getItem(refreshKey) === refreshToken) {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(refreshKey);
    }
    this.closeRealtime();
  }

  switchAccount() {
    this.ignoreRememberedSession = true;
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(refreshKey);
    this.closeRealtime();
  }

  async me() { return (await this.request<{ user: SocialUser }>("/me")).user; }
  async updateMe(input: Partial<Pick<SocialUser, "displayName" | "bio" | "avatarColor" | "avatarUrl" | "bannerUrl" | "profileVisibility" | "presenceVisibility">>) {
    return (await this.request<{ user: SocialUser }>("/me", { method: "PATCH", body: JSON.stringify(input) })).user;
  }
  async friends() { return (await this.request<{ friends: ApiFriend[] }>("/friends")).friends; }
  async requests() { return this.request<{ incoming: ApiFriendRequest[]; outgoing: ApiFriendRequest[] }>("/friends/requests"); }
  async searchUsers(query: string) { return (await this.request<{ users: Array<SocialUser & { isFriend: boolean }> }>(`/users/search?q=${encodeURIComponent(query)}`)).users; }
  async profile(handle: string) { return this.request<ApiProfile>(`/profiles/${encodeURIComponent(handle.replace(/^@/, ""))}`); }
  async leaderboard(period: LeaderboardPeriod, anchorDate: string) {
    return this.request<ApiLeaderboard>(`/leaderboard?period=${period}&anchorDate=${encodeURIComponent(anchorDate)}`);
  }
  async requestFriend(handle: string) { return this.request<{ id?: string; sent?: boolean; accepted?: boolean }>("/friends/requests", { method: "POST", body: JSON.stringify({ handle }) }); }
  async acceptFriend(requestId: string) { return this.request(`/friends/requests/${requestId}/accept`, { method: "POST" }); }
  async declineFriend(requestId: string) { return this.request(`/friends/requests/${requestId}`, { method: "DELETE" }); }
  async removeFriend(userId: string) { return this.request(`/friends/${userId}`, { method: "DELETE" }); }
  async blockUser(userId: string) { return this.request(`/blocks/${userId}`, { method: "POST" }); }
  async blockedUsers() { return (await this.request<{ users: Array<SocialUser & { blockedAt: string }> }>("/blocks")).users; }
  async unblockUser(userId: string) { return this.request(`/blocks/${userId}`, { method: "DELETE" }); }
  async messages(userId: string) { return (await this.request<{ messages: ApiMessage[] }>(`/chat/${userId}/messages`)).messages; }
  async sendMessage(userId: string, input: { text?: string; file?: { name: string; size: number; mime: string; transferId: string } }) {
    return (await this.request<{ message: ApiMessage }>(`/chat/${userId}/messages`, { method: "POST", body: JSON.stringify(input) })).message;
  }
  async markRead(messageId: string) { return this.request(`/chat/messages/${messageId}/read`, { method: "POST" }); }
  async communities() { return (await this.request<{ communities: ApiCommunity[] }>("/communities")).communities; }
  async createCommunity(input: { name: string; description?: string; iconColor?: string }) {
    return (await this.request<{ community: ApiCommunity }>("/communities", { method: "POST", body: JSON.stringify(input) })).community;
  }
  async createCommunityChannel(communityId: string, input: { name: string; kind: "text" | "voice" }) {
    return (await this.request<{ channel: CommunityChannel }>(`/communities/${communityId}/channels`, { method: "POST", body: JSON.stringify(input) })).channel;
  }
  async createCommunityInvite(communityId: string) {
    return this.request<{ code: string; url: string }>(`/communities/${communityId}/invites`, { method: "POST", body: JSON.stringify({ expiresInHours: 168, maxUses: null }) });
  }
  async inviteFriendToCommunity(communityId: string, userId: string) {
    return this.request<{ invite: CommunityInvite; url: string }>(`/communities/${communityId}/invite-friend`, { method: "POST", body: JSON.stringify({ userId }) });
  }
  async communityInvites() { return (await this.request<{ invites: CommunityInvite[] }>("/community-invites")).invites; }
  async communityInvite(code: string) { return this.request<{ invite: CommunityInvite; alreadyMember: boolean }>(`/community-invites/${encodeURIComponent(code)}`); }
  async acceptCommunityInvite(code: string) { return this.request<{ accepted: boolean; communityId: string }>(`/community-invites/${encodeURIComponent(code)}/accept`, { method: "POST" }); }
  async communityMessages(channelId: string) { return (await this.request<{ messages: CommunityMessage[] }>(`/community-channels/${channelId}/messages`)).messages; }
  async sendCommunityMessage(channelId: string, body: string) {
    return (await this.request<{ message: CommunityMessage }>(`/community-channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ body }) })).message;
  }
  async rtcConfig() { return this.request<{ iceServers: RTCIceServer[]; expiresIn: number }>("/rtc/config"); }
  async syncActivity(snapshot: ActivitySnapshot) {
    return this.request("/activity/sync", { method: "POST", body: JSON.stringify({
      apps: snapshot.apps.map((app) => {
        const parsed = Date.parse(app.lastOpened);
        return { id: app.id, name: app.name, totalSeconds: app.totalSeconds, todaySeconds: app.todaySeconds, lastOpened: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(), status: app.status };
      }),
      heatmap: snapshot.heatmap,
      daily: snapshot.appDaily,
      away: snapshot.isAway
    }) });
  }

  subscribe(listener: (event: RealtimeEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  connectRealtime() {
    const token = this.sessionValue(tokenKey);
    if (!token || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.manuallyClosed = false;
    const url = `${this.apiUrl.replace(/^http/, "ws")}/realtime`;
    this.socket = new WebSocket(url);
    this.socket.onopen = () => this.socket?.send(JSON.stringify({ type: "auth", token }));
    this.socket.onmessage = ({ data }) => {
      try { const event = JSON.parse(String(data)) as RealtimeEvent; for (const listener of this.listeners) listener(event); } catch { /* ignore malformed server data */ }
    };
    this.socket.onclose = async (event) => {
      if (this.manuallyClosed) return;
      if (event.code === 1008) await this.refresh().catch(() => undefined);
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connectRealtime(), 2_000);
    };
  }

  sendRealtime(event: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Conexão em tempo real indisponível");
    this.socket.send(JSON.stringify(event));
  }

  closeRealtime() {
    this.manuallyClosed = true;
    window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
  }

  private saveSession(session: SessionResponse) {
    this.ignoreRememberedSession = false;
    sessionStorage.setItem(tokenKey, session.accessToken);
    sessionStorage.setItem(refreshKey, session.refreshToken);
    localStorage.setItem(tokenKey, session.accessToken);
    localStorage.setItem(refreshKey, session.refreshToken);
  }

  private sessionValue(key: string) {
    const active = sessionStorage.getItem(key);
    if (active) return active;
    if (this.ignoreRememberedSession) return null;
    const remembered = localStorage.getItem(key);
    if (remembered) sessionStorage.setItem(key, remembered);
    return remembered;
  }

  private async refresh() {
    const refreshToken = this.sessionValue(refreshKey);
    if (!refreshToken) throw new Error("Sessão encerrada");
    const session = await this.publicRequest<SessionResponse>("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) });
    this.saveSession(session);
    return session;
  }

  private async request<T = { ok: boolean }>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = this.sessionValue(tokenKey);
    const response = await fetch(`${this.apiUrl}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
    if (response.status === 401 && retry) { await this.refresh(); return this.request<T>(path, init, false); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível falar com o servidor");
    return payload as T;
  }

  private async publicRequest<T = { ok: boolean }>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível falar com o servidor");
    return payload as T;
  }
}

export const social = new SocialClient();
