import * as React from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { cn } from '@/lib/utils';

export function Tabs({
  value,
  onValueChange,
  defaultValue,
  className,
  children,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  defaultValue?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(v) => onValueChange?.(v as string)}
      defaultValue={defaultValue}
      className={className}
    >
      {children}
    </BaseTabs.Root>
  );
}

export function TabsList({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <BaseTabs.List
      className={cn(
        'inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
    >
      {children}
    </BaseTabs.List>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <BaseTabs.Tab
      value={value}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all',
        'data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm',
        className,
      )}
    >
      {children}
    </BaseTabs.Tab>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <BaseTabs.Panel value={value} className={cn('mt-2', className)}>
      {children}
    </BaseTabs.Panel>
  );
}
