import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export function Badge({ className, ...props }: ComponentProps<'span'>) { return <span data-slot="badge" className={cn('inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide', className)} {...props} />; }
