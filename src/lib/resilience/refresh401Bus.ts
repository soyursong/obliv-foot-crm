/**
 * refresh401Bus.ts — refresh-401 진입/해소 경량 pub/sub (CRM 무관 순수 코어)
 *
 * spec §3.1: interceptor 가 refresh-401 진입/해소를 이벤트로 브로드캐스트 → useRefresh401Ux → 배너.
 * 무패키지(모듈 스코프 리스너 집합 + 정수 카운터). React 의존 없음.
 *
 * 상태 모델:
 *   - activeRetries: 현재 refresh-401 재시도(backoff) 진행 중인 요청 수(>0 = "재시도 중").
 *   - pendingWrites: (c) write-buffer 보류 write 건수. Step1 에서는 항상 0 (Step2 에서 배선).
 *
 *   retrying = activeRetries > 0 || pendingWrites > 0 → 배너 표시 신호.
 */

export interface Refresh401State {
  /** refresh-401 backoff 재시도 진행 중인 요청 수. */
  activeRetries: number;
  /** (c) write-buffer 에 보류된 저장 건수. Step1=항상 0 (Step2 배선 예정). */
  pendingWrites: number;
}

let state: Refresh401State = { activeRetries: 0, pendingWrites: 0 };
const listeners = new Set<(s: Refresh401State) => void>();

function emit(): void {
  // 불변 스냅샷을 전달(구독자가 이전 스냅샷을 참조비교로 변화 감지 가능).
  const snapshot: Refresh401State = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* 구독자 예외가 다른 구독자/인터셉터를 오염시키지 않게 흡수 */
    }
  });
}

/** 현재 상태 스냅샷(불변 복사본). */
export function getRefresh401State(): Refresh401State {
  return { ...state };
}

/** 상태 변화 구독. 반환값 호출 시 해제. */
export function subscribeRefresh401(fn: (s: Refresh401State) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** refresh-401 재시도 시퀀스 진입(interceptor 가 backoff 루프 시작 시 1회). */
export function beginRetry(): void {
  state = { ...state, activeRetries: state.activeRetries + 1 };
  emit();
}

/** refresh-401 재시도 시퀀스 종료(성공/소진 무관, 진입당 1회 대칭 호출). */
export function endRetry(): void {
  const next = Math.max(0, state.activeRetries - 1);
  if (next === state.activeRetries) return;
  state = { ...state, activeRetries: next };
  emit();
}

/**
 * (c) 보류 write 건수 설정 — Step2(write-buffer) 가 큐 길이 변동 시 호출.
 * Step1 에서는 미사용(항상 0). 배너 "저장 대기 N건" 표시의 소스.
 */
export function setPendingWrites(n: number): void {
  const v = Math.max(0, Math.floor(n));
  if (v === state.pendingWrites) return;
  state = { ...state, pendingWrites: v };
  emit();
}

/** 테스트/디버그용 리셋. 프로덕션 경로에서는 호출 안 함. */
export function __resetRefresh401Bus(): void {
  state = { activeRetries: 0, pendingWrites: 0 };
  emit();
}
