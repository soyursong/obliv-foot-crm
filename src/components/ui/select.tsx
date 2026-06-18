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
// T-20260619-foot-RESVPOPUP-DETAIL-REVERIFY-4FIX AC1 (담당자 UUID 2회차 회귀 근본수정):
//   Base UI Select.Value 는 선택값 → 라벨 해석을 "등록된 Select.Item" 목록(store.items)에서 찾는다.
//   그런데 Select.Item 은 Popup 이 처음 열릴 때 비로소 마운트·등록된다(lazy). 닫힌 트리거 상태에서는
//   items 가 비어 resolveSelectedLabel 이 fallback → serializeValue(value) = "raw UUID" 를 그대로 렌더.
//   (6FIX·8FIX 가 매칭 SelectItem 을 추가했어도, 드롭다운을 열기 전엔 등록되지 않아 UUID 가 재노출 = 2회차 회귀 원인)
//   → children 을 render-function 으로 받을 수 있게 확장. 호출부가 value→표시명을 직접 해석해
//     아이템 등록 타이밍과 무관하게 항상 이름을 표기(UUID 절대 비노출). 기존 호출부(placeholder만)는 무변경.
function SelectValue({
  placeholder,
  children,
}: {
  placeholder?: string;
  children?: (value: string) => React.ReactNode;
}) {
  return (
    <BaseSelect.Value placeholder={placeholder}>
      {children ? (value) => children(value as string) : undefined}
    </BaseSelect.Value>
  );
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
      {/* T-20260603-foot-RX-CHART-FOLLOWUP3 C-4: 처방세트 등 Select 드롭다운 정상화.
          - alignItemWithTrigger=false → 팝업이 트리거 위에 겹쳐 정렬되는 기본동작 해제
            (Dialog 내부/화면 가장자리에서 드롭다운이 어긋나 보이는 "이상함" 증상 근본 수정)
          - side/align/collisionPadding 고정 → 항상 트리거 바로 아래에서 예측가능하게 열림
          - min-w=anchor-width → 트리거 너비에 맞춤 / max-h=available-height → 목록 길어도 잘림 없이 스크롤 */}
      {/* T-20260606-foot-SUPER-PHRASE-CHART-LINK-FIX AC-4 (드롭다운 뒤로열림 근본 수정):
          기존 z-50 은 Dialog(z-[90])·Sheet/CustomerChartSheet(z-[70]) 내부에서 열리면 그 뒤로 깔려
          '상용구 불러오기' 등 Select 드롭다운이 가려져 선택 불가였음(임상경과·빠른처방·처방세트 전 화면 공통).
          → 공통 컴포넌트 단일 수정으로 z-[200] 격상(// 슈퍼상용구 팝오버와 동일 레이어). 화면별 z-index 땜질 제거. */}
      <BaseSelect.Positioner
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        alignItemWithTrigger={false}
        className="z-[200]"
      >
        <BaseSelect.Popup
          className={cn(
            'z-[200] min-w-[max(8rem,var(--anchor-width))] max-w-[var(--available-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
            'data-[open]:animate-in data-[closed]:animate-out',
            'data-[open]:fade-in-0 data-[closed]:fade-out-0',
            'data-[open]:zoom-in-95 data-[closed]:zoom-out-95',
            className,
          )}
          {...props}
        >
          <BaseSelect.List className="max-h-[min(var(--available-height),20rem)] overflow-y-auto p-1">
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
