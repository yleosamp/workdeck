import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { areFriends, toPublicUser, type UserRow } from "../auth.js";
import { config } from "../config.js";
import { utcTimestamp } from "../dates.js";

const communityFileSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(20 * 1024 * 1024 * 1024),
  mime: z.string().max(160).default("application/octet-stream"),
  transferId: z.string().uuid()
});

function parseCommunityFile(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  }
  return value as Record<string, unknown>;
}

type CommunityRow = RowDataPacket & {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  icon_color: string;
  created_at: string;
  role: "owner" | "member";
};

type ChannelRow = RowDataPacket & {
  id: string;
  community_id: string;
  name: string;
  kind: "text" | "voice";
  position: number;
  created_at: string;
};

type MemberRow = UserRow & {
  role: "owner" | "member";
  joined_at: string;
  status: "online" | "away" | "offline";
  current_app_id: string | null;
  current_app_name: string | null;
  session_started_at: string | null;
};

function mapChannel(row: ChannelRow) {
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    kind: row.kind,
    position: Number(row.position),
    createdAt: utcTimestamp(row.created_at)!
  };
}

async function isMember(app: FastifyInstance, communityId: string, userId: string) {
  const [rows] = await app.db.query<RowDataPacket[]>(
    "SELECT 1 FROM community_members WHERE community_id=? AND user_id=? LIMIT 1",
    [communityId, userId]
  );
  return rows.length > 0;
}

async function isOwner(app: FastifyInstance, communityId: string, userId: string) {
  const [rows] = await app.db.query<RowDataPacket[]>(
    "SELECT 1 FROM community_members WHERE community_id=? AND user_id=? AND role='owner' LIMIT 1",
    [communityId, userId]
  );
  return rows.length > 0;
}

async function channelAccess(app: FastifyInstance, channelId: string, userId: string) {
  const [rows] = await app.db.query<Array<ChannelRow> & RowDataPacket[]>(
    `SELECT ch.* FROM community_channels ch
     JOIN community_members cm ON cm.community_id=ch.community_id
     WHERE ch.id=? AND cm.user_id=? LIMIT 1`,
    [channelId, userId]
  );
  return rows[0] ?? null;
}

async function communitySnapshot(app: FastifyInstance, row: CommunityRow) {
  const [channels] = await app.db.query<Array<ChannelRow> & RowDataPacket[]>(
    "SELECT * FROM community_channels WHERE community_id=? ORDER BY kind,position,created_at",
    [row.id]
  );
  const [members] = await app.db.query<Array<MemberRow> & RowDataPacket[]>(
    `SELECT u.*,cm.role,cm.joined_at,COALESCE(p.status,'offline') AS status,
     p.current_app_id,p.current_app_name,p.session_started_at
     FROM community_members cm JOIN users u ON u.id=cm.user_id
     LEFT JOIN presence p ON p.user_id=u.id
     WHERE cm.community_id=?
     ORDER BY FIELD(COALESCE(p.status,'offline'),'online','away','offline'),u.display_name`,
    [row.id]
  );
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    iconColor: row.icon_color,
    role: row.role,
    createdAt: utcTimestamp(row.created_at)!,
    channels: channels.map(mapChannel),
    members: members.map((member) => {
      const hidden = member.presence_visibility === "private";
      return {
        ...toPublicUser(member),
        role: member.role,
        joinedAt: utcTimestamp(member.joined_at)!,
        status: hidden ? "offline" : member.status,
        currentAppId: hidden ? null : member.current_app_id,
        currentAppName: hidden ? null : member.current_app_name,
        sessionStartedAt: hidden ? null : utcTimestamp(member.session_started_at),
        voice: app.hub.voiceStateForUser(member.id)
      };
    })
  };
}

async function invitePreview(app: FastifyInstance, code: string) {
  const [rows] = await app.db.query<Array<RowDataPacket & {
    id: string;
    code: string;
    community_id: string;
    name: string;
    description: string;
    icon_color: string;
    target_user_id: string | null;
    expires_at: string | null;
    max_uses: number | null;
    uses: number;
    created_at: string;
    creator_name: string;
    member_count: number;
  }>>(
    `SELECT i.*,c.name,c.description,c.icon_color,u.display_name AS creator_name,
     (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id=c.id) AS member_count
     FROM community_invites i JOIN communities c ON c.id=i.community_id
     JOIN users u ON u.id=i.created_by WHERE i.code=? LIMIT 1`,
    [code]
  );
  const row = rows[0];
  if (!row) return null;
  const expired = Boolean(row.expires_at && new Date(`${row.expires_at.replace(" ", "T")}Z`).getTime() <= Date.now());
  const exhausted = row.max_uses !== null && Number(row.uses) >= Number(row.max_uses);
  return {
    id: row.id,
    code: row.code,
    communityId: row.community_id,
    communityName: row.name,
    description: row.description,
    iconColor: row.icon_color,
    creatorName: row.creator_name,
    memberCount: Number(row.member_count),
    targetUserId: row.target_user_id,
    createdAt: utcTimestamp(row.created_at)!,
    valid: !expired && !exhausted
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export const communityRoutes: FastifyPluginAsync = async (app) => {
  app.get("/communities", { preHandler: app.authenticate }, async (request) => {
    const [rows] = await app.db.query<Array<CommunityRow> & RowDataPacket[]>(
      `SELECT c.*,cm.role FROM community_members cm JOIN communities c ON c.id=cm.community_id
       WHERE cm.user_id=? ORDER BY c.created_at`,
      [request.user.sub]
    );
    return { communities: await Promise.all(rows.map((row) => communitySnapshot(app, row))) };
  });

  app.post("/communities", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(240).default(""),
      iconColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#72e3a2")
    }).parse(request.body);
    const communityId = randomUUID();
    const generalId = randomUUID();
    const loungeId = randomUUID();
    const connection = await app.db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO communities (id,owner_id,name,description,icon_color) VALUES (?,?,?,?,?)",
        [communityId, request.user.sub, body.name, body.description, body.iconColor]
      );
      await connection.execute(
        "INSERT INTO community_members (community_id,user_id,role) VALUES (?,?,'owner')",
        [communityId, request.user.sub]
      );
      await connection.execute(
        "INSERT INTO community_channels (id,community_id,name,kind,position) VALUES (?,?,?,'text',0),(?,?,?,'voice',0)",
        [generalId, communityId, "geral", loungeId, communityId, "Estúdio"]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const [rows] = await app.db.query<Array<CommunityRow> & RowDataPacket[]>(
      "SELECT c.*,'owner' AS role FROM communities c WHERE c.id=?",
      [communityId]
    );
    return reply.code(201).send({ community: await communitySnapshot(app, rows[0]) });
  });

  app.post("/communities/:communityId/channels", { preHandler: app.authenticate }, async (request, reply) => {
    const { communityId } = z.object({ communityId: z.string().uuid() }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["text", "voice"]) }).parse(request.body);
    if (!(await isOwner(app, communityId, request.user.sub))) return reply.code(403).send({ error: "Apenas o dono pode criar canais" });
    const [positions] = await app.db.query<Array<{ next_position: number }> & RowDataPacket[]>(
      "SELECT COALESCE(MAX(position)+1,0) AS next_position FROM community_channels WHERE community_id=? AND kind=?",
      [communityId, body.kind]
    );
    const id = randomUUID();
    await app.db.execute(
      "INSERT INTO community_channels (id,community_id,name,kind,position) VALUES (?,?,?,?,?)",
      [id, communityId, body.name, body.kind, Number(positions[0]?.next_position ?? 0)]
    );
    const [rows] = await app.db.query<Array<ChannelRow> & RowDataPacket[]>("SELECT * FROM community_channels WHERE id=?", [id]);
    await app.hub.sendToCommunity(communityId, { type: "community.updated", communityId });
    return reply.code(201).send({ channel: mapChannel(rows[0]) });
  });

  app.post("/communities/:communityId/invites", { preHandler: app.authenticate }, async (request, reply) => {
    const { communityId } = z.object({ communityId: z.string().uuid() }).parse(request.params);
    const body = z.object({ expiresInHours: z.number().int().min(1).max(24 * 30).nullable().default(168), maxUses: z.number().int().min(1).max(10_000).nullable().default(null) }).parse(request.body ?? {});
    if (!(await isMember(app, communityId, request.user.sub))) return reply.code(403).send({ error: "Você não participa desta comunidade" });
    const id = randomUUID();
    const code = randomBytes(10).toString("base64url");
    await app.db.execute(
      "INSERT INTO community_invites (id,community_id,code,created_by,expires_at,max_uses) VALUES (?,?,?,?,IF(? IS NULL,NULL,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? HOUR)),?)",
      [id, communityId, code, request.user.sub, body.expiresInHours, body.expiresInHours, body.maxUses]
    );
    return reply.code(201).send({ code, url: `${config.publicApiUrl}/join/${code}` });
  });

  app.post("/communities/:communityId/invite-friend", { preHandler: app.authenticate }, async (request, reply) => {
    const { communityId } = z.object({ communityId: z.string().uuid() }).parse(request.params);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.body);
    if (!(await isMember(app, communityId, request.user.sub))) return reply.code(403).send({ error: "Você não participa desta comunidade" });
    if (!(await areFriends(app, request.user.sub, userId))) return reply.code(403).send({ error: "Você só pode convidar amigos" });
    if (await isMember(app, communityId, userId)) return reply.code(409).send({ error: "Este amigo já participa da comunidade" });
    const id = randomUUID();
    const code = randomBytes(10).toString("base64url");
    await app.db.execute(
      "INSERT INTO community_invites (id,community_id,code,created_by,target_user_id,expires_at,max_uses) VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY),1)",
      [id, communityId, code, request.user.sub, userId]
    );
    const preview = await invitePreview(app, code);
    app.hub.send(userId, { type: "community.invited", invite: preview });
    return reply.code(201).send({ invite: preview, url: `${config.publicApiUrl}/join/${code}` });
  });

  app.get("/community-invites", { preHandler: app.authenticate }, async (request) => {
    const [rows] = await app.db.query<Array<{ code: string }> & RowDataPacket[]>(
      `SELECT i.code FROM community_invites i
       LEFT JOIN community_members cm ON cm.community_id=i.community_id AND cm.user_id=?
       WHERE i.target_user_id=? AND cm.user_id IS NULL
       AND (i.expires_at IS NULL OR i.expires_at>UTC_TIMESTAMP(3))
       AND (i.max_uses IS NULL OR i.uses<i.max_uses)
       ORDER BY i.created_at DESC`,
      [request.user.sub, request.user.sub]
    );
    return { invites: (await Promise.all(rows.map((row) => invitePreview(app, row.code)))).filter(Boolean) };
  });

  app.get("/community-invites/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = z.object({ code: z.string().min(8).max(40) }).parse(request.params);
    const invite = await invitePreview(app, code);
    if (!invite || !invite.valid) return reply.code(404).send({ error: "Este convite não existe ou expirou" });
    if (invite.targetUserId && invite.targetUserId !== request.user.sub) return reply.code(403).send({ error: "Este convite pertence a outro usuário" });
    return { invite, alreadyMember: await isMember(app, invite.communityId, request.user.sub) };
  });

  app.post("/community-invites/:code/accept", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = z.object({ code: z.string().min(8).max(40) }).parse(request.params);
    const connection = await app.db.getConnection();
    let communityId = "";
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<Array<RowDataPacket & { community_id: string; target_user_id: string | null }>>(
        `SELECT community_id,target_user_id FROM community_invites WHERE code=?
         AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3))
         AND (max_uses IS NULL OR uses<max_uses) FOR UPDATE`,
        [code]
      );
      if (!rows[0] || (rows[0].target_user_id && rows[0].target_user_id !== request.user.sub)) {
        await connection.rollback();
        return reply.code(404).send({ error: "Este convite não existe, expirou ou pertence a outra pessoa" });
      }
      communityId = rows[0].community_id;
      const [result] = await connection.execute<ResultSetHeader>(
        "INSERT IGNORE INTO community_members (community_id,user_id,role) VALUES (?,?,'member')",
        [communityId, request.user.sub]
      );
      if (result.affectedRows) await connection.execute("UPDATE community_invites SET uses=uses+1 WHERE code=?", [code]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await app.hub.sendToCommunity(communityId, { type: "community.updated", communityId });
    return { accepted: true, communityId };
  });

  app.get("/community-channels/:channelId/messages", { preHandler: app.authenticate }, async (request, reply) => {
    const { channelId } = z.object({ channelId: z.string().uuid() }).parse(request.params);
    const { before, limit } = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(60) }).parse(request.query);
    const channel = await channelAccess(app, channelId, request.user.sub);
    if (!channel) return reply.code(403).send({ error: "Canal indisponível" });
    const params: unknown[] = [channelId];
    const beforeSql = before ? "AND m.created_at<?" : "";
    if (before) params.push(new Date(before));
    params.push(limit);
    const [rows] = await app.db.query<Array<RowDataPacket & UserRow & { message_id: string; sender_id: string; body: string | null; message_type: "text" | "file"; file_metadata: unknown; message_created_at: string }>>(
      `SELECT m.id AS message_id,m.sender_id,m.body,m.message_type,m.file_metadata,m.created_at AS message_created_at,u.*
       FROM community_messages m JOIN users u ON u.id=m.sender_id
       WHERE m.channel_id=? ${beforeSql} ORDER BY m.created_at DESC LIMIT ?`,
      params
    );
    return { messages: rows.reverse().map((row) => ({ id: row.message_id, channelId, senderId: row.sender_id, body: row.body, type: row.message_type, file: parseCommunityFile(row.file_metadata), createdAt: utcTimestamp(row.message_created_at)!, author: toPublicUser(row) })) };
  });

  app.post("/community-channels/:channelId/messages", { preHandler: app.authenticate }, async (request, reply) => {
    const { channelId } = z.object({ channelId: z.string().uuid() }).parse(request.params);
    const payload = z.object({ body: z.string().trim().min(1).max(10_000).optional(), file: communityFileSchema.optional() })
      .refine((value) => value.body || value.file, "Mensagem vazia")
      .parse(request.body);
    const channel = await channelAccess(app, channelId, request.user.sub);
    if (!channel) return reply.code(403).send({ error: "Canal indisponível" });
    const id = randomUUID();
    await app.db.execute(
      "INSERT INTO community_messages (id,channel_id,sender_id,body,message_type,file_metadata) VALUES (?,?,?,?,?,?)",
      [id, channelId, request.user.sub, payload.body ?? null, payload.file ? "file" : "text", payload.file ? JSON.stringify(payload.file) : null]
    );
    const [users] = await app.db.query<UserRow[]>("SELECT * FROM users WHERE id=? LIMIT 1", [request.user.sub]);
    const message = { id, channelId, senderId: request.user.sub, body: payload.body ?? null, type: payload.file ? "file" as const : "text" as const, file: payload.file ?? null, createdAt: new Date().toISOString(), author: toPublicUser(users[0]) };
    await app.hub.sendToCommunity(channel.community_id, { type: "community.message", communityId: channel.community_id, message });
    return reply.code(201).send({ message });
  });

  app.get("/rtc/config", { preHandler: app.authenticate }, async (request) => {
    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [{ urls: "stun:stun.l.google.com:19302" }];
    if (config.turnSecret && config.turnUrls.length) {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const username = `${expiresAt}:${request.user.sub}`;
      const credential = createHmac("sha1", config.turnSecret).update(username).digest("base64");
      iceServers.push({ urls: config.turnUrls, username, credential });
    }
    return { iceServers, expiresIn: 3600 };
  });

  app.get("/join/:code", async (request, reply) => {
    const { code } = z.object({ code: z.string().min(8).max(40) }).parse(request.params);
    const invite = await invitePreview(app, code);
    if (!invite || !invite.valid) return reply.code(404).type("text/html; charset=utf-8").send("<h1>Convite inválido ou expirado</h1>");
    const name = escapeHtml(invite.communityName);
    const deepLink = `workdeck://invite/${encodeURIComponent(code)}`;
    return reply.type("text/html; charset=utf-8").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Entrar em ${name}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1013;color:#e9edef;font:16px system-ui}.card{width:min(430px,calc(100% - 40px));padding:34px;border:1px solid #27302c;border-radius:18px;background:#141a1e;text-align:center}.icon{width:68px;height:68px;display:grid;place-items:center;margin:auto;border-radius:20px;background:${escapeHtml(invite.iconColor)};color:#07130c;font-size:25px;font-weight:800}h1{font-size:24px}p{color:#8e999f;line-height:1.5}a{display:inline-flex;margin-top:12px;padding:13px 20px;border-radius:10px;background:#72e3a2;color:#092012;text-decoration:none;font-weight:750}</style></head><body><main class="card"><div class="icon">${name.slice(0, 2).toUpperCase()}</div><p>Você foi convidado por ${escapeHtml(invite.creatorName)} para entrar em</p><h1>${name}</h1><p>${invite.memberCount} participante(s)</p><a href="${deepLink}">Abrir no Workdeck</a><p>Se o aplicativo não abrir, copie este código: <strong>${escapeHtml(code)}</strong></p></main></body></html>`);
  });
};
