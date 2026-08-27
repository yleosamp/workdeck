import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { canDirectMessage } from "../auth.js";
import { utcTimestamp } from "../dates.js";

const fileSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(20 * 1024 * 1024 * 1024),
  mime: z.string().max(160).default("application/octet-stream"),
  transferId: z.string().uuid()
});

function mapMessage(row: Record<string, unknown>) {
  let file = row.file_metadata as Record<string, unknown> | null;
  if (typeof file === "string") {
    try { file = JSON.parse(file) as Record<string, unknown>; } catch { file = null; }
  }
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    text: row.body,
    type: row.message_type,
    file,
    createdAt: utcTimestamp(row.created_at),
    deliveredAt: utcTimestamp(row.delivered_at),
    readAt: utcTimestamp(row.read_at)
  };
}

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.get("/chat/:userId/messages", { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const { before, limit } = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    if (!(await canDirectMessage(app, request.user.sub, userId))) return reply.code(403).send({ error: "Conversa indisponível" });
    const parameters: unknown[] = [request.user.sub, userId, userId, request.user.sub];
    let beforeClause = "";
    if (before) { beforeClause = "AND created_at < ?"; parameters.push(new Date(before)); }
    parameters.push(limit);
    const [rows] = await app.db.query<Array<Record<string, unknown>> & RowDataPacket[]>(
      `SELECT * FROM messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ${beforeClause}
       ORDER BY created_at DESC LIMIT ?`, parameters);
    return { messages: rows.reverse().map(mapMessage) };
  });

  app.post("/chat/:userId/messages", { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({ text: z.string().trim().min(1).max(10_000).optional(), file: fileSchema.optional() }).refine((value) => value.text || value.file, "Mensagem vazia").parse(request.body);
    if (!(await canDirectMessage(app, request.user.sub, userId))) return reply.code(403).send({ error: "Você pode conversar com amigos e membros das suas comunidades" });
    const id = randomUUID();
    const delivered = app.hub.isOnline(userId);
    await app.db.execute(
      "INSERT INTO messages (id,sender_id,recipient_id,body,message_type,file_metadata,delivered_at) VALUES (?,?,?,?,?,?,IF(?=1,UTC_TIMESTAMP(3),NULL))",
      [id, request.user.sub, userId, body.text ?? null, body.file ? "file" : "text", body.file ? JSON.stringify(body.file) : null, delivered ? 1 : 0]
    );
    const [rows] = await app.db.query<Array<Record<string, unknown>> & RowDataPacket[]>("SELECT * FROM messages WHERE id=?", [id]);
    const message = mapMessage(rows[0]);
    app.hub.send(userId, { type: "message.created", message });
    return reply.code(201).send({ message });
  });

  app.post("/chat/messages/:id/read", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [rows] = await app.db.query<Array<{ sender_id: string }> & RowDataPacket[]>("SELECT sender_id FROM messages WHERE id=? AND recipient_id=?", [id, request.user.sub]);
    if (!rows[0]) return reply.code(404).send({ error: "Mensagem não encontrada" });
    await app.db.execute("UPDATE messages SET delivered_at=COALESCE(delivered_at,UTC_TIMESTAMP(3)),read_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
    app.hub.send(rows[0].sender_id, { type: "message.read", messageId: id, readerId: request.user.sub, readAt: new Date().toISOString() });
    return { read: true };
  });
};
