// FootSiteSelector — 좌우 + 발가락 단일 부위 토글 선택기 (풋센터)
// Ticket: T-20260612-foot-CHART-INTAKE-TOGGLE-INPUT
//
// 요청(문지은 대표원장): "좌우+발가락 < 이것만 토글이나 버튼식으로 입력 / Rt 1지 조갑 이런식으로"
// 확정(2026-06-13 01:53): 형식 간소화 — 방향 L/R + 번호 1~5, 'L1'/'R3'(알파벳1+숫자1).
//   상태(조갑/무좀/티눈) 별도선택 없음. 단일 선택(1개만). 치료사 모달(CheckInDetailSheet) 내 직접 선택.
//   저장: check_ins.treatment_memo jsonb 의 foot_site 서브키 = {side, toe} (신규 컬럼 없음).
//
// 표준 일치(sibling PHASE15 / data-architect CONSULT-REPLY MSG-20260612-192934-uuuv):
//   DB엔 구조(shape)만 저장 — 표시문자열('L1') 저장 금지. render는 formatFootSite로 파생.

import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

// ---------------------------------------------------------------------------
// Types & 상수
// ---------------------------------------------------------------------------
export type FootSide = 'L' | 'R';

/** 단일 부위 값 — 좌/우 + 발가락 번호(1~5). 상태/부위 텍스트 없음(reporter 확정 간소화). */
export interface FootSite {
  side: FootSide;
  toe: number; // 1 ~ 5
}

const SIDES: { value: FootSide; label: string }[] = [
  { value: 'L', label: '좌(L)' },
  { value: 'R', label: '우(R)' },
];

const TOES = [1, 2, 3, 4, 5];

// ---------------------------------------------------------------------------
// 파생 렌더 — 표시문자열은 항상 여기서 파생 (DB 저장 금지)
// ---------------------------------------------------------------------------
/** {side:'L', toe:1} → 'L1'. 값 없거나 불완전하면 ''. */
export function formatFootSite(site: FootSite | null | undefined): string {
  if (!site) return '';
  if (site.side !== 'L' && site.side !== 'R') return '';
  if (typeof site.toe !== 'number' || site.toe < 1 || site.toe > 5) return '';
  return `${site.side}${site.toe}`;
}

/**
 * 완전한 값 판정 — side ∈ {L,R} AND toe ∈ 1~5 일 때만 true.
 * 저장 게이트(불완전 값은 DB에 기록하지 않음)의 단일 근거. formatFootSite와 동일 규칙.
 */
export function isCompleteFootSite(site: FootSite | null | undefined): boolean {
  return formatFootSite(site) !== '';
}

/** 임의의 jsonb 값에서 FootSite를 안전 파싱 (treatment_memo.foot_site 로드용). */
export function parseFootSite(raw: unknown): FootSite | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const side = r.side;
  const toe = r.toe;
  if (side !== 'L' && side !== 'R') return null;
  if (typeof toe !== 'number' || toe < 1 || toe > 5) return null;
  return { side, toe };
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------
interface FootSiteSelectorProps {
  value: FootSite | null;
  onChange: (next: FootSite | null) => void;
  disabled?: boolean;
  className?: string;
}

export default function FootSiteSelector({
  value,
  onChange,
  disabled = false,
  className,
}: FootSiteSelectorProps) {
  // 좌/우 선택 — toe 미선택 상태에서도 side 단독 선택 허용.
  //   불완전값(toe=0)은 저장 게이트(isCompleteFootSite=false)에서 차단되어 DB 미기록.
  const setSide = (side: FootSide) => {
    if (disabled) return;
    onChange({ side, toe: value?.toe ?? 0 } as FootSite);
  };
  // 발가락 선택 — side 미선택이면 임의 기본값('L') 자동지정 금지. 방향 먼저 선택을 강제.
  const setToe = (toe: number) => {
    if (disabled) return;
    if (value?.side !== 'L' && value?.side !== 'R') {
      toast.error('방향(좌/우)을 먼저 선택하세요');
      return;
    }
    onChange({ side: value.side, toe });
  };
  const clear = () => {
    if (disabled) return;
    onChange(null);
  };

  const preview = formatFootSite(value);

  return (
    <div className={cn('space-y-2', className)} data-testid="foot-site-selector">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">부위(좌우+발가락)</span>
        {preview ? (
          <span
            className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-mono font-semibold text-teal-700 border border-teal-200"
            data-testid="foot-site-preview"
          >
            {preview}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/70" data-testid="foot-site-empty">
            미선택
          </span>
        )}
        {value && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="ml-auto text-[10px] text-muted-foreground hover:text-destructive transition"
            data-testid="foot-site-clear"
          >
            지우기
          </button>
        )}
      </div>

      {/* 좌/우 토글 — 큰 버튼(태블릿 UX) */}
      <div className="flex gap-1.5">
        {SIDES.map((s) => {
          const active = value?.side === s.value;
          return (
            <button
              key={s.value}
              type="button"
              disabled={disabled}
              onClick={() => setSide(s.value)}
              data-testid={`foot-side-${s.value}`}
              aria-pressed={active}
              className={cn(
                'flex-1 rounded-md border px-3 py-2 text-sm font-semibold transition',
                active
                  ? 'border-teal-500 bg-teal-500 text-white shadow-sm'
                  : 'border-input bg-background text-foreground hover:bg-accent',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* 발가락 1~5 — 단일 선택 */}
      <div className="grid grid-cols-5 gap-1.5">
        {TOES.map((t) => {
          const active = value?.toe === t;
          return (
            <button
              key={t}
              type="button"
              disabled={disabled}
              onClick={() => setToe(t)}
              data-testid={`foot-toe-${t}`}
              aria-pressed={active}
              className={cn(
                'rounded-md border px-0 py-2 text-sm font-semibold tabular-nums transition',
                active
                  ? 'border-teal-500 bg-teal-500 text-white shadow-sm'
                  : 'border-input bg-background text-foreground hover:bg-accent',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}
