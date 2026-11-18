import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
export function Dialog({ open, onOpenChange, title, description, children, wide = false, locked = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; wide?: boolean; locked?: boolean;
}) {
  return <Primitive.Root open={open} onOpenChange={(value) => { if (!locked) onOpenChange(value); }}><Primitive.Portal>
    <Primitive.Overlay className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]" />
    <Primitive.Content className={cn('fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-2xl focus:outline-none', wide && 'max-w-3xl')}>
      <Primitive.Title className="pr-8 text-xl font-semibold">{title}</Primitive.Title>
      <Primitive.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</Primitive.Description>
      {!locked && <Primitive.Close aria-label="Close dialog" className="absolute right-4 top-4 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X className="size-5" /></Primitive.Close>}
      <div className="mt-6">{children}</div>
    </Primitive.Content>
  </Primitive.Portal></Primitive.Root>;
}
