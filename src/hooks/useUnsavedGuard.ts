/**
 * T-20260613-foot-REFRESH-BANNER-AUTOLO — 화면이 자신의 미저장 상태를 dirty-guard로 등록하는 훅.
 *
 * 사용 예:
 *   // 저장 경로 없는 화면(진료차트) → blocking (flush 미전달)
 *   useUnsavedGuard('medical-chart', () => isEditing && hasContent, { label: '진료차트' });
 *
 *   // 저장 핸들러 보유 화면 → flushable (flush 전달 → 자동 저장 후 새로고침)
 *   useUnsavedGuard('checkin-notes', () => isDirty, { flush: saveNotes, label: '체크인 메모' });
 *
 * isDirty/flush는 매 렌더 최신 클로저를 ref로 갈무리하므로, deps에 넣지 않아도
 * 항상 최신 상태를 읽는다(등록은 mount 동안 1회 안정 유지 → 불필요한 재등록 없음).
 */
import { useEffect, useRef } from 'react';
import { registerUnsavedGuard } from '@/lib/unsavedGuard';

interface UseUnsavedGuardOptions {
  /** 있으면 flushable(자동 저장 후 새로고침). 없으면 blocking(저장 후 진행 안내). */
  flush?: () => Promise<void> | void;
  /** 사용자 안내·디버깅 라벨. */
  label?: string;
  /** false면 가드 비활성(등록 안 함). 기본 true. */
  enabled?: boolean;
}

export function useUnsavedGuard(
  id: string,
  isDirty: () => boolean,
  opts: UseUnsavedGuardOptions = {},
): void {
  const { flush, label, enabled = true } = opts;

  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // flush 존재 여부가 바뀌면(=flushable↔blocking 전환) 재등록 필요 → deps에 포함.
  const hasFlush = Boolean(flush);

  useEffect(() => {
    if (!enabled) return;
    return registerUnsavedGuard({
      id,
      isDirty: () => isDirtyRef.current(),
      // ref 경유 호출이라 클로저는 항상 최신. hasFlush가 false면 blocking으로 등록.
      flush: hasFlush ? () => flushRef.current?.() : undefined,
      label,
    });
  }, [id, enabled, hasFlush, label]);
}
