import type { FastifyPluginAsync } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { areFriends, normalizeHandle, toPublicUser, type UserRow } from "../auth.js";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export const userRoutes: FastifyPluginAsync = async (app) => {
  const imageDataSchema = z.string().max(2_500_000).regex(/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/).nullable();
  app.get("/me", { preHandler: app.authenticate }, async (request, reply) => {
    const [rows] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE id=?", [request.user.sub]);
    if (!rows[0]) return reply.code(404).send({ error: "Usuário não encontrado" });
    return { user: toPublicUser(rows[0], true) };
  });

  app.patch("/me", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({
      displayName: z.string().min(2).max(80).optional(),
      bio: z.string().max(280).optional(),
      avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      avatarUrl: imageDataSchema.optional(),
      bannerUrl: imageDataSchema.optional(),
      profileVisibility: z.enum(["public", "friends", "private"]).optional(),
      presenceVisibility: z.enum(["public", "friends", "private"]).optional()
    }).parse(request.body);
    const fields: string[] = [];
    const values: Array<string | null> = [];
    const mapping: Record<string, string> = {
      displayName: "display_name", bio: "bio", avatarColor: "avatar_color",
      avatarUrl: "avatar_url", bannerUrl: "banner_url",
      profileVisibility: "profile_visibility", presenceVisibility: "presence_visibility"
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (body[key as keyof typeof body] !== undefined) {
        fields.push(`${column}=?`);
        values.push(body[key as keyof typeof body] as string);
      }
    }
    if (fields.length) await app.db.execute(`UPDATE users SET ${fields.join(",")} WHERE id=?`, [...values, request.user.sub]);
    if (body.presenceVisibility !== undefined) await app.hub.broadcastPresence(request.user.sub);
    const [rows] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE id=?", [request.user.sub]);
    return { user: toPublicUser(rows[0], true) };
  });

  app.get("/users/search", { preHandler: app.authenticate }, async (request) => {
    const { q } = z.object({ q: z.string().min(2).max(80) }).parse(request.query);
    const search = `%${q.replace(/^@/, "")}%`;
    const [rows] = await app.db.execute<UserRow[]>(
      `SELECT u.* FROM users u
       WHERE u.id<>? AND (u.handle LIKE ? OR u.display_name LIKE ?)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?))
       ORDER BY CASE WHEN u.handle=? THEN 0 ELSE 1 END, u.handle LIMIT 20`,
      [request.user.sub, search, search, request.user.sub, request.user.sub, normalizeHandle(q)]
    );
    const users = await Promise.all(rows.map(async (row) => ({ ...toPublicUser(row), isFriend: await areFriends(app, request.user.sub, row.id) })));
    return { users };
  });

  app.get("/profiles/:handle", async (request, reply) => {
    const { handle } = z.object({ handle: z.string() }).parse(request.params);
    const [rows] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE handle=? LIMIT 1", [normalizeHandle(handle)]);
    const profile = rows[0];
    if (!profile) return reply.code(404).send({ error: "Perfil não encontrado" });
    let viewerId: string | null = null;
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (bearer) { try { viewerId = app.jwt.verify<{ sub: string }>(bearer).sub; } catch { viewerId = null; } }
    const self = profile.id === viewerId;
    const friendship = self || Boolean(viewerId && await areFriends(app, viewerId, profile.id));
    if (profile.profile_visibility === "private" && !self) return reply.code(403).send({ error: "Este perfil é privado" });
    if (profile.profile_visibility === "friends" && !friendship) return reply.code(403).send({ error: "Este perfil é visível somente para amigos" });

    const [[friendCount], [totals], [daily], [presence]] = await Promise.all([
      app.db.query<Array<{ count: number }> & RowDataPacket[]>("SELECT COUNT(*) AS count FROM friendships WHERE user_low_id=? OR user_high_id=?", [profile.id, profile.id]),
      app.db.query<Array<{ appId: string; appName: string; totalSeconds: number; lastOpenedAt: string | null }> & RowDataPacket[]>(
        "SELECT app_id AS appId, app_name AS appName, total_seconds AS totalSeconds, last_opened_at AS lastOpenedAt FROM activity_totals WHERE user_id=? ORDER BY total_seconds DESC", [profile.id]),
      app.db.query<Array<{ date: string; seconds: number }> & RowDataPacket[]>(
        "SELECT activity_date AS date, SUM(seconds) AS seconds FROM activity_daily WHERE user_id=? AND activity_date>=DATE_SUB(UTC_DATE(),INTERVAL 363 DAY) GROUP BY activity_date ORDER BY activity_date", [profile.id]),
      app.db.query<Array<{ status: string; currentAppId: string | null; currentAppName: string | null; sessionStartedAt: string | null; updatedAt: string }> & RowDataPacket[]>(
        "SELECT status,current_app_id AS currentAppId,current_app_name AS currentAppName,session_started_at AS sessionStartedAt,updated_at AS updatedAt FROM presence WHERE user_id=?", [profile.id])
    ]);
    const canSeePresence = self || profile.presence_visibility === "public" || (profile.presence_visibility === "friends" && friendship);
    return { profile: toPublicUser(profile, self), friendCount: friendCount[0]?.count ?? 0, totals, daily, presence: canSeePresence ? presence[0] ?? null : null, isFriend: friendship && !self };
  });

  app.get("/p/:handle", async (request, reply) => {
    const { handle } = z.object({ handle: z.string() }).parse(request.params);
    const [users] = await app.db.execute<UserRow[]>("SELECT * FROM users WHERE handle=? AND profile_visibility='public' LIMIT 1", [normalizeHandle(handle)]);
    const profile = users[0];
    if (!profile) return reply.code(404).type("text/html").send("<h1>Perfil não encontrado ou privado</h1>");
    const [[totals], [recent], [daily], [presence]] = await Promise.all([
      app.db.query<Array<{ appName: string; totalSeconds: number }> & RowDataPacket[]>("SELECT app_name AS appName,total_seconds AS totalSeconds FROM activity_totals WHERE user_id=? ORDER BY total_seconds DESC LIMIT 8", [profile.id]),
      app.db.query<Array<{ appName: string; lastOpenedAt: string }> & RowDataPacket[]>("SELECT app_name AS appName,last_opened_at AS lastOpenedAt FROM activity_totals WHERE user_id=? AND last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT 5", [profile.id]),
      app.db.query<Array<{ date: string; seconds: number }> & RowDataPacket[]>("SELECT activity_date AS date,SUM(seconds) AS seconds FROM activity_daily WHERE user_id=? AND activity_date>=DATE_SUB(UTC_DATE(),INTERVAL 363 DAY) GROUP BY activity_date ORDER BY activity_date", [profile.id]),
      app.db.query<Array<{ status: string; currentAppName: string | null }> & RowDataPacket[]>("SELECT status,current_app_name AS currentAppName FROM presence WHERE user_id=?", [profile.id])
    ]);
    const activity = new Map(daily.map((day) => [String(day.date).slice(0, 10), Number(day.seconds)]));
    const cells = Array.from({ length: 364 }, (_, index) => {
      const date = new Date(); date.setUTCDate(date.getUTCDate() - (363 - index));
      const key = date.toISOString().slice(0, 10); const seconds = activity.get(key) ?? 0;
      const level = seconds === 0 ? 0 : seconds < 3600 ? 1 : seconds < 3 * 3600 ? 2 : seconds < 6 * 3600 ? 3 : 4;
      return `<i class="l${level}" title="${key}: ${(seconds / 3600).toFixed(1)}h"></i>`;
    }).join("");
    const software = totals.map((item) => `<li><span>${escapeHtml(item.appName)}</span><strong>${Math.round(Number(item.totalSeconds) / 3600)}h</strong></li>`).join("") || "<li><span>Nenhuma atividade pública ainda</span></li>";
    const recentlyUsed = recent.map((item) => `<li><span>${escapeHtml(item.appName)}</span><time datetime="${escapeHtml(new Date(item.lastOpenedAt).toISOString())}">${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(item.lastOpenedAt)))}</time></li>`).join("") || "<li><span>Nenhum software usado recentemente</span></li>";
    const activeDays = daily.filter((day) => Number(day.seconds) > 0).length;
    const current = profile.presence_visibility === "public" && presence[0]?.status !== "offline" && presence[0]?.currentAppName
      ? `<div class="now"><b></b><span>Trabalhando agora em <strong>${escapeHtml(presence[0].currentAppName)}</strong></span></div>` : "";
    const initials = escapeHtml(profile.display_name.split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase());
    const bannerStyle = profile.banner_url ? ` style="background-image:url('${escapeHtml(profile.banner_url)}')"` : "";
    const avatarStyle = profile.avatar_url ? ` style="background-image:url('${escapeHtml(profile.avatar_url)}')"` : ` style="background-color:${escapeHtml(profile.avatar_color)}"`;
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return reply.type("text/html; charset=utf-8").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="15"><meta name="viewport" content="width=device-width"><title>${escapeHtml(profile.display_name)} · Workdeck</title><style>
      *{box-sizing:border-box}body{margin:0;background:#080b0e;color:#e9eef1;font:14px system-ui,-apple-system,Segoe UI,sans-serif}main{width:min(1000px,calc(100% - 32px));margin:50px auto}.brand{color:#72e3a2;font-weight:800;letter-spacing:.5px}.cover{height:210px;margin-top:25px;border:1px solid #20272c;border-radius:20px;background:radial-gradient(circle at 20% 20%,#1b5434,transparent 35%),radial-gradient(circle at 80% 10%,#302552,transparent 30%),#10151a;background-size:cover;background-position:center}.profile{display:flex;align-items:end;gap:18px;margin:-40px 24px 30px}.avatar{width:86px;height:86px;display:grid;place-items:center;border:5px solid #080b0e;border-radius:25px;background-size:cover;background-position:center;color:#08110c;font-size:24px;font-weight:900}.profile h1{margin:0;font-size:27px}.profile p{margin:4px 0;color:#879199}.bio{margin-left:auto;max-width:360px;color:#aeb6bc;line-height:1.5}.now{display:flex;align-items:center;gap:9px;padding:16px 18px;margin-bottom:14px;border:1px solid #245538;border-radius:13px;background:#10231a}.now b{width:8px;height:8px;border-radius:50%;background:#72e3a2;box-shadow:0 0 10px #72e3a2}.grid{display:grid;grid-template-columns:1.7fr .7fr;gap:14px}.card{min-width:0;padding:22px;border:1px solid #20272c;border-radius:16px;background:#101419}.card h2{margin:0 0 5px;font-size:16px}.card .sub{display:block;margin-bottom:18px;color:#66717a;font-size:11px}.heat{display:grid;grid-template-rows:repeat(7,10px);grid-auto-flow:column;grid-auto-columns:10px;gap:3px;overflow-x:auto;padding:2px 0 5px}.heat i{display:block;border-radius:2px;background:#1b2227}.heat .l1{background:#173d2a}.heat .l2{background:#20663c}.heat .l3{background:#36a35e}.heat .l4{background:#71e49f;box-shadow:0 0 7px #28643d}ul{list-style:none;margin:0;padding:0}li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #20272c}li span{color:#aeb6bc}li time{color:#68737b;font-size:11px;text-align:right}.recent-card{grid-column:1/-1}footer{margin-top:24px;color:#59636b;font-size:11px}@media(max-width:650px){.grid{grid-template-columns:1fr}.profile{align-items:flex-start;flex-wrap:wrap}.bio{width:100%;margin:0}.cover{height:145px}}</style></head><body><main><div class="brand">◉ WORKDECK</div><div class="cover"${bannerStyle}></div><section class="profile"><div class="avatar"${avatarStyle}>${profile.avatar_url ? "" : initials}</div><div><h1>${escapeHtml(profile.display_name)}</h1><p>@${escapeHtml(profile.handle)}</p></div><div class="bio">${escapeHtml(profile.bio || "Criando algo que vale lembrar.")}</div></section>${current}<div class="grid"><section class="card"><h2>Atividade nos últimos 12 meses</h2><span class="sub">${activeDays} dias com atividade · atualização automática</span><div class="heat">${cells}</div></section><section class="card"><h2>Mais usados</h2><span class="sub">Horas acumuladas</span><ul>${software}</ul></section><section class="card recent-card"><h2>Usados recentemente</h2><span class="sub">Últimas aberturas registradas</span><ul>${recentlyUsed}</ul></section></div><footer>Atividade compartilhada por ${escapeHtml(profile.display_name)} no Workdeck.</footer></main></body></html>`);
  });
};
