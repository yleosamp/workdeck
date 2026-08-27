import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { FastifyPluginAsync } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { hashToken, issueSession, normalizeHandle, toPublicUser, type UserRow } from "../auth.js";

const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  deviceName: z.string().max(120).optional()
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/register", async (request, reply) => {
    const body = credentialsSchema.extend({
      handle: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).transform(normalizeHandle),
      displayName: z.string().min(2).max(80).transform((value) => value.trim())
    }).parse(request.body);
    const [existing] = await app.db.execute<RowDataPacket[]>("SELECT id FROM users WHERE email=? OR handle=? LIMIT 1", [body.email, body.handle]);
    if (existing.length) return reply.code(409).send({ error: "Este e-mail ou nome de usuário já está em uso" });

    const id = crypto.randomUUID();
    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const colors = ["#72e3a2", "#79a7ff", "#f2977a", "#c786f4", "#e5b660"];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];
    await app.db.execute(
      "INSERT INTO users (id,email,handle,display_name,password_hash,avatar_color) VALUES (?,?,?,?,?,?)",
      [id, body.email, body.handle, body.displayName, passwordHash, avatarColor]
    );
    await app.db.execute("INSERT INTO presence (user_id,status) VALUES (?,'offline')", [id]);
    const [rows] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE id=?", [id]);
    return reply.code(201).send(await issueSession(app, rows[0], body.deviceName));
  });

  app.post("/auth/login", async (request, reply) => {
    const body = credentialsSchema.parse(request.body);
    const [rows] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE email=? LIMIT 1", [body.email]);
    if (!rows[0] || !(await argon2.verify(rows[0].password_hash, body.password))) {
      return reply.code(401).send({ error: "E-mail ou senha incorretos" });
    }
    return issueSession(app, rows[0], body.deviceName);
  });

  app.post("/auth/refresh", async (request, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(32) }).parse(request.body);
    const tokenHash = hashToken(refreshToken);
    const [rows] = await app.db.execute<Array<UserRow & { session_id: string }> & RowDataPacket[]>(
      `SELECT u.*, s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.refresh_token_hash=? AND s.expires_at > UTC_TIMESTAMP(3) LIMIT 1`,
      [tokenHash]
    );
    if (!rows[0]) return reply.code(401).send({ error: "Sessão expirada" });
    const nextRefreshToken = randomBytes(48).toString("base64url");
    await app.db.execute(
      "UPDATE sessions SET refresh_token_hash=?, last_used_at=UTC_TIMESTAMP(3), expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY) WHERE id=?",
      [hashToken(nextRefreshToken), rows[0].session_id]
    );
    return {
      accessToken: app.jwt.sign({ sub: rows[0].id, handle: rows[0].handle, sessionId: rows[0].session_id }, { expiresIn: "15m" }),
      refreshToken: nextRefreshToken,
      expiresIn: 900,
      user: toPublicUser(rows[0], true)
    };
  });

  app.post("/auth/logout", async (request) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(32) }).parse(request.body);
    await app.db.execute("DELETE FROM sessions WHERE refresh_token_hash=?", [hashToken(refreshToken)]);
    return { ok: true };
  });
};
