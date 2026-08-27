import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildServer } from "../src/app.js";

const runId = randomUUID().slice(0, 8);
const firstEmail = `alex-${runId}@workdeck.test`;
const secondEmail = `maya-${runId}@workdeck.test`;
const firstHandle = `alex_${runId}`;
const secondHandle = `maya_${runId}`;
const password = "TesteSeguro123!";

let app: Awaited<ReturnType<typeof buildServer>>;
let firstToken = "";
let firstRefresh = "";
let firstId = "";
let secondToken = "";
let secondId = "";
let requestId = "";
let messageId = "";
let serverAddress = "";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildServer();
  serverAddress = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  await app.db.execute("DELETE FROM users WHERE email IN (?,?)", [firstEmail, secondEmail]);
  await app.close();
});

describe.sequential("Workdeck API", () => {
  it("answers the desktop updater without requiring login", async () => {
    const response = await app.inject({ method: "GET", url: "/updates/windows/x86_64/9999.0.0" });
    expect(response.statusCode).toBe(204);
  });

  it("creates two real accounts", async () => {
    const first = await app.inject({ method: "POST", url: "/auth/register", payload: { email: firstEmail, handle: firstHandle, displayName: "Alex Teste", password } });
    const second = await app.inject({ method: "POST", url: "/auth/register", payload: { email: secondEmail, handle: secondHandle, displayName: "Maya Teste", password } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstBody = first.json();
    const secondBody = second.json();
    firstToken = firstBody.accessToken;
    firstRefresh = firstBody.refreshToken;
    firstId = firstBody.user.id;
    secondToken = secondBody.accessToken;
    secondId = secondBody.user.id;
  });

  it("rotates refresh tokens", async () => {
    const response = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: firstRefresh } });
    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).not.toBe(firstRefresh);
    firstToken = response.json().accessToken;
  });

  it("searches users and completes a friend request", async () => {
    const search = await app.inject({ method: "GET", url: `/users/search?q=${secondHandle}`, headers: auth(firstToken) });
    expect(search.json().users[0].handle).toBe(secondHandle);
    const sent = await app.inject({ method: "POST", url: "/friends/requests", headers: auth(firstToken), payload: { handle: secondHandle } });
    expect(sent.statusCode).toBe(201);
    requestId = sent.json().id;
    const incoming = await app.inject({ method: "GET", url: "/friends/requests", headers: auth(secondToken) });
    expect(incoming.json().incoming[0].id).toBe(requestId);
    const accepted = await app.inject({ method: "POST", url: `/friends/requests/${requestId}/accept`, headers: auth(secondToken) });
    expect(accepted.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/friends", headers: auth(firstToken) });
    expect(list.json().friends[0].id).toBe(secondId);
  });

  it("stores messages and read receipts", async () => {
    const sent = await app.inject({ method: "POST", url: `/chat/${secondId}/messages`, headers: auth(firstToken), payload: { text: "Mensagem real de integração" } });
    expect(sent.statusCode).toBe(201);
    messageId = sent.json().message.id;
    const history = await app.inject({ method: "GET", url: `/chat/${firstId}/messages`, headers: auth(secondToken) });
    expect(history.json().messages[0].text).toBe("Mensagem real de integração");
    const read = await app.inject({ method: "POST", url: `/chat/messages/${messageId}/read`, headers: auth(secondToken) });
    expect(read.json().read).toBe(true);
  });

  it("syncs activity and exposes it on a friend profile", async () => {
    const synced = await app.inject({ method: "POST", url: "/activity/sync", headers: auth(firstToken), payload: {
      apps: [
        { id: "blender", name: "Blender", totalSeconds: 7200, todaySeconds: 1800, lastOpened: null, status: "running" },
        { id: "photoshop", name: "Photoshop", totalSeconds: 0, todaySeconds: 0, lastOpened: "Never opened", status: "idle" }
      ],
      heatmap: [{ date: new Date().toISOString().slice(0, 10), seconds: 1800 }],
      daily: [{ date: new Date().toISOString().slice(0, 10), appId: "blender", seconds: 1800 }]
    } });
    expect(synced.statusCode).toBe(200);
    const activity = await app.inject({ method: "GET", url: "/activity", headers: auth(firstToken) });
    expect(activity.json().dailyByApp[0].appId).toBe("blender");
    expect(Number(activity.json().dailyByApp[0].seconds)).toBe(1800);
    const profile = await app.inject({ method: "GET", url: `/profiles/${firstHandle}`, headers: auth(secondToken) });
    expect(Number(profile.json().totals[0].totalSeconds)).toBe(7200);
    expect(profile.json().presence.currentAppName).toBe("Blender");
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const edited = await app.inject({ method: "PATCH", url: "/me", headers: auth(firstToken), payload: { bio: "Perfil completo de integração", avatarUrl: pixel, bannerUrl: pixel, presenceVisibility: "public" } });
    expect(edited.json().user.avatarUrl).toBe(pixel);
    const publicPage = await app.inject({ method: "GET", url: `/p/${firstHandle}` });
    expect(publicPage.body).toContain("Perfil completo de integração");
    expect(publicPage.body).toContain("Atividade nos últimos 12 meses");
    expect(publicPage.body).toContain("Trabalhando agora em");
    expect(publicPage.body).toContain("Usados recentemente");
  });

  it("ranks only the current user and friends by calendar period", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await app.inject({ method: "GET", url: `/leaderboard?period=day&anchorDate=${today}`, headers: auth(firstToken) });
    expect(response.statusCode).toBe(200);
    const leaderboard = response.json();
    expect(leaderboard.period).toBe("day");
    expect(leaderboard.entries).toHaveLength(2);
    expect(leaderboard.entries[0]).toMatchObject({ id: firstId, rank: 1, isCurrentUser: true, seconds: 1800 });
    expect(leaderboard.entries[1]).toMatchObject({ id: secondId, rank: 2, isCurrentUser: false, seconds: 0 });
  });

  it("relays presence and WebRTC signaling between friends", async () => {
    const wsBase = serverAddress.replace(/^http/, "ws");
    const firstSocket = new WebSocket(`${wsBase}/realtime`);
    const secondSocket = new WebSocket(`${wsBase}/realtime`);
    const ready = (socket: WebSocket, token: string) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket timeout")), 3_000);
      socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token })));
      socket.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.type === "realtime.ready") { clearTimeout(timeout); resolve(); }
      });
    });
    await Promise.all([ready(firstSocket, firstToken), ready(secondSocket, secondToken)]);
    const transferId = randomUUID();
    const peerReady = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Ready timeout")), 3_000);
      firstSocket.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.type === "webrtc.ready") { clearTimeout(timeout); resolve(event); }
      });
    });
    secondSocket.send(JSON.stringify({ type: "webrtc.ready", targetUserId: firstId, transferId }));
    const readyEvent = await peerReady;
    expect(readyEvent.userId).toBe(secondId);
    expect(readyEvent.transferId).toBe(transferId);
    const received = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Signal timeout")), 3_000);
      secondSocket.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.type === "webrtc.signal") { clearTimeout(timeout); resolve(event); }
      });
    });
    firstSocket.send(JSON.stringify({ type: "webrtc.signal", targetUserId: secondId, transferId, signal: { type: "offer", sdp: { type: "offer", sdp: "test" } } }));
    const event = await received;
    expect(event.userId).toBe(firstId);
    expect(event.transferId).toBe(transferId);
    firstSocket.close(); secondSocket.close();
  });

  it("blocks a user and removes the friendship", async () => {
    const blocked = await app.inject({ method: "POST", url: `/blocks/${firstId}`, headers: auth(secondToken) });
    expect(blocked.json().blocked).toBe(true);
    const forbidden = await app.inject({ method: "POST", url: `/chat/${secondId}/messages`, headers: auth(firstToken), payload: { text: "Não deve enviar" } });
    expect(forbidden.statusCode).toBe(403);
  });
});
