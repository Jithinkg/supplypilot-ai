import '../src/config/load-env.js';
import { z } from 'zod';
import argon2 from 'argon2';
import { readEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';
import { seedBusinessData } from './seed-business.js';
import { referenceDate } from './demo-data.js';

const secret = z.string().min(16).max(128).refine((value) => !value.startsWith('replace-'), 'Replace placeholder passwords');
const parsed = z.object({
  SEED_STAFF_EMAIL: z.email().transform((value) => value.toLowerCase()),
  SEED_STAFF_PASSWORD: secret,
  SEED_MANAGER_EMAIL: z.email().transform((value) => value.toLowerCase()),
  SEED_MANAGER_PASSWORD: secret,
  SEED_REFERENCE_DATE: z.iso.date().optional(),
}).refine((value) => value.SEED_STAFF_EMAIL !== value.SEED_MANAGER_EMAIL, 'Accounts need different emails').safeParse(process.env);
if (!parsed.success) {
  console.error('Configure distinct seed emails, non-placeholder passwords of 16–128 characters, and an optional valid YYYY-MM-DD SEED_REFERENCE_DATE.');
  process.exit(1);
}
const env = readEnv();
if (env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
const db = createDatabase(env.DATABASE_URL);
try {
  const input = parsed.data;
  const accounts = [
    { email: input.SEED_STAFF_EMAIL, password: input.SEED_STAFF_PASSWORD, role: 'STAFF' as const },
    { email: input.SEED_MANAGER_EMAIL, password: input.SEED_MANAGER_PASSWORD, role: 'MANAGER' as const },
  ];
  const users: { id: string; role: 'STAFF' | 'MANAGER' }[] = [];
  for (const account of accounts) {
    const passwordHash = await argon2.hash(account.password, { type: argon2.argon2id });
    const user = await db.$transaction(async (tx) => {
      const user = await tx.user.upsert({ where: { email: account.email }, create: { email: account.email, role: account.role, passwordHash }, update: { role: account.role, passwordHash, active: true } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      return user;
    });
    users.push(user);
  }
  const staff = users.find((user) => user.role === 'STAFF');
  const manager = users.find((user) => user.role === 'MANAGER');
  if (!staff || !manager) throw new Error('Seed accounts missing.');
  const summary = await seedBusinessData(db, staff.id, manager.id, referenceDate(input.SEED_REFERENCE_DATE));
  console.log('Seeded STAFF/MANAGER; prior sessions revoked. Business seed:', summary);
} finally { await db.$disconnect(); }
