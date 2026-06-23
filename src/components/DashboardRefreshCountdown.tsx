/**
 * DashboardRefreshCountdown — 헤더 종 아이콘 옆 1분 자동 새로고침 카운트다운
 * T-20260623-foot-CHART2-POPUP-WINDOW-AUTOREFRESH Part B
 *
 * 동작 (AC4/AC5):
 *  - 60초 카운트다운 표시("MM:SS"). 0 도달 시 requestRefresh() → Dashboard가 fullResync()
 *    (★데이터 refetch만, 페이지 reload 아님 → React 폼 state 보존 = 무손실). 이후 60초 재시작.
 *  - 차트/폼에 미저장 입력(anyDirty)이 있으면 카운트다운을 일시정지(권장안). clean 되면 재개.
 *    → 자동 새로고침이 기입 중 입력에 영향을 주지 않음(AC5 무손실).
 *  - 위젯 클릭 = 수동 즉시 새로고침(fetch-only, 폼 보존) + 카운트 60초 리셋.
 *
 * DB 0 · 신규 외부 의존 0. dashboardRefreshBus 싱글톤 pub/sub만 사용.
 * 일시정지 vs 스킵: 권장(일시정지) 채택. 총괄 코멘트로 확정 시 즉시 정정 가능(주석 유지).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw, PauseCircle } from 'lucide-react';
import { requestRefresh, anyDirty, subscribeDirty } from '@/lib/dashboardRefreshBus';

const REFRESH_PERIOD_SEC = 60;

export default function DashboardRefreshCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_PERIOD_SEC);
  const [paused, setPaused] = useState<boolean>(() => anyDirty());
  // 1초 틱 인터벌이 최신 paused 값을 읽도록 ref 동기화(재구독 없이)
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // dirty 상태 변화 → 일시정지 토글
  useEffect(() => {
    const unsub = subscribeDirty(() => setPaused(anyDirty()));
    return unsub;
  }, []);

  // 1초 틱 — dirty면 보류(현재 값 유지), clean이면 카운트 진행
  useEffect(() => {
    const id = window.setInterval(() => {
      if (pausedRef.current) return; // 미저장 입력 중: 자동 새로고침 보류(무손실 AC5)
      setSecondsLeft((s) => {
        if (s <= 1) {
          requestRefresh();            // fetch-only fullResync (페이지 reload X → 폼 보존)
          return REFRESH_PERIOD_SEC;   // 60초 재시작 (AC4)
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // 수동 즉시 새로고침 (gbf3: 카운터/아이콘 클릭 시 즉시 갱신) + 카운트 리셋
  const handleManual = useCallback(() => {
    requestRefresh();
    setSecondsLeft(REFRESH_PERIOD_SEC);
  }, []);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <button
      type="button"
      onClick={handleManual}
      data-testid="dashboard-refresh-countdown"
      data-paused={paused ? 'true' : 'false'}
      data-seconds={secondsLeft}
      aria-label={paused ? '작성 중 — 자동 새로고침 보류 중. 클릭 시 즉시 새로고침' : '자동 새로고침까지 남은 시간. 클릭 시 즉시 새로고침'}
      title={paused ? '작성 중 — 자동 새로고침 보류 중 (클릭 시 즉시 새로고침)' : `자동 새로고침까지 ${mm}:${ss} (클릭 시 즉시 새로고침)`}
      className="flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted transition min-h-[36px]"
    >
      {paused
        ? <PauseCircle className="h-3.5 w-3.5 text-amber-500" />
        : <RefreshCw className="h-3.5 w-3.5" />}
      <span className="tabular-nums hidden sm:inline" data-testid="countdown-time">
        {paused ? '입력 중' : `${mm}:${ss}`}
      </span>
      <span className="tabular-nums sm:hidden" aria-hidden="true">
        {paused ? '⏸' : ss}
      </span>
    </button>
  );
}
