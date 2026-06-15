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
//
// T-20260615-foot-TOEILLUST-NAIL-FOCUS-RESIZE: 발 측면 전체(발볼+뒤꿈치) 구도 →
//   위에서 내려다본 앞발(forefoot) 크롭 + 발톱(toenail) 중점 컴팩트 구도로 리디자인.
//   세로 면적 축소(VB 176→114). 발톱이 시각 주체. 선택 모델/바인딩/저장키 변경 0.
const VB_W = 120;
const VB_H = 114;

// 발가락 = 위로 선 캡슐. cx=가로중심, topY=발가락 상단, w=폭, h=길이.
interface ToePos {
  toe: number;
  cx: number;
  topY: number;
  w: number;
  h: number;
}

// 엄지(1)=안쪽(좌)·가장 큼 ~ 새끼(5)=바깥(우)·가장 작음. 끝 라인은 가운데가 높은 완만한 아치.
const BASE_TOES: ToePos[] = [
  { toe: 1, cx: 22, topY: 18, w: 28, h: 50 },
  { toe: 2, cx: 49, topY: 10, w: 19, h: 47 },
  { toe: 3, cx: 69, topY: 11, w: 18, h: 44 },
  { toe: 4, cx: 87, topY: 17, w: 16, h: 39 },
  { toe: 5, cx: 102, topY: 26, w: 13, h: 33 },
];

function toePositions(side: FootSide): ToePos[] {
  // 좌측 발(L)은 엄지가 오른쪽(안쪽)에 오도록 x 미러. 우측 발(R)은 기준 그대로.
  if (side === 'R') return BASE_TOES;
  return BASE_TOES.map((t) => ({ ...t, cx: VB_W - t.cx }));
}

interface FootSvgProps {
  side: FootSide;
  value: FootSite[];
  onToggle?: (side: FootSide, toe: number) => void;
  readOnly?: boolean;
}

function FootSvg({ side, value, onToggle, readOnly }: FootSvgProps) {
  const toes = toePositions(side);
  // 발등 홍조 위치(엄지 쪽). 미러 시 반전.
  const blushX = side === 'R' ? 36 : VB_W - 36;
  return (
    <div className="flex flex-col items-center gap-1" data-testid={`foot-${side}`}>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-[108px] select-none sm:w-[120px]"
        role="group"
        aria-label={`${side === 'L' ? '좌측' : '우측'} 발 발가락 선택`}
      >
        {/* 앞발(forefoot) 패드 — 발톱 중점 크롭(뒤꿈치 없음). 발가락 밑동을 덮는 넓고 둥근 면. */}
        <rect x={5} y={58} width={VB_W - 10} height={50} rx={24} fill="#fdf6ec" stroke="#e7d8c3" strokeWidth={2} />
        {/* 발등 살짝 홍조(귀여움) */}
        <ellipse cx={blushX} cy={82} rx={15} ry={9} fill="#fbe3df" opacity={0.6} />

        {/* 발가락 10개 — 각 toe 클릭 토글. 발톱(toenail)을 상단에 또렷하게. */}
        {toes.map((t) => {
          const active = hasFootSite(value, side, t.toe);
          const x = t.cx - t.w / 2;
          // 발톱: 발가락 상단 또렷한 둥근 사각.
          const nailW = t.w * 0.64;
          const nailH = t.h * 0.34;
          const nailX = t.cx - nailW / 2;
          const nailY = t.topY + t.h * 0.12;
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
              {/* AC3: 클릭/터치 타겟을 시각 발가락보다 크게(±7px 패딩) — 모바일 오탭 방지. 투명. 맨 뒤(hover/시각 비차단). */}
              <rect
                x={x - 7}
                y={t.topY - 7}
                width={t.w + 14}
                height={t.h + 14}
                rx={(t.w + 14) / 2}
                fill="transparent"
                data-testid={`toe-${side}-${t.toe}-hit`}
              />
              {/* 발가락 본체(캡슐) */}
              <rect
                x={x}
                y={t.topY}
                width={t.w}
                height={t.h}
                rx={t.w / 2}
                /* T-20260614-foot-THEME-MONOCHROME-RECOLOR: 활성 발톱 teal→warm(Umber/Taupe) */
                fill={active ? '#6E6353' : '#fdf6ec'}
                stroke={active ? '#443A35' : '#e7d8c3'}
                strokeWidth={2}
                className={cn('transition-colors', !readOnly && 'hover:stroke-[#C5BEA3]')}
              />
              {/* 발톱(toenail) — 구도의 시각 주체 */}
              <rect
                x={nailX}
                y={nailY}
                width={nailW}
                height={nailH}
                rx={nailW * 0.4}
                fill={active ? '#C5BEA3' : '#fff7ec'}
                stroke={active ? '#443A35' : '#e7d8c3'}
                strokeWidth={1}
                opacity={0.95}
                style={{ pointerEvents: 'none' }}
              />
              {/* 발가락 번호(식별용) — 발톱 아래 살집에 */}
              <text
                x={t.cx}
                y={t.topY + t.h * 0.76}
                textAnchor="middle"
                fontSize={t.toe === 1 ? 12 : 10}
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
