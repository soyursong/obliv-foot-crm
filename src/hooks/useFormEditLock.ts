/**
 * T-20260611-foot-CONCURRENT-EDIT-LOCK — 펜차트 양식 4종 편집 동시편집 잠금 훅.
 *
 * 사용처(예정): 펜차트 양식 관리(편집) 화면 — T-20260611-foot-PENCHART-FORM-TEMPLATE-EDIT
 *   이 편집 화면의 본체이며, 본 훅은 "그 위 레이어"(잠금)다. 편집 화면이 마운트되면
 *   `const lock = useFormEditLock(formKey);` 로 호출하고, lock.isLocked 면 저장 비활성 +
 *   <FormEditLockBanner editorName={lock.lockedByName} /> 노출.
 *
 * 기술: Supabase Realtime presence. form_key 별 독립 채널(`form-edit-lock:{formKey}`)로
 *   양식 4종 독립 잠금을 보장. DB 스키마 변경 없음(ephemeral).
 *
 * 잠금 해제 보장:
 *  - 편집 화면 이탈(unmount) → removeChannel → 내 presence 제거 → 타 클라이언트 재선출.
 *  - 탭 강제종료/새로고침 → pagehide/beforeunload 에서 removeChannel 시도(즉시 해제),
 *    + Realtime 서버 소켓 종료 기반 eviction + 클라이언트 stale(lastBeat) 가드(half-open 방어).
 *  - 저장 완료 후에도 편집을 계속하지 않을 때는 호출부에서 release() 호출 가능.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  LOCK_HEARTBEAT_MS,
  LOCK_STALE_MS,
  evaluateLock,
  isLockableFormKey,
  type LockEvaluation,
  type LockParticipant,
} from '@/lib/formEditLock';

export interface UseFormEditLockResult extends LockEvaluation {
  /** presence sync 가 한 번이라도 완료돼 잠금 상태가 신뢰 가능한지. false 동안은 판단 보류. */
  isReady: boolean;
  /** 명시적 잠금 해제(예: 저장 후 계속 머무를 때). 호출 시 presence 제거 → 타 사용자에 양도. */
  release: () => void;
}

interface PresenceMeta {
  userId: string;
  userName: string | null;
  joinedAt: number;
  lastBeat: number;
}

/**
 * @param formKey 잠금 대상 양식 키. 비-잠금 대상이거나 null 이면 잠금 비활성(항상 편집 가능).
 * @param enabled 외부에서 잠금 적용 여부 제어(예: 편집 모드일 때만 true). 기본 true.
 */
export function useFormEditLock(
  formKey: string | null | undefined,
  enabled: boolean = true,
): UseFormEditLockResult {
  const { profile } = useAuth();
  const selfUserId = profile?.id ?? null;
  const selfName = profile?.name ?? null;

  const [evaluation, setEvaluation] = useState<LockEvaluation>({
    isOwner: false,
    isLocked: false,
    lockedByName: null,
    ownerUserId: null,
  });
  const [isReady, setIsReady] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinedAtRef = useRef<number>(0);

  const active = Boolean(enabled && selfUserId && formKey && isLockableFormKey(formKey));

  const recompute = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !selfUserId) return;
    const state = channel.presenceState<PresenceMeta>();
    const participants: LockParticipant[] = Object.values(state)
      .flat()
      .map((m) => ({
        userId: m.userId,
        userName: m.userName ?? null,
        joinedAt: m.joinedAt,
        lastBeat: m.lastBeat,
      }));
    setEvaluation(evaluateLock(participants, selfUserId, Date.now(), LOCK_STALE_MS));
  }, [selfUserId]);

  const release = useCallback(() => {
    const channel = channelRef.current;
    if (channel) {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    }
  }, []);

  useEffect(() => {
    if (!active || !selfUserId || !formKey) {
      // 잠금 비활성 — 항상 편집 가능 상태로 노출.
      setEvaluation({ isOwner: false, isLocked: false, lockedByName: null, ownerUserId: null });
      setIsReady(true);
      return;
    }

    setIsReady(false);
    joinedAtRef.current = Date.now();

    const channel = supabase.channel(`form-edit-lock:${formKey}`, {
      config: { presence: { key: selfUserId } },
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        recompute();
        setIsReady(true);
      })
      .on('presence', { event: 'join' }, recompute)
      .on('presence', { event: 'leave' }, recompute)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({
            userId: selfUserId,
            userName: selfName,
            joinedAt: joinedAtRef.current,
            lastBeat: Date.now(),
          } satisfies PresenceMeta);
        }
      });

    // heartbeat: lastBeat 갱신 + half-open stale 가드를 위한 주기 재선출.
    const beat = setInterval(() => {
      const ch = channelRef.current;
      if (!ch) return;
      void ch.track({
        userId: selfUserId,
        userName: selfName,
        joinedAt: joinedAtRef.current,
        lastBeat: Date.now(),
      } satisfies PresenceMeta);
      recompute();
    }, LOCK_HEARTBEAT_MS);

    // 탭 강제종료/새로고침 시 즉시 presence 해제 시도(서버 eviction 대기 단축).
    const onUnload = () => {
      const ch = channelRef.current;
      if (ch) void supabase.removeChannel(ch);
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(beat);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) void supabase.removeChannel(ch);
    };
  }, [active, selfUserId, selfName, formKey, recompute]);

  return { ...evaluation, isReady, release };
}
