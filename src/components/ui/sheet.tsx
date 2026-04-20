import * as React from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export function Sheet({ open, onOpenChange, children }: SheetProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseDialog.Root>
  );
}

export const SheetTrigger = BaseDialog.Trigger;
export const SheetClose = BaseDialog.Close;

export function SheetContent({
  className,
  side = 'right',
  children,
}: {
  className?: string;
  side?: 'left' | 'right';
  children?: React.ReactNode;
}) {
  const sideClass =
    side === 'right'
      ? 'right-0 top-0 h-full w-full max-w-md border-l data-[open]:slide-in-from-right data-[closed]:slide-out-to-right'
      : 'left-0 top-0 h-full w-full max-w-md border-r data-[open]:slide-in-from-left data-[closed]:slide-out-to-left';
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
      <BaseDialog.Popup
        className={cn(
          'fixed z-50 bg-background p-6 shadow-lg focus:outline-none overflow-y-auto',
          'data-[open]:animate-in data-[closed]:animate-out',
          sideClass,
          className,
        )}
      >
        <BaseDialog.Close className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </BaseDialog.Close>
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 mb-4', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <BaseDialog.Title className={cn('text-lg font-semibold leading-none', className)} {...props} />
  );
}
