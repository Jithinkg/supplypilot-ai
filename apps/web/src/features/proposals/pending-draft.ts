import { createProposalSchema, idempotencyKeySchema } from '@supplypilot/contracts';
import { z } from 'zod';

const pendingSchema = z.object({ userId: z.uuid(), key: idempotencyKeySchema, input: createProposalSchema }).strict();
export type PendingDraft = z.infer<typeof pendingSchema>;
const storageKey = (userId: string) => `supplypilot.pendingDraft.${userId}`;
export function readPendingDraft(userId: string): PendingDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = pendingSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.userId === userId ? parsed.data : null;
  } catch { return null; }
}
export function savePendingDraft(value: PendingDraft) {
  sessionStorage.setItem(storageKey(value.userId), JSON.stringify(pendingSchema.parse(value)));
}
export function clearPendingDraft(userId: string) { sessionStorage.removeItem(storageKey(userId)); }
