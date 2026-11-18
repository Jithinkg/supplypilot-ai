import { readEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';
import { createReadService } from '../src/services/reads.js';
import { inventoryQuerySchema } from '@supplypilot/contracts';
import { referenceDate } from '../prisma/demo-data.js';

const db = createDatabase(readEnv().DATABASE_URL);
try {
  await db.$queryRaw`SELECT 1`;
  const staff = await db.user.count({ where: { role: 'STAFF', active: true } });
  const managers = await db.user.count({ where: { role: 'MANAGER', active: true } });
  if (!staff || !managers) throw new Error('Seeded accounts missing. Run npm run db:seed.');
  const counts = { products: await db.product.count(), suppliers: await db.supplier.count(), sales: await db.dailySale.count(), quotes: await db.supplierQuote.count() };
  if (counts.products !== 50 || counts.suppliers !== 10 || counts.sales !== 1500 || counts.quotes !== 150) throw new Error('Business seed counts do not match.');
  const reads = createReadService(db, () => referenceDate(process.env.SEED_REFERENCE_DATE));
  const budget = await reads.budget();
  const reservations = await db.budgetReservation.aggregate({ where: { budgetId: budget.budgetId }, _sum: { amountPaise: true } });
  if (budget.allocatedPaise !== 50_000_000 || budget.reservedPaise !== (reservations._sum.amountPaise ?? 0)) throw new Error('Budget/reservations inconsistent.');
  const risks = await reads.inventory(inventoryQuerySchema.parse({ pageSize: 100 }));
  console.log('Verified PostgreSQL, STAFF/MANAGER, business seed and budget consistency:', { ...counts, ...risks.summary, availableBudgetPaise: budget.availablePaise, windowStart: risks.windowStart, windowEnd: risks.windowEnd });
} catch {
  console.error('Database verification failed. Check PostgreSQL, DATABASE_URL, migrations, full demo seed and reservation consistency.');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
