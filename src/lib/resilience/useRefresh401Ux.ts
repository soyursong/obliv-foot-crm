/**
 * useRefresh401Ux.ts — refresh-401 UX 상태 React 어댑터 (spec §3.1)
 *
 * refresh401Bus 를 구독해 배너 렌더에 필요한 파생 상태를 반환한다.
 * 코어(bus)는 CRM 무관 — 이 어댑터도 neutral(테마/카피 없음, Banner 가 표시 담당).
 */
import { useSyncExternalStore } from 'react';
import {
  getRefresh401State,
  subscribeRefresh401,
  type Refresh401State,
} from './refresh401Bus';

export interface Refresh401Ux {
  /** 배너를 표시해야 하는가 (재시도 중이거나 (c) 보류 write 존재). */
  visible: boolean;
  /** refresh-401 backoff 재시도 진행 중. */
  retrying: boolean;
  /** (c) write-buffer 보류 건수 (Step1=0). */
  pendingWrites: number;
}

function derive(s: Refresh401State): Refresh401Ux {
  const retrying = s.activeRetries > 0;
  return {
    retrying,
    pendingWrites: s.pendingWrites,
    visible: retrying || s.pendingWrites > 0,
  };
}

// useSyncExternalStore 는 참조 안정 스냅샷을 요구 → 파생 결과를 캐시해 동일 입력이면 동일 참조 반환.
let cachedState: Refresh401State | null = null;
let cachedUx: Refresh401Ux | null = null;

function getSnapshot(): Refresh401Ux {
  const s = getRefresh401State();
  if (
    cachedState &&
    cachedUx &&
    cachedState.activeRetries === s.activeRetries &&
    cachedState.pendingWrites === s.pendingWrites
  ) {
    return cachedUx;
  }
  cachedState = s;
  cachedUx = derive(s);
  return cachedUx;
}

export function useRefresh401Ux(): Refresh401Ux {
  return useSyncExternalStore(subscribeRefresh401, getSnapshot, getSnapshot);
}
