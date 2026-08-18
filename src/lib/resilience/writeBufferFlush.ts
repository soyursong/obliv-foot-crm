/**
 * writeBufferFlush.ts — (c) write-buffer flush 트리거 오케스트레이터 (spec §3.3 기준6)
 *
 * 티켓: T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step2 (c))
 *
 * flush 트리거(spec 기준6):
 *   · online 복귀        : window 'online' 이벤트.
 *   · 성공 관측          : refresh401Bus 재시도 카운터가 떨어질 때(건강 shard 착지 신호) → flush.
 *   · 주기 타이머        : 보류 건수>0 인 동안만 backoff 타이머(폭주 방지, 큐 비면 정지).
 *   · 탭 가시화          : visibilitychange(visible) → flush(백그라운드 blip 후 복귀).
 *
 * 경계(회귀축): flush 는 writeBuffer 내부 재진입 가드로 중첩 금지. 타이머는 큐가 비면 스스로 멈춘다
 *   (게이트웨이 폭주·배터리 가중 방지). SDK/interceptor 재시도와 별개 계층(write 는 큐 경유만).
 *   idempotent init — 여러 번 불려도 리스너 1회만 등록.
 */
import { subscribeRefresh401 } from './refresh401Bus';
import { writeBuffer } from './writeBufferInstance';

let initialized = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastActiveRetries = 0;

/** 보류 건수>0 이면 backoff 타이머 재무장, 0 이면 정지(폭주 방지). */
function rearmTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (writeBuffer.pendingCount() <= 0) return;
  // 15s 주기 재시도(간헐 blip 자연복구 대비). 큐 비면 다음 tick 에서 정지.
  timer = setTimeout(() => {
    void runFlush();
  }, 15_000);
}

async function runFlush(): Promise<void> {
  try {
    if (writeBuffer.pendingCount() > 0) {
      await writeBuffer.flush();
    }
  } catch {
    /* flush 예외는 다음 트리거에서 재시도 — 폐기 금지 */
  } finally {
    rearmTimer();
  }
}

/**
 * flush 오케스트레이터 초기화(App 마운트 1회). idempotent.
 * @returns teardown(리스너/타이머 해제) — 미사용 가능(앱 수명 = 페이지 수명).
 */
export function initWriteBufferFlush(): () => void {
  if (initialized) return () => {};
  initialized = true;

  const onOnline = (): void => {
    void runFlush();
  };
  const onVisible = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void runFlush();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
  }

  // 성공 관측: refresh-401 재시도 카운터가 감소(=건강 응답 착지)하는 순간 flush 시도.
  const unsub = subscribeRefresh401((s) => {
    if (s.activeRetries < lastActiveRetries) {
      void runFlush();
    }
    lastActiveRetries = s.activeRetries;
  });

  // 부팅 시 이전 세션 잔여 큐가 있으면 즉시 1회 flush + 타이머 무장.
  void runFlush();

  return () => {
    initialized = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    }
    unsub();
  };
}
