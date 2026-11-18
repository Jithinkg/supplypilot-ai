import { paiseSchema, positiveQuantitySchema } from '@supplypilot/contracts';

export function lineTotalPaise(unitPricePaise: number, quantity: number): number {
  return paiseSchema.parse(paiseSchema.min(1).parse(unitPricePaise) * positiveQuantitySchema.parse(quantity));
}

export function sumPaise(values: readonly number[]): number {
  return values.reduce((total, value) => paiseSchema.parse(total + paiseSchema.parse(value)), 0);
}

export function availableBudgetPaise(allocatedPaise: number, reservedPaise: number): number {
  return paiseSchema.parse(paiseSchema.parse(allocatedPaise) - paiseSchema.parse(reservedPaise));
}

export function affordability(totalPaise: number, availablePaise: number) {
  paiseSchema.parse(totalPaise);
  paiseSchema.parse(availablePaise);
  return { overBudget: totalPaise > availablePaise, shortfallPaise: Math.max(0, totalPaise - availablePaise) };
}
