import type { Pool } from "mysql2/promise";
import type { WebSocket } from "ws";
import { toPublicUser, type UserRow } from "./auth.js";
import { utcTimestamp } from "./dates.js";

type SocketEntry = { socket: WebSocket; sessionId: string };
export type VoiceState = {
  userId: string;
  channelId: string;
  muted: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  joinedAt: string;
};

export class RealtimeHub {
  private connections = new Map<string, Set<SocketEntry>>();
  private voiceStates = new Map<string, VoiceState>();
  constructor(private db: Pool) {}

  async connect(userId: string, sessionId: string, socket: WebSocket) {
    const entries = this.connections.get(userId) ?? new Set<SocketEntry>();
    entries.add({ socket, sessionId });
    this.connections.set(userId, entries);
    await this.db.execute(
      "INSERT INTO presence (user_id, status, updated_at) VALUES (?, 'online', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE status='online', updated_at=UTC_TIMESTAMP(3)",
      [userId]
    );
    await this.broadcastPresence(userId);
  }

  async disconnect(userId: string, socket: WebSocket) {
    const entries = this.connections.get(userId);
    if (entries) {
      for (const entry of entries) if (entry.socket === socket) entries.delete(entry);
      if (!entries.size) this.connections.delete(userId);
    }
    if (!this.connections.has(userId)) {
      await this.leaveVoice(userId);
      await this.db.execute("UPDATE presence SET status='offline', current_app_id=NULL, current_app_name=NULL, updated_at=UTC_TIMESTAMP(3) WHERE user_id=?", [userId]);
      await this.db.execute("UPDATE users SET last_seen_at=UTC_TIMESTAMP(3) WHERE id=?", [userId]);
      await this.broadcastPresence(userId);
    }
  }

  send(userId: string, event: unknown) {
    const payload = JSON.stringify(event);
    for (const entry of this.connections.get(userId) ?? []) {
      if (entry.socket.readyState === entry.socket.OPEN) entry.socket.send(payload);
    }
  }

  isOnline(userId: string) {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }

  async friendIds(userId: string) {
    const [rows] = await this.db.query<Array<{ friend_id: string }> & import("mysql2").RowDataPacket[]>(
      `SELECT CASE WHEN user_low_id = ? THEN user_high_id ELSE user_low_id END AS friend_id
       FROM friendships WHERE user_low_id = ? OR user_high_id = ?`,
      [userId, userId, userId]
    );
    return rows.map((row) => row.friend_id);
  }

  async broadcastToFriends(userId: string, event: unknown) {
    for (const friendId of await this.friendIds(userId)) this.send(friendId, event);
  }

  async communityMemberIds(communityId: string) {
    const [rows] = await this.db.query<Array<{ user_id: string }> & import("mysql2").RowDataPacket[]>(
      "SELECT user_id FROM community_members WHERE community_id=?",
      [communityId]
    );
    return rows.map((row) => row.user_id);
  }

  async sendToCommunity(communityId: string, event: unknown) {
    for (const memberId of await this.communityMemberIds(communityId)) this.send(memberId, event);
  }

  voiceStateForUser(userId: string) {
    return this.voiceStates.get(userId) ?? null;
  }

  isInVoice(userId: string, channelId: string) {
    return this.voiceStates.get(userId)?.channelId === channelId;
  }

  async voiceParticipant(userId: string) {
    const [rows] = await this.db.query<Array<UserRow & {
      status: "online" | "away" | "offline";
      current_app_id: string | null;
      current_app_name: string | null;
    }> & import("mysql2").RowDataPacket[]>(
      `SELECT u.*,COALESCE(p.status,'offline') AS status,p.current_app_id,p.current_app_name
       FROM users u LEFT JOIN presence p ON p.user_id=u.id WHERE u.id=? LIMIT 1`,
      [userId]
    );
    const state = this.voiceStates.get(userId);
    if (!rows[0] || !state) return null;
    const hidden = rows[0].presence_visibility === "private";
    return {
      ...toPublicUser(rows[0]),
      status: hidden ? "offline" : rows[0].status,
      currentAppId: hidden ? null : rows[0].current_app_id,
      currentAppName: hidden ? null : rows[0].current_app_name,
      ...state
    };
  }

  async voiceSnapshot(channelId: string) {
    const participants = [];
    for (const state of this.voiceStates.values()) {
      if (state.channelId !== channelId) continue;
      const participant = await this.voiceParticipant(state.userId);
      if (participant) participants.push(participant);
    }
    return participants;
  }

  async sendToVoice(channelId: string, event: unknown, exceptUserId?: string) {
    for (const state of this.voiceStates.values()) {
      if (state.channelId === channelId && state.userId !== exceptUserId) this.send(state.userId, event);
    }
  }

  async joinVoice(userId: string, channelId: string) {
    const previous = this.voiceStates.get(userId);
    if (previous && previous.channelId !== channelId) await this.leaveVoice(userId);
    if (!this.voiceStates.has(userId) || previous?.channelId !== channelId) {
      this.voiceStates.set(userId, {
        userId,
        channelId,
        muted: false,
        cameraEnabled: false,
        screenSharing: false,
        joinedAt: new Date().toISOString()
      });
      const participant = await this.voiceParticipant(userId);
      if (participant) await this.sendToVoice(channelId, { type: "voice.participant", action: "joined", participant });
    }
    return this.voiceSnapshot(channelId);
  }

  async updateVoice(userId: string, update: Partial<Pick<VoiceState, "muted" | "cameraEnabled" | "screenSharing">>) {
    const state = this.voiceStates.get(userId);
    if (!state) return null;
    Object.assign(state, update);
    const participant = await this.voiceParticipant(userId);
    if (participant) await this.sendToVoice(state.channelId, { type: "voice.participant", action: "updated", participant });
    return participant;
  }

  async leaveVoice(userId: string) {
    const state = this.voiceStates.get(userId);
    if (!state) return;
    this.voiceStates.delete(userId);
    await this.sendToVoice(state.channelId, { type: "voice.participant", action: "left", participant: { userId, channelId: state.channelId } });
  }

  async broadcastPresence(userId: string) {
    const [rows] = await this.db.query<Array<{
      status: string;
      current_app_id: string | null;
      current_app_name: string | null;
      session_started_at: string | null;
      updated_at: string;
      presence_visibility: "public" | "friends" | "private";
    }> & import("mysql2").RowDataPacket[]>(
      "SELECT p.*,u.presence_visibility FROM presence p JOIN users u ON u.id=p.user_id WHERE p.user_id=?",
      [userId]
    );
    if (!rows[0]) return;
    const friendIds = new Set(await this.friendIds(userId));
    const [communityRows] = await this.db.query<Array<{ user_id: string }> & import("mysql2").RowDataPacket[]>(
      `SELECT DISTINCT other.user_id FROM community_members mine
       JOIN community_members other ON other.community_id=mine.community_id
       WHERE mine.user_id=? AND other.user_id<>?`,
      [userId, userId]
    );
    const recipients = new Set([...friendIds, ...communityRows.map((row) => row.user_id)]);
    for (const recipientId of recipients) {
      const hidden = rows[0].presence_visibility === "private" || (rows[0].presence_visibility === "friends" && !friendIds.has(recipientId));
      this.send(recipientId, {
        type: "presence.updated",
        userId,
        presence: {
          status: hidden ? "offline" : rows[0].status,
          currentAppId: hidden ? null : rows[0].current_app_id,
          currentAppName: hidden ? null : rows[0].current_app_name,
          sessionStartedAt: hidden ? null : utcTimestamp(rows[0].session_started_at),
          updatedAt: utcTimestamp(rows[0].updated_at) ?? new Date().toISOString()
        }
      });
    }
  }

  async markStaleAway() {
    const [rows] = await this.db.query<Array<{ user_id: string }> & import("mysql2").RowDataPacket[]>(
      `SELECT user_id FROM presence
       WHERE status='online' AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 90 SECOND)`
    );
    if (!rows.length) return;
    await this.db.execute(
      `UPDATE presence SET status='away',current_app_id=NULL,current_app_name=NULL,session_started_at=NULL,updated_at=UTC_TIMESTAMP(3)
       WHERE status='online' AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 90 SECOND)`
    );
    for (const row of rows) await this.broadcastPresence(row.user_id);
  }
}
