import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(60 * 60 * 24 * 30).default(8 * 60 * 60),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  UPLOAD_DIR: z.string().default("./uploads"),
  ML_SERVICE_URL: z.string().url().default("http://localhost:8000"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
});

export const env = schema.parse({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://novo:novo_dev_password@localhost:5432/novo?schema=public",
});