// T-20260715-foot-TREATMEMO-TYPINGLAG-RCA (RC-1 fix)
// 비가열 레이저 타이머 패널 — 라이브 카운트다운(setInterval 500ms)을 자체 소유하는 격리 컴포넌트.
//
// [배경] 기존에는 CustomerChartPage(단일 10,000+줄 컴포넌트) 최상위에서 timerRemainingSecs 상태 +
//   500ms setInterval 을 돌렸다. 타이머가 활성인 동안 매 0.5초마다 최상위 setState → 페이지 전체
//   (탭·이미지 그리드·예약메모/치료메모 입력칸 포함) 재렌더 → 차팅 입력 중 버벅임(특히 한글 IME 조합 중).
// [수정] 카운트다운 상태·인터벌을 이 작은 자식 컴포넌트로 이동. 부모는 activeTimer(시작/종료/로드 시에만
//   변경, 저빈도)만 넘긴다. 0.5초 tick 재렌더가 이 위젯 서브트리로 국한 → 메모 입력칸은 재렌더되지 않음.
// [부가] 남은 시간이 0 이하가 되면 인터벌을 자동 정지(불필요한 영구 tick 제거 — 기존엔 stopped_at 미설정 시
//   00:00 에서도 계속 tick 하며 재렌더). 표시·시작/종료 동작·data-testid 는 기존과 100% 동일(무회귀).

import { useEffect, useRef, useState } from 'react';
import { Loader2, Timer } from 'lucide-react';

export interface LaserTimerRecord {
  id: string;
  duration_minutes: number;
  ends_at: string;
}

function formatTimerRemaining(secs: number): string {
  if (secs <= 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  activeTimer: LaserTimerRecord | null;
  laserTimerUnits: number[];
  timerLoading: boolean;
  stopConfirmOpen: boolean;
  setStopConfirmOpen: (v: boolean) => void;
  onStart: (minutes: number) => void;
  onStop: () => void;
}

export function LaserTimerPanel({
  activeTimer,
  laserTimerUnits,
  timerLoading,
  stopConfirmOpen,
  setStopConfirmOpen,
  onStart,
  onStop,
}: Props) {
  // 카운트다운 상태 — 이 컴포넌트 안에서만 갱신(부모 재렌더 유발 X)
  const [timerRemainingSecs, setTimerRemainingSecs] = useState(0);
  const endsAtRef = useRef<string | null>(null);
  endsAtRef.current = activeTimer?.ends_at ?? null;

  // ends_at 기준 카운트다운 — 탭 비활성 대응(서버시각 앵커). 0 도달 시 인터벌 자동 정지.
  useEffect(() => {
    if (!activeTimer) {
      setTimerRemainingSecs(0);
      return;
    }
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const remaining = Math.max(0, new Date(activeTimer.ends_at).getTime() - Date.now()) / 1000;
      const ceil = Math.ceil(remaining);
      setTimerRemainingSecs(ceil);
      if (ceil <= 0 && id) {
        clearInterval(id);
        id = null;
      }
    };
    tick();
    id = setInterval(tick, 500);
    return () => {
      if (id) clearInterval(id);
    };
  }, [activeTimer]);

  return (
    <div
      className={`mx-2 mt-2 mb-1 rounded-xl border p-2.5 flex flex-col gap-2 ${
        activeTimer
          ? timerRemainingSecs <= 60
            ? 'border-red-400 bg-red-50'
            : 'border-slate-300 bg-slate-50'
          : 'border-muted bg-muted/20'
      }`}
      data-testid="laser-timer-panel"
    >
      <div className="flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5 text-slate-600 shrink-0" />
        <span className="text-[11px] font-semibold text-slate-700">비가열 레이저 타이머</span>
        {activeTimer && (
          <span
            className={`ml-auto tabular-nums font-mono text-base font-bold ${
              timerRemainingSecs <= 60 ? 'text-red-600' : 'text-slate-700'
            }`}
            data-testid="laser-timer-countdown"
          >
            {formatTimerRemaining(timerRemainingSecs)}
          </span>
        )}
      </div>

      {!activeTimer ? (
        /* 타이머 미실행 — 시작 버튼 3종 */
        <div className="flex gap-1.5" data-testid="laser-timer-start-buttons">
          {laserTimerUnits.map((min) => (
            <button
              key={min}
              type="button"
              disabled={timerLoading}
              onClick={() => onStart(min)}
              className="flex-1 rounded-lg border-2 border-slate-400 bg-white text-slate-700 font-bold text-sm py-2 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`laser-timer-btn-${min}`}
            >
              {timerLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : `${min}분`}
            </button>
          ))}
        </div>
      ) : (
        /* 타이머 실행 중 — 진행 바 + 중지 버튼 */
        <div className="space-y-1.5">
          <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                timerRemainingSecs <= 60 ? 'bg-red-500' : 'bg-slate-500'
              }`}
              style={{
                width: `${Math.min(100, (timerRemainingSecs / (activeTimer.duration_minutes * 60)) * 100)}%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{activeTimer.duration_minutes}분 타이머</span>
            <button
              type="button"
              disabled={timerLoading}
              onClick={() => setStopConfirmOpen(true)}
              className="flex items-center gap-1 rounded border border-red-300 bg-white text-red-600 text-[10px] font-medium px-2 py-0.5 hover:bg-red-50 transition-colors disabled:opacity-50"
              data-testid="laser-timer-stop-btn"
            >
              {timerLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '■ 종료'}
            </button>
          </div>

          {/* 종료 확인 인라인 박스 */}
          {stopConfirmOpen && (
            <div
              className="mt-1 rounded-lg border border-red-300 bg-red-50 p-2 flex flex-col gap-1.5"
              data-testid="laser-timer-stop-confirm"
            >
              <p className="text-[11px] text-red-700 font-medium">타이머를 종료하시겠습니까?</p>
              <div className="flex gap-1.5 justify-end">
                <button
                  type="button"
                  onClick={() => setStopConfirmOpen(false)}
                  className="rounded border border-gray-300 bg-white text-gray-600 text-[10px] font-medium px-2.5 py-1 hover:bg-gray-50 transition-colors"
                  data-testid="laser-timer-stop-cancel"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={timerLoading}
                  onClick={() => { setStopConfirmOpen(false); onStop(); }}
                  className="rounded bg-red-500 text-white text-[10px] font-semibold px-2.5 py-1 hover:bg-red-600 transition-colors disabled:opacity-50"
                  data-testid="laser-timer-stop-confirm-btn"
                >
                  {timerLoading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : '종료'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
