import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { areFriends, isBlocked, normalizeHandle, toPublicUser, type UserRow } from "../auth.js";
import { utcTimestamp } from "../dates.js";

async function createFriendship(connection: PoolConnection, first: string, second: string) {
  const [low, high] = [first, second].sort();
  await connection.execute("INSERT IGNORE INTO friendships (user_low_id,user_high_id) VALUES (?,?)", [low, high]);
}

export const friendRoutes: FastifyPluginAsync = async (app) => {
  app.get("/friends", { preHandler: app.authenticate }, async (request) => {
    const [rows] = await app.db.query<Array<UserRow & {
      status: "online" | "away" | "offline";
      current_app_id: string | null;
      current_app_name: string | null;
      session_started_at: string | null;
      last_seen_at: string | null;
      unread_count: number;
    }> & RowDataPacket[]>(
      `SELECT u.*, COALESCE(p.status,'offline') AS status, p.current_app_id, p.current_app_name, p.session_started_at,
       u.last_seen_at, (SELECT COUNT(*) FROM messages m WHERE m.sender_id=u.id AND m.recipient_id=? AND m.read_at IS NULL) AS unread_count
       FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low_id=? THEN f.user_high_id ELSE f.user_low_id END
       LEFT JOIN presence p ON p.user_id=u.id WHERE f.user_low_id=? OR f.user_high_id=?
       ORDER BY FIELD(COALESCE(p.status,'offline'),'online','away','offline'), u.display_name`,
      [request.user.sub, request.user.sub, request.user.sub, request.user.sub]
    );
    return { friends: rows.map((row) => {
      const hidden = row.presence_visibility === "private";
      return {
        ...toPublicUser(row), status: hidden ? "offline" : row.status,
        currentAppId: hidden ? null : row.current_app_id, currentAppName: hidden ? null : row.current_app_name,
        sessionStartedAt: hidden ? null : utcTimestamp(row.session_started_at), lastSeenAt: hidden ? null : utcTimestamp(row.last_seen_at),
        unreadCount: Number(row.unread_count)
      };
    }) };
  });

  app.get("/friends/requests", { preHandler: app.authenticate }, async (request) => {
    const [incoming] = await app.db.query<Array<UserRow & { request_id: string; request_created_at: string }> & RowDataPacket[]>(
      `SELECT u.*, fr.id AS request_id, fr.created_at AS request_created_at FROM friend_requests fr JOIN users u ON u.id=fr.sender_id
       WHERE fr.receiver_id=? AND fr.status='pending' ORDER BY fr.created_at DESC`, [request.user.sub]);
    const [outgoing] = await app.db.query<Array<UserRow & { request_id: string; request_created_at: string }> & RowDataPacket[]>(
      `SELECT u.*, fr.id AS request_id, fr.created_at AS request_created_at FROM friend_requests fr JOIN users u ON u.id=fr.receiver_id
       WHERE fr.sender_id=? AND fr.status='pending' ORDER BY fr.created_at DESC`, [request.user.sub]);
    const map = (row: UserRow & { request_id: string; request_created_at: string }) => ({ id: row.request_id, createdAt: utcTimestamp(row.request_created_at)!, user: toPublicUser(row) });
    return { incoming: incoming.map(map), outgoing: outgoing.map(map) };
  });

  app.post("/friends/requests", { preHandler: app.authenticate }, async (request, reply) => {
    const { handle } = z.object({ handle: z.string().min(3).max(30) }).parse(request.body);
    const [targets] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE handle=? LIMIT 1", [normalizeHandle(handle)]);
    const target = targets[0];
    if (!target) return reply.code(404).send({ error: "Usuário não encontrado" });
    if (target.id === request.user.sub) return reply.code(400).send({ error: "Você não pode adicionar a si mesmo" });
    if (await isBlocked(app, request.user.sub, target.id)) return reply.code(403).send({ error: "Não foi possível enviar a solicitação" });
    if (await areFriends(app, request.user.sub, target.id)) return reply.code(409).send({ error: "Vocês já são amigos" });

    const [reverse] = await app.db.execute<Array<{ id: string }> & RowDataPacket[]>(
      "SELECT id FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status='pending' LIMIT 1", [target.id, request.user.sub]);
    if (reverse[0]) {
      const connection = await app.db.getConnection();
      try {
        await connection.beginTransaction();
        await createFriendship(connection, request.user.sub, target.id);
        await connection.execute("UPDATE friend_requests SET status='accepted',responded_at=UTC_TIMESTAMP(3) WHERE id=?", [reverse[0].id]);
        await connection.commit();
      } finally { connection.release(); }
      const [currentUsers] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE id=?", [request.user.sub]);
      app.hub.send(target.id, { type: "friend.accepted", user: toPublicUser(currentUsers[0]) });
      return { accepted: true };
    }

    const id = randomUUID();
    await app.db.execute(
      `INSERT INTO friend_requests (id,sender_id,receiver_id,status) VALUES (?,?,?,'pending')
       ON DUPLICATE KEY UPDATE id=VALUES(id),status='pending',created_at=UTC_TIMESTAMP(3),responded_at=NULL`,
      [id, request.user.sub, target.id]
    );
    const [senders] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE id=?", [request.user.sub]);
    app.hub.send(target.id, { type: "friend.requested", request: { id, createdAt: new Date().toISOString(), user: toPublicUser(senders[0]) } });
    return reply.code(201).send({ id, sent: true });
  });

  app.post("/friends/requests/:id/accept", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [rows] = await app.db.execute<Array<{ sender_id: string }> & RowDataPacket[]>(
      "SELECT sender_id FROM friend_requests WHERE id=? AND receiver_id=? AND status='pending' FOR UPDATE", [id, request.user.sub]);
    if (!rows[0]) return reply.code(404).send({ error: "Solicitação não encontrada" });
    const connection = await app.db.getConnection();
    try {
      await connection.beginTransaction();
      await createFriendship(connection, request.user.sub, rows[0].sender_id);
      await connection.execute("UPDATE friend_requests SET status='accepted',responded_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    const [users] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE id=?", [request.user.sub]);
    app.hub.send(rows[0].sender_id, { type: "friend.accepted", user: toPublicUser(users[0]) });
    return { accepted: true };
  });

  app.delete("/friends/requests/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [result] = await app.db.execute<import("mysql2").ResultSetHeader>(
      "UPDATE friend_requests SET status=IF(sender_id=?,'canceled','rejected'),responded_at=UTC_TIMESTAMP(3) WHERE id=? AND (sender_id=? OR receiver_id=?) AND status='pending'",
      [request.user.sub, id, request.user.sub, request.user.sub]
    );
    if (!result.affectedRows) return reply.code(404).send({ error: "Solicitação não encontrada" });
    return { ok: true };
  });

  app.delete("/friends/:userId", { preHandler: app.authenticate }, async (request) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const [low, high] = [request.user.sub, userId].sort();
    await app.db.execute("DELETE FROM friendships WHERE user_low_id=? AND user_high_id=?", [low, high]);
    app.hub.send(userId, { type: "friend.removed", userId: request.user.sub });
    return { ok: true };
  });

  app.post("/blocks/:userId", { preHandler: app.authenticate }, async (request) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const connection = await app.db.getConnection();
    const [low, high] = [request.user.sub, userId].sort();
    try {
      await connection.beginTransaction();
      await connection.execute("INSERT IGNORE INTO blocks (blocker_id,blocked_id) VALUES (?,?)", [request.user.sub, userId]);
      await connection.execute("DELETE FROM friendships WHERE user_low_id=? AND user_high_id=?", [low, high]);
      await connection.execute("DELETE FROM friend_requests WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)", [request.user.sub, userId, userId, request.user.sub]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    app.hub.send(userId, { type: "friend.removed", userId: request.user.sub });
    return { blocked: true };
  });

  app.delete("/blocks/:userId", { preHandler: app.authenticate }, async (request) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    await app.db.execute("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?", [request.user.sub, userId]);
    return { blocked: false };
  });

  app.get("/blocks", { preHandler: app.authenticate }, async (request) => {
    const [rows] = await app.db.query<Array<UserRow & { blocked_at: string }> & RowDataPacket[]>(
      `SELECT u.*,b.created_at AS blocked_at FROM blocks b JOIN users u ON u.id=b.blocked_id
       WHERE b.blocker_id=? ORDER BY b.created_at DESC`,
      [request.user.sub]
    );
    return { users: rows.map((row) => ({ ...toPublicUser(row), blockedAt: utcTimestamp(row.blocked_at)! })) };
  });
};
