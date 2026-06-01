/**
 * T-20260601-foot-DOCTOR-CALL-PUSH-DASH — 진료 호출 알림 hook.
 *
 * 진료부 통합 대시보드가 떠 있는 동안 신규 호출(check_ins status_flag='purple' 전환)을 감지해
 *   1) 알림음 (playDoctorCallAlert, 음소거 토글 반영)
 *   2) 브라우저 알림 (Notification API, 권한 granted 시)
 *   3) 권한 미허용 시 in-app 토스트 폴백
 * 을 발생시킨다. 같은 호출(같은 callKey)은 재알림하지 않는다(AC: 중복 방지).
 *
 * MVP: 포그라운드(창 포커스) 기준. OS 백그라운드 푸시는 Phase 2(Web Push) 별도 티켓.
 * 기존 doctor_call(status_flag) 발신/상태머신/집계 로직은 일절 변경하지 않고, 표시만 추가한다.
 */
import { useEffect, useRef } from 'react';
import { playDoctorCallAlert } from '@/lib/audio';
import { toast } from '@/lib/toast';
import { getAssignedSlotName } from '@/lib/checkin-slot';
import { buildCallNotification, callKey, detectNewCallKeys } from '@/lib/doctor-call-notify';
import type { CheckIn } from '@/lib/types';

/** 브라우저 알림 권한 요청 (default 상태일 때만). 반환: 시도 후 권한 상태 */
export async function requestNotifyPermission(): Promise<NotificationPermission | 'unsupported'> {
  try {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'default') {
      return await Notification.requestPermission();
    }
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export function currentNotifyPermission(): NotificationPermission | 'unsupported' {
  try {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

interface Options {
  /** 음소거 — true면 소리만 끔(화면 알림은 유지) */
  muted: boolean;
  /** false면 감지/알림 비활성 */
  enabled?: boolean;
}

/**
 * @param activeCalls status_flag='purple' 인 활성 호출 목록 (부모가 memoize 권장)
 */
export function useDoctorCallNotifier(activeCalls: CheckIn[], { muted, enabled = true }: Options): void {
  const seenRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    if (!enabled) return;

    const keys = activeCalls.map((ci) => callKey(ci));

    // 최초 로드: 기존(대시보드 열기 전부터 있던) 호출은 시드만 하고 알리지 않음
    // (페이지 진입 즉시 누적 호출이 한꺼번에 울리는 것 방지 — 시나리오1 "열어둔 상태에서 신규" 기준)
    if (!initializedRef.current) {
      keys.forEach((k) => seenRef.current.add(k));
      initializedRef.current = true;
      return;
    }

    const newKeys = detectNewCallKeys(seenRef.current, keys);
    if (newKeys.length === 0) return;

    const newKeySet = new Set(newKeys);
    const newOnes = activeCalls.filter((ci) => newKeySet.has(callKey(ci)));
    newKeys.forEach((k) => seenRef.current.add(k));

    // 소리: 신규 호출 묶음당 1회 (음소거 시 생략)
    if (!mutedRef.current) playDoctorCallAlert();

    // 화면 알림: 신규 호출별 OS 배너 / 폴백 토스트
    for (const ci of newOnes) {
      const { title, body } = buildCallNotification(ci, getAssignedSlotName(ci));
      let shown = false;
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body, tag: callKey(ci) });
          shown = true;
        }
      } catch {
        shown = false;
      }
      // 권한 거부/미지원 → in-app 토스트(warning은 묵음 대상 아님 = 항상 표시)로 폴백
      if (!shown) {
        toast.warning(`${title} · ${body}`);
      }
    }
  }, [activeCalls, enabled]);
}
