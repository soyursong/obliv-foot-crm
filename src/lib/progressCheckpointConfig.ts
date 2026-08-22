// progressCheckpointConfig.ts — 경과분석 '도래 회차 간격' 설정값 저장·조회·구독.
// Ticket: T-20260822-foot-PROGANALYSIS-DUE-CYCLE-CONFIGURABLE
//   base canon(T-20260812, commit 4f50d3e4)의 '6배수' 하드코딩을 런타임 조정 가능한 설정값으로 승격.
//   - 저장 위치: localStorage(FE-local, 전역 단일값) → db_change=false 유지(DA CONSULT 게이트 불요).
//     지점별 스코프/DB 저장이 향후 필요해지면 amend(현재는 reporter 원문 '단일 루틴 기준' → 전역 단일값).
//   - 기본값 = DEFAULT_CHECKPOINT_INTERVAL(6). 설정 미변경 시 동작은 기존과 byte-identical(하위호환·회귀0).
//   - 검증(AC-5): 양의 정수만 저장(0·음수·비정수 거부). 비정상 저장값/파싱실패 → 기본값 폴백(안전).
//   - 변경 즉시 반영: setCheckpointInterval 이 커스텀 이벤트를 dispatch → useCheckpointInterval 구독 컴포넌트 재판정.
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CHECKPOINT_INTERVAL, isValidCheckpointInterval } from './progressSixMultiple';

export { DEFAULT_CHECKPOINT_INTERVAL, isValidCheckpointInterval };

/** localStorage 키(전역 단일값). */
const STORAGE_KEY = 'foot.progressCheckpointInterval';
/** 변경 브로드캐스트 이벤트명(동일 탭 내 구독자 즉시 갱신용). */
const CHANGE_EVENT = 'foot:progress-checkpoint-interval-changed';

/** 현재 설정된 도래 회차 간격(양의 정수). 미설정/비정상/환경부재 → 기본값(6). */
export function getCheckpointInterval(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_CHECKPOINT_INTERVAL;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_CHECKPOINT_INTERVAL;
    const n = Number(raw);
    return isValidCheckpointInterval(n) ? n : DEFAULT_CHECKPOINT_INTERVAL;
  } catch {
    return DEFAULT_CHECKPOINT_INTERVAL;
  }
}

/**
 * 도래 회차 간격 저장. 양의 정수만 허용(AC-5) — 비정상 입력이면 저장하지 않고 false 반환.
 * 성공 시 커스텀 이벤트 dispatch → 구독 컴포넌트(리스트/추출) 즉시 재판정.
 */
export function setCheckpointInterval(n: number): boolean {
  if (!isValidCheckpointInterval(n)) return false;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(n));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: n }));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 도래 회차 간격을 구독하는 React 훅. [현재값, 저장함수(성공여부)] 반환.
 *   - 동일 탭 내 변경(CHANGE_EVENT) + 다른 탭 변경(storage 이벤트) 모두 반영.
 */
export function useCheckpointInterval(): [number, (n: number) => boolean] {
  const [interval, setIntervalState] = useState<number>(getCheckpointInterval);

  useEffect(() => {
    const sync = () => setIntervalState(getCheckpointInterval());
    if (typeof window === 'undefined') return;
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync); // 크로스탭 동기화
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const set = useCallback((n: number): boolean => {
    const ok = setCheckpointInterval(n);
    if (ok) setIntervalState(n);
    return ok;
  }, []);

  return [interval, set];
}
