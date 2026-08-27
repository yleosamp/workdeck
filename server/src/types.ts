import type { Pool } from "mysql2/promise";
import type { RealtimeHub } from "./realtime.js";

export type AuthUser = {
  sub: string;
  handle: string;
  sessionId: string;
};

export type PublicUser = {
  id: string;
  email?: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarColor: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  profileVisibility: "public" | "friends" | "private";
  presenceVisibility: "public" | "friends" | "private";
  createdAt: string;
};

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
    hub: RealtimeHub;
    authenticate: (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}
