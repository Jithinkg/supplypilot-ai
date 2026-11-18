const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const money = (paise: number) => currency.format(paise / 100);
export function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}
export function stockoutDays(days: number | null) {
  if (days === null) return 'No recent demand';
  return `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(days)} days`;
}
export function pageNumber(value: string | null) {
  const page = Number(value ?? '1');
  return Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1;
}
