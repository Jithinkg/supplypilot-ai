import { z } from 'zod';
import { assistantInputSchema, idempotencyKeySchema, roleSchema } from '@supplypilot/contracts';
const schema = z.object({ userId: z.uuid(), role: roleSchema, key: idempotencyKeySchema, input: assistantInputSchema, runId: z.uuid().optional() }).strict();
export type PendingAssistant = z.infer<typeof schema>;
const storageKey = (userId: string) => `supplypilot.pendingAssistant.${userId}`;
export function readPendingAssistant(userId: string): PendingAssistant | null {
  try { const raw = sessionStorage.getItem(storageKey(userId)); const value = schema.safeParse(raw ? JSON.parse(raw) : null); return value.success && value.data.userId === userId ? value.data : null; } catch { return null; }
}
export function savePendingAssistant(value: PendingAssistant) { sessionStorage.setItem(storageKey(value.userId), JSON.stringify(schema.parse(value))); }
export function clearPendingAssistant(userId: string) { sessionStorage.removeItem(storageKey(userId)); }
