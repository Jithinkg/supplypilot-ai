import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export function Card({ className, ...props }: ComponentProps<'section'>) { return <section data-slot="card" className={cn('rounded-xl border bg-card shadow-sm', className)} {...props} />; }
export function CardHeader({ className, ...props }: ComponentProps<'div'>) { return <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b px-5 py-5', className)} {...props} />; }
export function CardTitle({ className, ...props }: ComponentProps<'h2'>) { return <h2 className={cn('text-base font-semibold tracking-tight', className)} {...props} />; }
