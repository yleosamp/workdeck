import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { areFriends, isBlocked } from "../auth.js";
import type { AuthUser } from "../types.js";

const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat") }),
  z.object({ type: z.literal("presence.set"), status: z.enum(["online", "away"]) }),
  z.object({ type: z.literal("chat.typing"), targetUserId: z.string().uuid(), isTyping: z.boolean() }),
  z.object({ type: z.literal("webrtc.ready"), targetUserId: z.string().uuid(), transferId: z.string().uuid() }),
  z.object({ type: z.literal("webrtc.signal"), targetUserId: z.string().uuid(), transferId: z.string().uuid(), signal: z.unknown() })
]);

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
        if (!(await areFriends(app, user.sub, event.targetUserId)) || await isBlocked(app, user.sub, event.targetUserId)) return;
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
