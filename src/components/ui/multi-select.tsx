// multi-select.tsx — 체크박스 복수 선택 드롭다운 (@base-ui/react/popover + checkbox 기반, 신규 npm 0)
// Ticket: T-20260807-foot-RXHIST-DRUG-MULTISELECT
//   기존 단일 Select(select.tsx)의 복수-선택 형제. 태블릿 UX(큰 버튼·teal) + z-[200] 레이어 규약 계승.
//   value = 선택된 문자열 배열(제어형). onChange 로 전체 배열 반환.

import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { Checkbox } from '@base-ui/react/checkbox';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: React.ReactNode;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** 트리거에 표시할 요약 텍스트를 커스텀. 미지정 시 기본 규칙(0개=placeholder / 1개=라벨 / N개="A 외 N-1") */
  triggerLabel?: (selected: string[]) => React.ReactNode;
  'data-testid'?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = '선택하세요',
  disabled,
  className,
  triggerLabel,
  'data-testid': testId,
}: MultiSelectProps) {
  const selectedSet = React.useMemo(() => new Set(value), [value]);

  const toggle = (v: string) => {
    if (selectedSet.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  const summary = (() => {
    if (triggerLabel) return triggerLabel(value);
    if (value.length === 0) return <span className="text-muted-foreground">{placeholder}</span>;
    const firstLabel =
      options.find((o) => o.value === value[0])?.label ?? value[0];
    if (value.length === 1) return firstLabel;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="line-clamp-1">{firstLabel}</span>
        <span className="shrink-0 rounded-full bg-teal-100 px-1.5 text-[11px] font-medium text-teal-700">
          외 {value.length - 1}
        </span>
      </span>
    );
  })();

  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={disabled}
        data-testid={testId}
        className={cn(
          'flex h-9 min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          '[&>span]:line-clamp-1',
          className,
        )}
      >
        <span className="flex-1 text-left">{summary}</span>
        {value.length > 0 && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="선택 해제"
            data-testid={testId ? `${testId}-clear` : undefined}
            className="shrink-0 rounded-sm p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
          >
            <X className="size-4" />
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[200]"
        >
          <Popover.Popup
            className={cn(
              'z-[200] min-w-[max(12rem,var(--anchor-width))] max-w-[var(--available-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
              'data-[open]:animate-in data-[closed]:animate-out',
              'data-[open]:fade-in-0 data-[closed]:fade-out-0',
              'data-[open]:zoom-in-95 data-[closed]:zoom-out-95',
            )}
          >
            <div className="max-h-[min(var(--available-height),22rem)] overflow-y-auto p-1">
              {options.length === 0 ? (
                <div className="px-3 py-6 text-center text-[13px] text-gray-400">
                  선택할 항목이 없습니다
                </div>
              ) : (
                options.map((o) => {
                  const checked = selectedSet.has(o.value);
                  return (
                    <label
                      key={o.value}
                      data-testid="multi-select-option"
                      data-value={o.value}
                      data-checked={checked ? 'true' : 'false'}
                      className={cn(
                        'flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm',
                        'hover:bg-teal-50 aria-checked:bg-teal-50/60',
                      )}
                      aria-checked={checked}
                    >
                      <Checkbox.Root
                        checked={checked}
                        onCheckedChange={() => toggle(o.value)}
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded border',
                          checked
                            ? 'border-teal-600 bg-teal-600 text-white'
                            : 'border-gray-300 bg-white',
                        )}
                      >
                        <Checkbox.Indicator>
                          <Check className="size-3.5" strokeWidth={3} />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      <span className="flex-1">{o.label}</span>
                    </label>
                  );
                })
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
