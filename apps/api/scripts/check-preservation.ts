import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { readEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';

const [mode, path] = process.argv.slice(2);
if (!['record', 'verify'].includes(mode ?? '') || !path) throw new Error('Usage: check-preservation.ts record|verify <snapshot-path>');
const db = createDatabase(readEnv().DATABASE_URL);
try {
  const tables = {
    users: await db.user.findMany({ orderBy: { id: 'asc' } }), products: await db.product.findMany({ orderBy: { id: 'asc' } }),
    sales: await db.dailySale.findMany({ orderBy: { id: 'asc' } }), suppliers: await db.supplier.findMany({ orderBy: { id: 'asc' } }),
    quotes: await db.supplierQuote.findMany({ orderBy: { id: 'asc' } }), budgets: await db.budget.findMany({ orderBy: { id: 'asc' } }),
    proposals: await db.purchaseProposal.findMany({ orderBy: { id: 'asc' } }), lines: await db.proposalLine.findMany({ orderBy: { id: 'asc' } }),
    reservations: await db.budgetReservation.findMany({ orderBy: { id: 'asc' } }),
    businessAudit: await db.auditEvent.findMany({ where: { entityType: 'PurchaseProposal' }, orderBy: { id: 'asc' } }),
    idempotency: await db.idempotencyRecord.findMany({ orderBy: { id: 'asc' } }),
  };
  const snapshot = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]));
  if (mode === 'record') { await writeFile(path, JSON.stringify(snapshot, null, 2), { mode: 0o600 }); console.log('Recorded business-data fingerprints without exporting record contents.'); }
  else {
    if (JSON.stringify(JSON.parse(await readFile(path, 'utf8'))) !== JSON.stringify(snapshot)) throw new Error('Preservation check failed: business records changed.');
    console.log('PASS: users, inventory, sales, suppliers, quotes, budgets, proposals, lines, reservations, business audit and idempotency records are unchanged.');
  }
} finally { await db.$disconnect(); }
