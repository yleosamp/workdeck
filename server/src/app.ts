import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { LogController } from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import { initializeDatabase } from "./database.js";
import { RealtimeHub } from "./realtime.js";
import { activityRoutes } from "./routes/activity.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { friendRoutes } from "./routes/friends.js";
import { realtimeRoutes } from "./routes/realtime.js";
import { updateRoutes } from "./routes/updates.js";
import { userRoutes } from "./routes/users.js";
import "./types.js";

export async function buildServer() {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info", redact: ["req.headers.authorization"] },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1_048_576
  });
  const db = await initializeDatabase();
  app.decorate("db", db);
  app.decorate("hub", new RealtimeHub(db));

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.clientOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Origem não autorizada"), false);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
  });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  await app.register(websocket, { options: { maxPayload: 128 * 1024, perMessageDeflate: false } });

  app.decorate("authenticate", async (request, reply) => {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ error: "Autenticação necessária" }); }
  });

  app.get("/health", async () => ({ status: "ok", service: "workdeck-api", time: new Date().toISOString() }));
  await app.register(updateRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(friendRoutes);
  await app.register(activityRoutes);
  await app.register(chatRoutes);
  await app.register(realtimeRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Dados inválidos", details: error.issues });
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return reply.code(409).send({ error: "Este registro já existe" });
    app.log.error(error);
    return reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ error: "Erro interno do servidor" });
  });

  app.addHook("onClose", async () => { await db.end(); });
  return app;
}
