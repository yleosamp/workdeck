import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  MYSQL_HOST: z.string().min(1).default("127.0.0.1"),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string(),
  MYSQL_DATABASE: z.string().regex(/^[a-zA-Z0-9_]+$/).default("workdeck"),
  JWT_SECRET: z.string().min(48),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_API_URL: z.string().url().default("http://127.0.0.1:8787"),
  CLIENT_ORIGINS: z.string().default("http://localhost:1420,tauri://localhost"),
  RELEASES_DIR: z.string().min(1).default("./releases"),
  UPDATE_MANIFEST_URL: z.union([z.string().url(), z.literal("")]).default("")
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Configuração inválida no arquivo .env:", parsed.error.flatten().fieldErrors);
  throw new Error("Não foi possível carregar a configuração do Workdeck");
}

export const config = {
  mysql: {
    host: parsed.data.MYSQL_HOST,
    port: parsed.data.MYSQL_PORT,
    user: parsed.data.MYSQL_USER,
    password: parsed.data.MYSQL_PASSWORD,
    database: parsed.data.MYSQL_DATABASE
  },
  jwtSecret: parsed.data.JWT_SECRET,
  host: parsed.data.API_HOST,
  port: parsed.data.API_PORT,
  publicApiUrl: parsed.data.PUBLIC_API_URL,
  clientOrigins: parsed.data.CLIENT_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  releasesDir: parsed.data.RELEASES_DIR,
  updateManifestUrl: parsed.data.UPDATE_MANIFEST_URL || null
};
