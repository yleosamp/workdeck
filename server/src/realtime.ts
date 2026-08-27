import type { Pool } from "mysql2/promise";
import type { WebSocket } from "ws";
import { utcTimestamp } from "./dates.js";

type SocketEntry = { socket: WebSocket; sessionId: string };

export class RealtimeHub {
  private connections = new Map<string, Set<SocketEntry>>();
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
    const hidden = rows[0].presence_visibility === "private";
    await this.broadcastToFriends(userId, {
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
