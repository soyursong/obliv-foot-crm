/**
 * AmountInput — 천 단위 쉼표 자동 포맷팅 래퍼
 *
 * T-20260525-foot-AMOUNT-COMMA (통합 티켓)
 *   AC-1: 숫자 입력 시 천 단위 쉼표 자동 삽입 (150000 → 150,000)
 *   AC-2: 입력 중 커서 위치 자연스럽게 유지 (쉼표 삽입으로 커서 점프 X)
 *   AC-3: 복사/붙여넣기 시 숫자 추출 후 포맷팅 정상 동작
 *   AC-4: onChange 콜백은 쉼표 제거된 순수 숫자 문자열 전달 (기존 API 무변경)
 *   AC-5: 읽기 전용(readOnly) 시에도 쉼표 포맷팅 일관 적용
 *   AC-6: 음수(환불) 표시 시 마이너스 부호 + 쉼표 정상 표시 (-150,000)
 *   AC-7: 0 값은 빈 문자열 반환 → placeholder 자연 표시
 *
 * 사용법:
 *   <AmountInput value={amount} onChange={v => setAmount(Number(v))} />
 *   - value: number | string (숫자 또는 숫자 문자열)
 *   - onChange: (rawValue: string) => void — 쉼표 없는 순수 숫자 문자열 전달
 *   - 나머지 props: Input 컴포넌트와 동일 (className, placeholder, disabled, readOnly 등)
 */
import * as React from 'react';
import { Input } from './input';
import { cn } from '@/lib/utils';

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * 숫자 → 천 단위 쉼표 표시 문자열
 *   150000  → "150,000"
 *  -150000  → "-150,000"  (AC-6: 음수/환불 표시)
 *   0 / ''  → ""          (AC-7: 0은 빈 문자열 → placeholder 자연 표시)
 */
export function formatAmountDisplay(raw: string | number | undefined | null): string {
  if (raw === '' || raw === undefined || raw === null) return '';
  const str = String(raw);
  // AC-6: 음수 부호 보존
  const isNegative = str.startsWith('-');
  const numStr = str.replace(/[^0-9]/g, '');
  if (!numStr) return '';
  const num = parseInt(numStr, 10);
  // AC-7: 0 → 빈 문자열 (placeholder가 자연스럽게 표시되도록)
  if (num === 0) return '';
  const formatted = num.toLocaleString('ko-KR');
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * 표시 문자열 → 순수 숫자 문자열 (쉼표 제거)
 *   "150,000" → "150000"
 * 입력 필드용: 마이너스는 strip (사용자가 음수 직접 입력 불가)
 */
export function parseAmountRaw(display: string): string {
  return display.replace(/[^0-9]/g, '');
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

type InputProps = React.ComponentPropsWithoutRef<typeof Input>;

interface AmountInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  /** 표시/편집할 금액 값 (number | string) */
  value?: number | string;
  /** 변경 콜백 — 쉼표 제거된 순수 숫자 문자열 전달 (AC-4) */
  onChange?: (rawValue: string) => void;
}

export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ value, onChange, className, ...props }, ref) => {
    // 표시용 포맷 문자열 (쉼표 포함)
    const [display, setDisplay] = React.useState<string>(
      () => formatAmountDisplay(value),
    );

    // 외부 value 변경 시 표시 동기화 (예: 리셋, 외부 업데이트)
    React.useEffect(() => {
      setDisplay(formatAmountDisplay(value));
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseAmountRaw(e.target.value);

      // AC-2: 커서 위치 보존 계산
      // 쉼표 삽입 전후 커서 offset 차이를 보정
      const selectionStart = e.target.selectionStart ?? 0;
      const oldDisplay = display;
      const newDisplay = formatAmountDisplay(raw);

      // 쉼표 수 차이 = 커서 이동 보정값
      const oldCommasBefore = (oldDisplay.slice(0, selectionStart).match(/,/g) ?? []).length;
      const rawCursorPos = selectionStart - oldCommasBefore; // raw 문자열 기준 커서
      const newCommasBefore = (newDisplay.slice(0, rawCursorPos).match(/,/g) ?? []).length;
      const newCursorPos = rawCursorPos + newCommasBefore;

      setDisplay(newDisplay);
      onChange?.(raw);

      // AC-2: 다음 렌더 후 커서 위치 복원
      requestAnimationFrame(() => {
        if (ref && 'current' in ref && ref.current) {
          const safePos = Math.min(newCursorPos, newDisplay.length);
          ref.current.setSelectionRange(safePos, safePos);
        }
      });
    };

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        className={cn('text-right tabular-nums', className)}
        {...props}
      />
    );
  },
);

AmountInput.displayName = 'AmountInput';
