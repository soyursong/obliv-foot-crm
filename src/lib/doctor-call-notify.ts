/**
 * T-20260601-foot-DOCTOR-CALL-PUSH-DASH — 진료 호출 알림 순수 헬퍼.
 *
 * 풋 CRM의 "진료 호출" 데이터 모델 = check_ins.status_flag.
 *   - 'purple'(진료필요) = 활성 호출(콜 대상)
 *   - 'pink'(진료완료)   = 처리완료 호출(피드 잔존, 흐림)
 * 별도 doctor_call 테이블 없음(DOCTOR-CALL-LIST가 status_flag 기반으로 포크 구현됨).
 *
 * 알림 신호의 "호출 id"는 (check_in id + 마지막 purple 전환시각) 조합으로 정의한다.
 *  → 같은 호출(같은 전환)은 realtime tick마다 재알림되지 않고(중복 방지, AC),
 *    재호출(purple→pink→purple 새 전환)은 새 키가 되어 다시 알린다.
 *
 * 순수 함수만 — DB/DOM 의존 없음(localStorage 래퍼 제외). 환경독립 E2E로 박제 검증.
 */
import type { CheckIn, StatusFlag } from './types';

/** 알림/피드에 필요한 최소 필드 (CheckIn의 부분집합) */
export type CallCheckIn = Pick<
  CheckIn,
  | 'id'
  | 'customer_id'
  | 'customer_name'
  | 'visit_type'
  | 'status'
  | 'status_flag'
  | 'status_flag_history'
  | 'checked_in_at'
  | 'completed_at'
  | 'treatment_kind'
  | 'treatment_category'
  | 'consultation_room'
  | 'treatment_room'
  | 'laser_room'
  | 'examination_room'
>;

/** 활성 호출(진료필요/보라) */
export function isActiveCall(flag: StatusFlag | null): boolean {
  return flag === 'purple';
}

/** 처리완료 호출(진료완료/핑크) */
export function isDoneCall(flag: StatusFlag | null): boolean {
  return flag === 'pink';
}

/**
 * 호출 발생시각 = status_flag_history 의 마지막 'purple' 전환시각.
 * 이력이 없으면 checked_in_at 으로 폴백.
 */
export function getCallTime(ci: Pick<CallCheckIn, 'status_flag_history' | 'checked_in_at'>): string {
  const hist = ci.status_flag_history;
  if (Array.isArray(hist)) {
    for (let i = hist.length - 1; i >= 0; i--) {
      const entry = hist[i];
      if (entry && entry.flag === 'purple' && entry.changed_at) return entry.changed_at;
    }
  }
  return ci.checked_in_at;
}

/** 중복 방지용 호출 키 = id@발생시각 */
export function callKey(
  ci: Pick<CallCheckIn, 'id' | 'status_flag_history' | 'checked_in_at'>,
): string {
  return `${ci.id}@${getCallTime(ci)}`;
}

/** 경과 분 (호출시각 → now). 음수/NaN 방어. */
export function elapsedMinutes(callTime: string, now: number = Date.now()): number {
  const t = new Date(callTime).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

/** 경과시간 한국어 표기 */
export function formatElapsed(min: number): string {
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간 전` : `${h}시간 ${m}분 전`;
}

/** 시술명 라벨 (treatment_kind → treatment_category → 폴백) */
export function treatmentLabel(
  ci: Pick<CallCheckIn, 'treatment_kind' | 'treatment_category'>,
): string {
  const v = (ci.treatment_kind ?? ci.treatment_category ?? '').trim();
  return v === '' ? '시술 미지정' : v;
}

/** 브라우저 알림 / in-app 토스트 텍스트 (방·환자명·시술명) */
export function buildCallNotification(
  ci: Pick<CallCheckIn, 'customer_name' | 'treatment_kind' | 'treatment_category'>,
  slotName: string | null,
): { title: string; body: string } {
  const room = (slotName ?? '').trim() || '대기';
  return {
    title: `진료 호출 — ${ci.customer_name}`,
    body: `${room} · ${treatmentLabel(ci)}`,
  };
}

/** seen 집합에 없는 신규 호출 키만 반환 (중복 알림 차단) */
export function detectNewCallKeys(seen: Set<string>, currentKeys: string[]): string[] {
  return currentKeys.filter((k) => !seen.has(k));
}

// ─── 음소거 영속 (localStorage) ──────────────────────────────────────────────
const MUTE_KEY = 'foot.doctorCall.muted';

export function loadMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMute(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* noop */
  }
}
