/**
 * dashboardRefreshBus — 대시보드 자동 새로고침 ↔ 미저장(dirty) 입력 보호 버스
 * T-20260623-foot-CHART2-POPUP-WINDOW-AUTOREFRESH Part B
 *
 * 목적:
 *  - AdminLayout 헤더의 카운트다운(DashboardRefreshCountdown)이 60초마다 "데이터 fetch 재실행"을
 *    요청(requestRefresh)하면, 대시보드(Dashboard)가 이를 구독(subscribeRefresh)해 fullResync()를 돈다.
 *    ★전체 페이지 reload가 아니라 데이터 refetch만 → React 폼 state는 보존(무손실 AC5).
 *  - 차트/폼에 미저장 입력(dirty)이 있으면 카운트다운을 일시정지(pause)해 자동 새로고침이
 *    기입 중 입력을 덮어쓰지 않게 한다. dirty 출처(차트 등)는 setDirty(key,on)로 등록.
 *
 * 신규 외부 의존 0 · DB 0. 순수 모듈 싱글톤(EventTarget 기반 pub/sub).
 */

type Unsub = () => void;

// ── dirty 레지스트리 (출처별 key Set) ───────────────────────────────────────
const dirtyKeys = new Set<string>();
const emitter = new EventTarget();

const DIRTY_CHANGED = 'dirty-changed';
const REFRESH_REQUEST = 'refresh-request';

/** 미저장 입력 출처(key)의 dirty 상태를 등록/해제. key 단위 분리(여러 출처 독립 추적). */
export function setDirty(key: string, on: boolean): void {
  const had = dirtyKeys.has(key);
  if (on && !had) {
    dirtyKeys.add(key);
    emitter.dispatchEvent(new Event(DIRTY_CHANGED));
  } else if (!on && had) {
    dirtyKeys.delete(key);
    emitter.dispatchEvent(new Event(DIRTY_CHANGED));
  }
}

/** 현재 미저장 입력이 하나라도 있는지. */
export function anyDirty(): boolean {
  return dirtyKeys.size > 0;
}

/** dirty 상태 변화 구독. 즉시 cleanup 함수 반환. */
export function subscribeDirty(cb: () => void): Unsub {
  emitter.addEventListener(DIRTY_CHANGED, cb);
  return () => emitter.removeEventListener(DIRTY_CHANGED, cb);
}

// ── 새로고침 요청 채널 ───────────────────────────────────────────────────────
/** 대시보드 데이터 새로고침 요청(카운트다운 0 도달 / 수동 클릭). */
export function requestRefresh(): void {
  emitter.dispatchEvent(new Event(REFRESH_REQUEST));
}

/** 새로고침 요청 구독(Dashboard 가 fullResync 연결). cleanup 반환. */
export function subscribeRefresh(cb: () => void): Unsub {
  emitter.addEventListener(REFRESH_REQUEST, cb);
  return () => emitter.removeEventListener(REFRESH_REQUEST, cb);
}
