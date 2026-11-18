import { createHash } from 'node:crypto';
import { salesWindow } from '../src/services/inventory.js';
import { z } from 'zod';

export const DEMO_SEED = 20261116;
export function demoId(name: string) {
  const hex = createHash('sha256').update(`supplypilot-demo:${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function referenceDate(value?: string) {
  if (!value) return new Date();
  z.iso.date().parse(value);
  return new Date(`${value}T00:00:00.000Z`);
}

export function demoData(asOf: Date) {
  const window = salesWindow(asOf);
  const categories = ['Coffee Beans', 'Tea Leaves', 'Rice', 'Flour', 'Cooking Oil', 'Paper Cups', 'Packing Boxes', 'Cleaning Liquid', 'Nitrile Gloves', 'Thermal Labels'];
  const suppliers = Array.from({ length: 10 }, (_, i) => ({ id: demoId(`supplier-${i}`), code: `SUP-${String(i + 1).padStart(3, '0')}`, name: ['Harbor', 'Cedar', 'Summit', 'River', 'Atlas', 'Meadow', 'Northstar', 'Orchid', 'Horizon', 'Evergreen'][i] + ' Supplies', active: true }));
  const sales: { id: string; productId: string; date: Date; quantity: number }[] = [];
  const products = Array.from({ length: 50 }, (_, i) => {
    const id = demoId(`product-${i}`);
    const demand = Array.from({ length: 30 }, (_, day) => i < 2 ? 0 : i < 6 ? 10 : 3 + (DEMO_SEED + i * 37 + day * 17) % 15);
    const total = demand.reduce((sum, quantity) => sum + quantity, 0);
    demand.forEach((quantity, day) => {
      const date = new Date(window.start.getTime() + day * 86_400_000);
      sales.push({ id: demoId(`sale-${i}-${date.toISOString().slice(0, 10)}`), productId: id, date, quantity });
    });
    const stockQuantity = i === 0 ? 0 : i === 1 ? 20 : i === 2 ? 70 : i === 3 ? 140 : i === 4 ? 60 : i === 5 ? 100 : Math.floor(total * [0, 0.1, 0.3, 0.5, 0.8, 1.2][i % 6]!);
    return { id, sku: `SP-${String(i + 1).padStart(3, '0')}`, name: `${categories[i % 10]} ${Math.floor(i / 10) + 1}`, unit: 'pack', stockQuantity };
  });
  const quotes = products.flatMap((product, i) => [0, 1, 2].map((j) => ({
    id: demoId(`quote-${i}-${j}`), productId: product.id, supplierId: suppliers[(i + j * 3) % 10]!.id,
    unitPricePaise: 10_000 + i * 271 + [4_000, 1_500, 0][j]!, leadTimeDays: [2, 6, 12][j]!,
  })));
  return { products, suppliers, sales, quotes, ...window };
}
