import type { FastifyPluginAsync } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { utcTimestamp } from "../dates.js";

const appSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  totalSeconds: z.number().int().nonnegative(),
  todaySeconds: z.number().int().nonnegative(),
  lastOpened: z.string().nullable().optional(),
  status: z.enum(["running", "idle"])
});

const daySchema = z.object({ date: z.iso.date(), seconds: z.number().int().nonnegative() });
const appDaySchema = daySchema.extend({ appId: z.string().min(1).max(80) });
const leaderboardPeriodSchema = z.enum(["day", "week", "month", "year"]);

function leaderboardBounds(period: z.infer<typeof leaderboardPeriodSchema>, anchorDate: string) {
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  const start = new Date(anchor);
  if (period === "week") {
    const weekday = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  }
  if (period === "month") start.setUTCDate(1);
  if (period === "year") {
    start.setUTCMonth(0, 1);
  }
  return { startDate: start.toISOString().slice(0, 10), endDate: anchorDate };
}

function validLastOpened(value: string | null | undefined, running: boolean) {
  if (running) return new Date();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.post("/activity/sync", { preHandler: app.authenticate }, async (request) => {
    const body = z.object({
      apps: z.array(appSchema).max(100),
      heatmap: z.array(daySchema).max(366),
      daily: z.array(appDaySchema).max(36_600).default([]),
      away: z.boolean().default(false)
    }).parse(request.body);
    const connection = await app.db.getConnection();
    const running = body.away ? undefined : body.apps.find((item) => item.status === "running");
    const localToday = body.heatmap.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
    try {
      await connection.beginTransaction();
      for (const item of body.apps) {
        await connection.execute(
          `INSERT INTO activity_totals (user_id,app_id,app_name,total_seconds,last_opened_at) VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE app_name=VALUES(app_name),total_seconds=VALUES(total_seconds),
             last_opened_at=COALESCE(VALUES(last_opened_at),last_opened_at)`,
          [request.user.sub, item.id, item.name, item.totalSeconds, validLastOpened(item.lastOpened, item.status === "running")]
        );
      }
      await connection.execute("DELETE FROM activity_daily WHERE user_id=? AND app_id='all-apps'", [request.user.sub]);
      for (const day of body.heatmap) {
        await connection.execute(
          `INSERT INTO activity_daily (user_id,activity_date,app_id,app_name,seconds) VALUES (?,?,'all-apps','Tempo focado',?)
           ON DUPLICATE KEY UPDATE app_name=VALUES(app_name),seconds=VALUES(seconds)`,
          [request.user.sub, day.date, day.seconds]
        );
      }
      for (const day of body.daily) {
        const trackedApp = body.apps.find((item) => item.id === day.appId);
        if (!trackedApp) continue;
        await connection.execute(
          `INSERT INTO activity_daily (user_id,activity_date,app_id,app_name,seconds) VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE app_name=VALUES(app_name),seconds=VALUES(seconds)`,
          [request.user.sub, day.date, day.appId, trackedApp.name, day.seconds]
        );
      }
      // Keep today's public heatmap reliable even when an older desktop client
      // does not send its per-app daily history yet.
      for (const item of body.apps) {
        await connection.execute(
          `INSERT INTO activity_daily (user_id,activity_date,app_id,app_name,seconds) VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE app_name=VALUES(app_name),seconds=VALUES(seconds)`,
          [request.user.sub, localToday, item.id, item.name, item.todaySeconds]
        );
      }
      await connection.execute(
        `INSERT INTO presence (user_id,status,current_app_id,current_app_name,session_started_at,updated_at)
         VALUES (?,?,?,?,IF(? IS NULL,NULL,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE status=VALUES(status),
           session_started_at=IF(VALUES(current_app_id) IS NULL,NULL,IF(current_app_id=VALUES(current_app_id),session_started_at,UTC_TIMESTAMP(3))),
           current_app_id=VALUES(current_app_id),current_app_name=VALUES(current_app_name),updated_at=UTC_TIMESTAMP(3)`,
        [request.user.sub, body.away ? "away" : "online", running?.id ?? null, running?.name ?? null, running?.id ?? null]
      );
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    await app.hub.broadcastPresence(request.user.sub);
    return { synced: true, serverTime: new Date().toISOString() };
  });

  app.get("/activity", { preHandler: app.authenticate }, async (request) => {
    const [[totals], [daily], [dailyByApp]] = await Promise.all([
      app.db.query<Array<{ appId: string; appName: string; totalSeconds: number; lastOpenedAt: string | null }> & RowDataPacket[]>(
        "SELECT app_id AS appId,app_name AS appName,total_seconds AS totalSeconds,last_opened_at AS lastOpenedAt FROM activity_totals WHERE user_id=? ORDER BY total_seconds DESC", [request.user.sub]),
      app.db.query<Array<{ date: string; seconds: number }> & RowDataPacket[]>(
        "SELECT activity_date AS date,seconds FROM activity_daily WHERE user_id=? AND app_id='all-apps' ORDER BY activity_date", [request.user.sub]),
      app.db.query<Array<{ date: string; appId: string; appName: string; seconds: number }> & RowDataPacket[]>(
        "SELECT activity_date AS date,app_id AS appId,app_name AS appName,seconds FROM activity_daily WHERE user_id=? AND app_id<>'all-apps' ORDER BY activity_date,app_id", [request.user.sub])
    ]);
    return { totals: totals.map((item) => ({ ...item, lastOpenedAt: utcTimestamp(item.lastOpenedAt) })), daily, dailyByApp };
  });

  app.get("/leaderboard", { preHandler: app.authenticate }, async (request) => {
    const { period, anchorDate } = z.object({
      period: leaderboardPeriodSchema.default("week"),
      anchorDate: z.iso.date()
    }).parse(request.query);
    const { startDate, endDate } = leaderboardBounds(period, anchorDate);
    const [rows] = await app.db.query<Array<{
      id: string;
      handle: string;
      displayName: string;
      avatarColor: string;
      avatarUrl: string | null;
      seconds: number;
    }> & RowDataPacket[]>(
      `SELECT u.id,u.handle,u.display_name AS displayName,u.avatar_color AS avatarColor,u.avatar_url AS avatarUrl,
        COALESCE(SUM(CASE WHEN ad.app_id='all-apps' THEN ad.seconds ELSE 0 END),0) AS seconds
       FROM (
         SELECT ? AS user_id
         UNION
         SELECT CASE WHEN f.user_low_id=? THEN f.user_high_id ELSE f.user_low_id END AS user_id
         FROM friendships f WHERE f.user_low_id=? OR f.user_high_id=?
       ) circle
       JOIN users u ON u.id=circle.user_id
       LEFT JOIN activity_daily ad ON ad.user_id=u.id AND ad.activity_date BETWEEN ? AND ?
       GROUP BY u.id,u.handle,u.display_name,u.avatar_color,u.avatar_url
       ORDER BY seconds DESC,u.display_name ASC`,
      [request.user.sub, request.user.sub, request.user.sub, request.user.sub, startDate, endDate]
    );
    return {
      period,
      startDate,
      endDate,
      updatedAt: new Date().toISOString(),
      entries: rows.map((row, index) => ({
        ...row,
        seconds: Number(row.seconds),
        rank: index + 1,
        isCurrentUser: row.id === request.user.sub
      }))
    };
  });
};
