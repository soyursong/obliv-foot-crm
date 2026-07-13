/**
 * T-20260613-foot-REFRESH-BANNER-AUTOLO — 새로고침 안내 배너: 카운트다운 자동 전환 + dirty-guard.
 *
 * 변경 배경(김주연 총괄 컨펌 2026-06-13):
 *   기존 배너는 '버튼식'이라 사용자가 누르기 전엔 며칠째 화면에 계속 떠 불편 →
 *   10~15초 카운트다운 후 '버튼 없이 자동 새로고침'으로 전환.
 *
 * 동작:
 *   - AC-1: 새 버전 감지(useVersionCheck) 시 "잠시 후 자동으로 화면이 업데이트됩니다 (N초)"
 *           하단 고정 배너/토스트 노출(별도 창 X).
 *   - AC-2: 12초(10~15초 범위) 카운트다운 → 종료 시 버튼 없이 자동 새로고침.
 *   - AC-3 (dirty-guard, 데이터 유실 0): 새로고침 발화 직전 미저장 입력 감지(collectDirty).
 *       · flushable(저장 경로 보유) → 자동 저장(flush) 후 새로고침 + "자동 저장됨" 노출.
 *       · blocking(저장 경로 없음, 예: 진료차트) → 새로고침 보류 + "저장 후 새로고침" 안내.
 *         (카운트다운을 멈추고 묵시적 강제 새로고침으로 데이터를 날리지 않음.)
 *   - AC-4: "지금 새로고침" 버튼으로 즉시 실행도 가능(동일 dirty-guard 적용).
 *
 * 무패키지: setInterval + location.reload + dirty-guard 레지스트리만 사용.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVersionCheck } from '@/hooks/useVersionCheck';
import { collectDirty, flushAll } from '@/lib/unsavedGuard';

/**
 * 카운트다운 시작 초(10~15초 범위, 기본 12). E2E는 window.__updateCountdownSeconds로
 * 짧게 덮어써 결정적으로 자동 전환을 검증한다(프로덕션 동작 무영향).
 */
function getCountdownSeconds(): number {
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __updateCountdownSeconds?: number })
      .__updateCountdownSeconds;
    if (typeof override === 'number' && override >= 1 && override <= 60) return override;
  }
  return 12;
}

/**
 * flush(자동 저장) 후 "자동 저장됨"을 사용자가 실제로 본 뒤 새로고침되도록 두는 짧은 지연(ms).
 * 즉시 reload 하면 React 렌더 전에 화면이 날아가 안내가 보이지 않는다(현장 step6 요구).
 */
function getSavedNoticeMs(): number {
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __updateSavedNoticeMs?: number }).__updateSavedNoticeMs;
    if (typeof override === 'number' && override >= 0 && override <= 5000) return override;
  }
  return 900;
}

/**
 * blocked 데드엔드 자가복구 재평가 주기(ms). E2E는 window.__updateRecoveryPollMs로
 * 짧게 덮어써 결정적으로 검증한다(프로덕션 동작 무영향).
 */
function getRecoveryPollMs(): number {
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __updateRecoveryPollMs?: number }).__updateRecoveryPollMs;
    if (typeof override === 'number' && override >= 100 && override <= 60000) return override;
  }
  return 5000;
}

type Phase = 'counting' | 'flushing' | 'blocked';

export default function UpdateBanner() {
  const { updateAvailable } = useVersionCheck();
  const [phase, setPhase] = useState<Phase>('counting');
  const [secondsLeft, setSecondsLeft] = useState(() => getCountdownSeconds());
  const [savedNotice, setSavedNotice] = useState(false);
  const tickRef = useRef<number | null>(null);

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  /**
   * 실제 새로고침 시도 — dirty-guard 적용.
   *  - blocking 있으면 보류(phase='blocked'), reload 안 함.
   *  - flushable 있으면 저장 후(실패분은 blocking 취급) reload.
   *  - dirty 없으면 즉시 reload.
   */
  const attemptReload = useCallback(async () => {
    clearTick();
    const { flushable, blocking } = collectDirty();

    if (blocking.length > 0) {
      setPhase('blocked');
      return;
    }

    if (flushable.length > 0) {
      setPhase('flushing');
      const failed = await flushAll(flushable);
      if (failed.length > 0) {
        // 저장 실패분이 있으면 강제 새로고침으로 유실시키지 않고 보류.
        setPhase('blocked');
        return;
      }
      // "자동 저장됨"을 사용자가 본 뒤 새로고침(즉시 reload 시 안내가 렌더 전에 사라짐).
      setSavedNotice(true);
      window.setTimeout(() => window.location.reload(), getSavedNoticeMs());
      return;
    }

    window.location.reload();
  }, [clearTick]);

  // 새 버전 감지 → 카운트다운 시작.
  useEffect(() => {
    if (!updateAvailable) return;
    setPhase('counting');
    setSecondsLeft(getCountdownSeconds());

    tickRef.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearTick();
          void attemptReload();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return clearTick;
  }, [updateAvailable, attemptReload, clearTick]);

  // ── T-20260713-foot-APPSHELL-STALE-BUNDLE-RELOAD-GUARD — blocked 데드엔드 자가복구 ──
  //
  // RC(origin RECEIPT-ITEMIZED false-reopen): 새 버전 감지 후 카운트다운이 attemptReload 를
  //   발화한 순간 미저장 blocking 가드가 하나라도 있으면 phase='blocked' 로 고정되고, 그 뒤
  //   가드가 해제(저장/차트 닫힘)돼도 재시도 경로가 없어 세션이 종일 구 in-memory 번들로 남았다
  //   → 방금 배포한 fix 가 현장에 안 보임(유령 재진입/false reopen).
  // 처방: blocked 인 동안 (a) 주기적으로 + (b) 탭 재활성(visibility/focus) 시 blocking 이
  //   비었는지 재평가해, 비면 자동으로 reload 경로(attemptReload)를 재개한다. blocking 이
  //   남아 있으면 계속 보류(데이터 유실 0 유지) — 안전할 때에만 스스로 착지한다. 무패키지.
  useEffect(() => {
    if (!updateAvailable || phase !== 'blocked') return;
    let cancelled = false;
    const retry = () => {
      if (cancelled) return;
      // 여전히 blocking 이면 재개하지 않음(유실 0). 비었을 때만 reload 경로 재진입.
      if (collectDirty().blocking.length === 0) void attemptReload();
    };
    const id = window.setInterval(retry, getRecoveryPollMs());
    const onActive = () => {
      if (document.visibilityState === 'visible') retry();
    };
    document.addEventListener('visibilitychange', onActive);
    window.addEventListener('focus', onActive);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onActive);
      window.removeEventListener('focus', onActive);
    };
  }, [updateAvailable, phase, attemptReload]);

  if (!updateAvailable) return null;

  const message =
    phase === 'blocked'
      ? '작성 중인 내용이 있어 저장 후 새로고침해 주세요.'
      : phase === 'flushing'
        ? '작성 중인 내용을 저장하고 화면을 업데이트하는 중입니다…'
        : `잠시 후 자동으로 화면이 업데이트됩니다 (${secondsLeft}초)`;

  return (
    <div
      data-testid="app-update-banner"
      data-phase={phase}
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[200] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-slate-800 shadow-lg"
    >
      <span className="text-xs font-medium sm:text-sm">{message}</span>

      {savedNotice && (
        <span
          data-testid="app-update-saved-notice"
          className="rounded-md bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
        >
          자동 저장됨
        </span>
      )}

      <Button
        size="sm"
        data-testid="app-update-reload"
        className="bg-slate-700 text-white hover:bg-slate-800"
        disabled={phase === 'flushing'}
        onClick={() => void attemptReload()}
      >
        <RefreshCw />
        지금 새로고침
      </Button>
    </div>
  );
}
