// FootToeIllustration — 양발 발가락 일러스트(SVG) 멀티선택 치료부위 선택기 (풋센터)
// Ticket: T-20260613-foot-FIELDBATCH-CHECKIN-CHART-0613 §item4 (스펙 최종확정 pzp9, 김주연 총괄 confirm 2026-06-14)
//
// 스펙(최종):
//   - 양발 발가락 일러스트(SVG), 발가락 10개(좌 L1~L5 + 우 R1~R5) 전부 클릭 선택 가능.
//   - 중복(복수) 선택 허용 — 여러 발가락 동시 ON.
//   - 일러스트=개발팀 직접 제작(외부 이미지 의존성 0, pure inline SVG + Tailwind).
//   - 패키지명 조건 없음 — 호출처(2번차트 패키지 탭)에서 항상 고정 노출.
//
// 저장 shape: FootSite { side:'L'|'R', toe:1~5 } 배열 — FootSiteSelector 헬퍼(parse/format/toggle) 재사용.
//   DB: check_ins.treatment_memo.foot_sites jsonb 배열(신규 컬럼 0, 스키마 변경 없음).

import { cn } from '@/lib/utils';
import {
  type FootSite,
  type FootSide,
  hasFootSite,
  toggleFootSite,
  formatFootSites,
} from '@/components/FootSiteSelector';

// 발가락 번호: 1=엄지(가장 큼) ~ 5=새끼(가장 작음).
// 기준 좌표 = "엄지가 왼쪽"인 발(=우측 발 R). 좌측 발(L)은 x 미러.
const VB_W = 132;
const VB_H = 176;

interface ToePos {
  toe: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

// 엄지(1)가 왼쪽에 오는 배치(우측 발 기준). 위쪽 아치형 배열.
const BASE_TOES: ToePos[] = [
  { toe: 1, cx: 33, cy: 42, rx: 16, ry: 19 },
  { toe: 2, cx: 63, cy: 28, rx: 11.5, ry: 15 },
  { toe: 3, cx: 86, cy: 26, rx: 10.5, ry: 14 },
  { toe: 4, cx: 106, cy: 31, rx: 9.5, ry: 12.5 },
  { toe: 5, cx: 121, cy: 43, rx: 8, ry: 11 },
];

function toePositions(side: FootSide): ToePos[] {
  // 좌측 발(L)은 엄지가 오른쪽(안쪽)에 오도록 x 미러. 우측 발(R)은 기준 그대로.
  if (side === 'R') return BASE_TOES;
  return BASE_TOES.map((t) => ({ ...t, cx: VB_W - t.cx }));
}

function footBody(side: FootSide) {
  // 발볼(forefoot) + 뒤꿈치(heel) 두 타원 겹쳐 발 모양. 미러 시 cx 반전.
  const mx = (x: number) => (side === 'R' ? x : VB_W - x);
  return {
    ball: { cx: mx(70), cy: 98, rx: 52, ry: 40 },
    heel: { cx: mx(74), cy: 150, rx: 30, ry: 25 },
  };
}

interface FootSvgProps {
  side: FootSide;
  value: FootSite[];
  onToggle?: (side: FootSide, toe: number) => void;
  readOnly?: boolean;
}

function FootSvg({ side, value, onToggle, readOnly }: FootSvgProps) {
  const body = footBody(side);
  const toes = toePositions(side);
  return (
    <div className="flex flex-col items-center gap-1" data-testid={`foot-${side}`}>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-[176px] w-[132px] select-none"
        role="group"
        aria-label={`${side === 'L' ? '좌측' : '우측'} 발 발가락 선택`}
      >
        {/* 발 본체 — 발볼 + 뒤꿈치 */}
        <ellipse cx={body.ball.cx} cy={body.ball.cy} rx={body.ball.rx} ry={body.ball.ry} fill="#fdf6ec" stroke="#e7d8c3" strokeWidth={2} />
        <ellipse cx={body.heel.cx} cy={body.heel.cy} rx={body.heel.rx} ry={body.heel.ry} fill="#fdf6ec" stroke="#e7d8c3" strokeWidth={2} />
        {/* 발등 살짝 홍조(귀여움) */}
        <ellipse cx={body.ball.cx} cy={body.ball.cy + 6} rx={14} ry={9} fill="#fbe3df" opacity={0.7} />

        {/* 발가락 10개 — 각 toe 클릭 토글 */}
        {toes.map((t) => {
          const active = hasFootSite(value, side, t.toe);
          return (
            <g
              key={t.toe}
              data-testid={`toe-${side}-${t.toe}`}
              data-selected={active ? 'true' : 'false'}
              aria-pressed={active}
              role="button"
              tabIndex={readOnly ? -1 : 0}
              onClick={readOnly ? undefined : () => onToggle?.(side, t.toe)}
              onKeyDown={
                readOnly
                  ? undefined
                  : (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggle?.(side, t.toe);
                      }
                    }
              }
              className={cn(!readOnly && 'cursor-pointer outline-none')}
            >
              <ellipse
                cx={t.cx}
                cy={t.cy}
                rx={t.rx}
                ry={t.ry}
                /* T-20260614-foot-THEME-MONOCHROME-RECOLOR: 활성 발가락 teal→warm(Umber/Taupe) */
                fill={active ? '#6E6353' : '#fdf6ec'}
                stroke={active ? '#443A35' : '#e7d8c3'}
                strokeWidth={2}
                /* 정정: teal 램프 복원(의미색 보류)에 비종속이도록 hover 도 warm(Taupe) 고정 */
                className={cn('transition-colors', !readOnly && 'hover:stroke-[#C5BEA3]')}
              />
              {/* 발톱 하이라이트 */}
              <ellipse cx={t.cx} cy={t.cy - t.ry * 0.35} rx={t.rx * 0.5} ry={t.ry * 0.28} fill={active ? '#C5BEA3' : '#fff7ec'} opacity={0.85} />
              <text
                x={t.cx}
                y={t.cy + 4}
                textAnchor="middle"
                fontSize={t.toe === 1 ? 13 : 11}
                fontWeight={700}
                fill={active ? '#ffffff' : '#6E6353'}
                style={{ pointerEvents: 'none' }}
              >
                {t.toe}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="text-xs font-semibold text-muted-foreground">{side === 'L' ? '좌(L)' : '우(R)'}</span>
    </div>
  );
}

interface FootToeIllustrationProps {
  value: FootSite[];
  onChange?: (next: FootSite[]) => void;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * 양발 발가락 일러스트 멀티선택기.
 * - readOnly: 1번차트 조건부 표시(클릭 불가, 선택값만 노출).
 * - editable: 2번차트 패키지 탭(클릭 토글, 중복선택).
 */
export default function FootToeIllustration({
  value,
  onChange,
  readOnly = false,
  disabled = false,
  className,
}: FootToeIllustrationProps) {
  const ro = readOnly || disabled || !onChange;
  const handleToggle = (side: FootSide, toe: number) => {
    if (ro) return;
    onChange?.(toggleFootSite(value, side, toe));
  };
  const preview = formatFootSites(value);

  return (
    <div className={cn('space-y-2', className)} data-testid="foot-toe-illustration">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">치료부위(발가락)</span>
        {preview ? (
          <span
            className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-mono font-semibold text-teal-700 border border-teal-200"
            data-testid="foot-toe-preview"
          >
            {preview}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/70" data-testid="foot-toe-empty">
            {ro ? '선택 없음' : '미선택'}
          </span>
        )}
        {!ro && value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange?.([])}
            className="ml-auto text-[10px] text-muted-foreground hover:text-destructive transition"
            data-testid="foot-toe-clear"
          >
            전체 해제
          </button>
        )}
      </div>

      <div className={cn('flex items-start justify-center gap-4', disabled && 'opacity-50')}>
        <FootSvg side="L" value={value} onToggle={handleToggle} readOnly={ro} />
        <FootSvg side="R" value={value} onToggle={handleToggle} readOnly={ro} />
      </div>
    </div>
  );
}
