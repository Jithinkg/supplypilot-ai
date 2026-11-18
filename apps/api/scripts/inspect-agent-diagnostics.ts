import '../src/config/load-env.js';
import { createDatabase } from '../src/db/client.js';
import { readEnv } from '../src/config/env.js';
import { z } from 'zod';
const db = createDatabase(readEnv().DATABASE_URL);
const safe = z.object({ code: z.string().optional(), stage: z.string().optional(), toolCalls: z.number().optional(), durationMs: z.number().optional(), inputTokens: z.number().optional(), outputTokens: z.number().optional() });
try {
  const runs = await db.agentRun.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, intent: true, capturedRole: true, createdAt: true, error: true } });
  for (const run of runs) {
    const events = await db.auditEvent.findMany({ where: { runId: run.id }, orderBy: { createdAt: 'desc' }, take: 2, select: { metadata: true } });
    console.log({ id: run.id, status: run.status, intent: run.intent, role: run.capturedRole, createdAt: run.createdAt, diagnostic: safe.parse(run.error ?? {}), events: events.map((event) => safe.parse(event.metadata)) });
  }
} finally { await db.$disconnect(); }
