// RxCountInput — 처방 횟수 입력 (숫자만 + "회" 배경 suffix)
// Ticket: T-20260603-foot-RX-CHART-FOLLOWUP3 C-2-5 (#9-1 현장확정, 문지은 대표원장)
//   - 입력값에는 숫자만 저장(예: 3). "회"는 값에 포함하지 않고 필드 우측 배경(suffix)에만 표기.
//   - 빈칸이면 null(미입력). 음수/소수 방지(정수 0 이상).
//   - 기존 frequency('1일 3회' 자유텍스트=용법)는 분해하지 않고 별도 칸으로 신설.
import { Input } from '@/components/ui/input';

interface RxCountInputProps {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
  disabled?: boolean; // T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-4: 차트 읽기전용 모드
}

export default function RxCountInput({ value, onChange, className, disabled }: RxCountInputProps) {
  return (
    <div className="relative">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === '') return onChange(null);
          const n = Math.max(0, Math.floor(Number(raw)));
          onChange(Number.isFinite(n) ? n : null);
        }}
        placeholder="3"
        className={`h-7 text-xs mt-0.5 pr-6 disabled:opacity-100 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed ${className ?? ''}`}
        data-testid="rx-count-input"
      />
      {/* "회" 배경 suffix — 값에는 미포함, 표시만 */}
      <span className="pointer-events-none absolute right-2 top-1/2 mt-[2px] -translate-y-1/2 text-[10px] text-muted-foreground">
        회
      </span>
    </div>
  );
}
