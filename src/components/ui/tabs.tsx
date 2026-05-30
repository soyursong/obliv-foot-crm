import * as React from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { cn } from '@/lib/utils';

// data-* 패스스루: E2E testid(data-testid) 등 부가 속성을 underlying DOM으로 전달.
// (Base UI 마이그레이션 시 누락 → tab testid 전부 소실 회귀 방지)
type DataAttrs = { [key: `data-${string}`]: string | undefined };

export function Tabs({
  value,
  onValueChange,
  defaultValue,
  className,
  children,
  ...rest
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  defaultValue?: string;
  className?: string;
  children?: React.ReactNode;
} & DataAttrs) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(v) => onValueChange?.(v as string)}
      defaultValue={defaultValue}
      className={className}
      {...rest}
    >
      {children}
    </BaseTabs.Root>
  );
}

export function TabsList({
  className,
  children,
  ...rest
}: { className?: string; children?: React.ReactNode } & DataAttrs) {
  return (
    <BaseTabs.List
      className={cn(
        'inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </BaseTabs.List>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  ...rest
}: {
  value: string;
  className?: string;
  children?: React.ReactNode;
} & DataAttrs) {
  return (
    <BaseTabs.Tab
      value={value}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all',
        'data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </BaseTabs.Tab>
  );
}

export function TabsContent({
  value,
  className,
  children,
  ...rest
}: {
  value: string;
  className?: string;
  children?: React.ReactNode;
} & DataAttrs) {
  return (
    <BaseTabs.Panel value={value} className={cn('mt-2', className)} {...rest}>
      {children}
    </BaseTabs.Panel>
  );
}
