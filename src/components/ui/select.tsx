// select.tsx — shadcn 호환 Select 컴포넌트 (@base-ui/react 기반)
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (빌드 픽스)

import * as React from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
  disabled?: boolean;
}

function Select({ value, defaultValue, onValueChange, children, disabled }: SelectProps) {
  return (
    <BaseSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v) => onValueChange?.(v as string)}
      disabled={disabled}
    >
      {children}
    </BaseSelect.Root>
  );
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------
function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<'button'>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
        'placeholder:text-muted-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&>span]:line-clamp-1',
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------
function SelectValue({ placeholder }: { placeholder?: string }) {
  return <BaseSelect.Value placeholder={placeholder} />;
}

// ---------------------------------------------------------------------------
// Content (Popup)
// ---------------------------------------------------------------------------
function SelectContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={4}>
        <BaseSelect.Popup
          className={cn(
            'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
            'data-[open]:animate-in data-[closed]:animate-out',
            'data-[open]:fade-in-0 data-[closed]:fade-out-0',
            'data-[open]:zoom-in-95 data-[closed]:zoom-out-95',
            className,
          )}
          {...props}
        >
          <BaseSelect.List className="p-1">
            {children}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------
function SelectItem({
  value,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  return (
    <BaseSelect.Item
      value={value}
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <BaseSelect.ItemIndicator>
          <Check className="h-4 w-4" />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}

// ---------------------------------------------------------------------------
// Label (group label)
// ---------------------------------------------------------------------------
function SelectLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------
function SelectSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
  );
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
};
