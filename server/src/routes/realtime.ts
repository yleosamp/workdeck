import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { canDirectMessage } from "../auth.js";
import type { AuthUser } from "../types.js";

const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat") }),
  z.object({ type: z.literal("presence.set"), status: z.enum(["online", "away"]) }),
  z.object({ type: z.literal("chat.typing"), targetUserId: z.string().uuid(), isTyping: z.boolean() }),
  z.object({ type: z.literal("webrtc.ready"), targetUserId: z.string().uuid(), transferId: z.string().uuid() }),
  z.object({ type: z.literal("webrtc.signal"), targetUserId: z.string().uuid(), transferId: z.string().uuid(), signal: z.unknown() }),
  z.object({ type: z.literal("voice.join"), channelId: z.string().uuid() }),
  z.object({ type: z.literal("voice.leave") }),
  z.object({ type: z.literal("voice.update"), channelId: z.string().uuid(), muted: z.boolean().optional(), cameraEnabled: z.boolean().optional(), screenSharing: z.boolean().optional() }),
  z.object({ type: z.literal("voice.signal"), channelId: z.string().uuid(), targetUserId: z.string().uuid(), signal: z.unknown() }),
  z.object({ type: z.literal("voice.media"), channelId: z.string().uuid(), streamId: z.string().min(1).max(200), mediaKind: z.enum(["microphone", "camera", "screen"]), active: z.boolean() })
]);

async function hasVoiceAccess(app: FastifyInstance, userId: string, channelId: string) {
  const [rows] = await app.db.query<import("mysql2").RowDataPacket[]>(
    `SELECT 1 FROM community_channels ch JOIN community_members cm ON cm.community_id=ch.community_id
     WHERE ch.id=? AND ch.kind='voice' AND cm.user_id=? LIMIT 1`,
    [channelId, userId]
  );
  return rows.length > 0;
}

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/realtime", { websocket: true }, (socket) => {
    let user: { sub: string; handle: string; sessionId: string } | null = null;
    const authTimeout = setTimeout(() => { if (!user) socket.close(1008, "Autenticação necessária"); }, 5_000);
    socket.on("message", async (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (!user) {
          const auth = z.object({ type: z.literal("auth"), token: z.string().min(20) }).parse(payload);
          const authenticatedUser = app.jwt.verify<AuthUser>(auth.token);
          user = authenticatedUser;
          clearTimeout(authTimeout);
          await app.hub.connect(authenticatedUser.sub, authenticatedUser.sessionId, socket);
          socket.send(JSON.stringify({ type: "realtime.ready", userId: authenticatedUser.sub, serverTime: new Date().toISOString() }));
          return;
        }
        const event = clientEventSchema.parse(payload);
        if (event.type === "heartbeat") return socket.send(JSON.stringify({ type: "heartbeat.ack", at: new Date().toISOString() }));
        if (event.type === "presence.set") {
          await app.db.execute("UPDATE presence SET status=?,updated_at=UTC_TIMESTAMP(3) WHERE user_id=?", [event.status, user.sub]);
          return app.hub.broadcastPresence(user.sub);
        }
        if (event.type === "voice.join") {
          if (!(await hasVoiceAccess(app, user.sub, event.channelId))) return;
          const participants = await app.hub.joinVoice(user.sub, event.channelId);
          return app.hub.send(user.sub, { type: "voice.snapshot", channelId: event.channelId, participants });
        }
        if (event.type === "voice.leave") return app.hub.leaveVoice(user.sub);
        if (event.type === "voice.update") {
          if (!app.hub.isInVoice(user.sub, event.channelId)) return;
          return app.hub.updateVoice(user.sub, {
            ...(event.muted !== undefined ? { muted: event.muted } : {}),
            ...(event.cameraEnabled !== undefined ? { cameraEnabled: event.cameraEnabled } : {}),
            ...(event.screenSharing !== undefined ? { screenSharing: event.screenSharing } : {})
          });
        }
        if (event.type === "voice.signal") {
          if (!app.hub.isInVoice(user.sub, event.channelId) || !app.hub.isInVoice(event.targetUserId, event.channelId)) return;
          return app.hub.send(event.targetUserId, { type: "voice.signal", channelId: event.channelId, userId: user.sub, signal: event.signal });
        }
        if (event.type === "voice.media") {
          if (!app.hub.isInVoice(user.sub, event.channelId)) return;
          return app.hub.sendToVoice(event.channelId, { ...event, userId: user.sub }, user.sub);
        }
        if (!(await canDirectMessage(app, user.sub, event.targetUserId))) return;
        if (event.type === "chat.typing") {
          return app.hub.send(event.targetUserId, { type: "chat.typing", userId: user.sub, isTyping: event.isTyping });
        }
        if (event.type === "webrtc.ready") {
          return app.hub.send(event.targetUserId, { type: "webrtc.ready", userId: user.sub, transferId: event.transferId });
        }
        if (event.type === "webrtc.signal") {
          return app.hub.send(event.targetUserId, { type: "webrtc.signal", userId: user.sub, transferId: event.transferId, signal: event.signal });
        }
      } catch {
        socket.send(JSON.stringify({ type: "realtime.error", error: "Evento inválido" }));
      }
    });
    socket.on("close", () => { clearTimeout(authTimeout); if (user) void app.hub.disconnect(user.sub, socket); });
  });
};
