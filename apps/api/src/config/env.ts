import './load-env.js';
import { z } from 'zod';

export const FREE_MODEL = 'google/gemma-4-31b-it:free' as const;
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value), 'PostgreSQL URL required'),
  OPENROUTER_MODEL: z.literal(FREE_MODEL).default(FREE_MODEL),
  RAG_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  ASSISTANT_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.45),
  OPENROUTER_API_KEY: z.string().optional(),
});

export function readEnv() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Do not include input values, which may contain secrets.
    throw new Error(`Invalid environment: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  return result.data;
}
