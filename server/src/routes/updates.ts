import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";

const releaseEntrySchema = z.object({
  signature: z.string().min(1),
  url: z.string().url().optional(),
  file: z.string().min(1).optional()
}).refine((entry) => entry.url || entry.file, "A release precisa de url ou file");

const releaseManifestSchema = z.object({
  version: z.string().min(1),
  notes: z.string().optional().default(""),
  pub_date: z.string().optional(),
  platforms: z.record(z.string(), releaseEntrySchema)
});

type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

async function loadManifest(): Promise<ReleaseManifest | null> {
  try {
    if (config.updateManifestUrl) {
      const response = await fetch(config.updateManifestUrl, { signal: AbortSignal.timeout(8_000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Manifesto remoto respondeu ${response.status}`);
      return releaseManifestSchema.parse(await response.json());
    }
    const raw = await readFile(path.resolve(config.releasesDir, "latest.json"), "utf8");
    return releaseManifestSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function numericVersion(version: string) {
  return version.replace(/^v/i, "").split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(candidate: string, current: string) {
  const next = numericVersion(candidate);
  const installed = numericVersion(current);
  const length = Math.max(next.length, installed.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (next[index] ?? 0) - (installed[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export async function updateRoutes(app: FastifyInstance) {
  app.get("/updates/:target/:arch/:currentVersion", async (request, reply) => {
    const { target, arch, currentVersion } = z.object({
      target: z.enum(["windows", "darwin", "linux"]),
      arch: z.string().regex(/^[a-zA-Z0-9_-]+$/),
      currentVersion: z.string().min(1).max(64)
    }).parse(request.params);
    const manifest = await loadManifest();
    if (!manifest || !isNewerVersion(manifest.version, currentVersion)) return reply.code(204).send();
    const platform = manifest.platforms[`${target}-${arch}`];
    if (!platform) return reply.code(204).send();
    const downloadUrl = platform.url ?? new URL(
      `/updates/files/${encodeURIComponent(path.basename(platform.file!))}`,
      `${config.publicApiUrl.replace(/\/$/, "")}/`
    ).toString();
    return {
      version: manifest.version,
      notes: manifest.notes,
      pub_date: manifest.pub_date ?? new Date().toISOString(),
      url: downloadUrl,
      signature: platform.signature
    };
  });

  app.get("/updates/files/:file", async (request, reply) => {
    const { file } = z.object({ file: z.string().min(1).max(240) }).parse(request.params);
    if (file !== path.basename(file)) return reply.code(404).send({ error: "Arquivo não encontrado" });
    const absoluteFile = path.resolve(config.releasesDir, file);
    const releasesRoot = `${path.resolve(config.releasesDir)}${path.sep}`;
    if (!absoluteFile.startsWith(releasesRoot)) return reply.code(404).send({ error: "Arquivo não encontrado" });
    try {
      const details = await stat(absoluteFile);
      if (!details.isFile()) return reply.code(404).send({ error: "Arquivo não encontrado" });
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Length", details.size);
      reply.header("Content-Disposition", `attachment; filename="${path.basename(file)}"`);
      return reply.send(createReadStream(absoluteFile));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply.code(404).send({ error: "Arquivo não encontrado" });
      throw error;
    }
  });
}
