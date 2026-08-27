import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2";
import type { AuthUser, PublicUser } from "./types.js";

export type UserRow = RowDataPacket & {
  id: string;
  email: string;
  handle: string;
  display_name: string;
  password_hash: string;
  bio: string;
  avatar_color: string;
  avatar_url: string | null;
  banner_url: string | null;
  profile_visibility: PublicUser["profileVisibility"];
  presence_visibility: PublicUser["presenceVisibility"];
  created_at: string;
};

export function normalizeHandle(handle: string) {
  return handle.trim().toLowerCase().replace(/^@/, "");
}

export function toPublicUser(row: UserRow, includeEmail = false): PublicUser {
  return {
    id: row.id,
    ...(includeEmail ? { email: row.email } : {}),
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url,
    profileVisibility: row.profile_visibility,
    presenceVisibility: row.presence_visibility,
    createdAt: row.created_at
  };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueSession(app: FastifyInstance, user: UserRow, deviceName = "Workdeck Desktop") {
  const sessionId = randomUUID();
  const refreshToken = randomBytes(48).toString("base64url");
  const refreshTokenHash = hashToken(refreshToken);
  await app.db.execute(
    "INSERT INTO sessions (id, user_id, refresh_token_hash, device_name, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY))",
    [sessionId, user.id, refreshTokenHash, deviceName.slice(0, 120)]
  );
  const payload: AuthUser = { sub: user.id, handle: user.handle, sessionId };
  const accessToken = app.jwt.sign(payload, { expiresIn: "15m" });
  return { accessToken, refreshToken, expiresIn: 900, user: toPublicUser(user, true) };
}

export async function areFriends(app: FastifyInstance, first: string, second: string) {
  const [low, high] = [first, second].sort();
  const [rows] = await app.db.execute<RowDataPacket[]>(
    "SELECT 1 FROM friendships WHERE user_low_id = ? AND user_high_id = ? LIMIT 1",
    [low, high]
  );
  return rows.length > 0;
}

export async function isBlocked(app: FastifyInstance, first: string, second: string) {
  const [rows] = await app.db.execute<RowDataPacket[]>(
    "SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1",
    [first, second, second, first]
  );
  return rows.length > 0;
}
