// RxCountInput — 처방 횟수 입력 (숫자만 + "회" 외부 suffix 라벨)
// Ticket: T-20260603-foot-RX-CHART-FOLLOWUP3 C-2-5 (#9-1 현장확정, 문지은 대표원장)
//   - 입력값에는 숫자만 저장(예: 3). "회"는 값에 포함하지 않고 표시 라벨로만 사용.
//   - 빈칸이면 null(미입력). 음수/소수 방지(정수 0 이상).
//   - 기존 frequency('1일 3회' 자유텍스트=용법)는 분해하지 않고 별도 칸으로 신설.
// T-20260609-foot-DRUG-DOSAGE-UI-FIX AC8-1: "회" 라벨을 입력 박스 안(배경 overlay)에서
//   박스 바깥(우측 suffix)으로 이동. 박스 안에는 숫자만. 저장값/스키마 불변(AC8-3).
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface RxCountInputProps {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
  // T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL Part D usability: 호출부에서 입력박스 높이/폭/폰트 오버라이드(갤탭 터치 타깃 확보).
  //   기본 미전달 시 종전 h-7 text-xs 그대로 유지 → 타 surface(SuperPhrases/ItemRow/MedicalChart) 회귀0. cn(tailwind-merge)으로 충돌 클래스 dedupe.
  inputClassName?: string;
  disabled?: boolean; // T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-4: 차트 읽기전용 모드
  // T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN AC6 (문지은 대표원장): 진료차트 처방내역 테이블에서
  //   "셀 숫자전용" 요청 → 이 surface에서만 '회' suffix 라벨을 숨긴다. 기본 false(타 surface는 종전대로 '회' 표시·미접촉).
  hideSuffix?: boolean;
}

export default function RxCountInput({ value, onChange, className, inputClassName, disabled, hideSuffix }: RxCountInputProps) {
  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
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
        className={cn(
          'h-7 text-xs mt-0.5 flex-1 min-w-0 text-center disabled:opacity-100 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
          inputClassName,
        )}
        data-testid="rx-count-input"
      />
      {/* "회" 라벨 — 입력 박스 바깥(suffix). 값에는 미포함, 표시 전용. hideSuffix면 미표시. */}
      {!hideSuffix && (
        <span
          className="pointer-events-none flex-shrink-0 text-[10px] text-muted-foreground"
          data-testid="rx-count-suffix"
        >
          회
        </span>
      )}
    </div>
  );
}
