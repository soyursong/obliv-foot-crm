// inClinicRxGate — 빠른처방 원내 잔류 게이트
// T-20260609-foot-QUICKRX-INCLINIC-GATE
//
// 정책(문지은 대표원장 현장 신고):
//   빠른처방 = "진료 본 의사가 지금 원내에 있는 환자에게 빠르게 처방만" 하는 버튼.
//   기존엔 환자 상태 검증이 없어 누르면 다 됨 → 전날 환자·미래 환자·귀가(완료)된 환자에게도 처방이 박힘.
//   → 원내 잔류 환자에게만 실행 허용. 전날/미래/귀가/취소는 차단하고 "차트에서 수정"으로 안내.
//
// SSOT 재사용(불일치 0 보장 — 별도 판정 신설 금지):
//   원내 대시보드(Dashboard.tsx)가 "원내 잔류(active)"를 판정하는 기준을 그대로 재사용한다.
//     1) 당일(KST) 체크인  — Dashboard.fetchCheckIns 의 checked_in_at KST 바운드
//                            (`${dateStr}T00:00:00+09:00` ~ `${dateStr}T23:59:59+09:00`, dateStr=오늘 KST)
//     2) status !== 'done' && status !== 'cancelled'  — Dashboard.tsx active 필터(line 4093)
//   ※ done 전환 시 completed_at 이 찍힘(Dashboard.tsx line 4516) → done = 귀가/완료(원내 비잔류).
//   ※ "진료 완료(completed_at)"는 귀가가 아님 — 레이저 등 시술이 남은 원내 잔류 환자도 completed_at 보유 가능.
//      따라서 귀가 판정은 completed_at 이 아니라 status==='done' 으로 한다.

// T-20260610-foot-DOCDASH-STATUS-SPLIT (진료완료 ≠ 귀가 — 문지은 대표원장 정정):
//   "진료완료랑 귀가랑 같지 않지. 의사가 진료실에서 나온 게 진료완료, 처방전 뽑고 수납서류 다 해야 귀가."
//   허용 = 원내 잔류(진료완료 포함) / 차단 = 귀가(true discharge)로만.
//   진료완료 = status_flag='pink'(진료완료 버튼, status 미변경) / 귀가 = status='done'(+ 수납완료 dark_gray).
//   pink 전이는 status 미변경, done 전이는 status_flag를 dark_gray로 덮음 → pink와 done 상호배타.
//   ⇒ "pink면 허용" 조기 규칙이 done(귀가) 차단을 무력화하지 않음(무스키마, STEP1-B (b)).

import { seoulISODate, todaySeoulISODate } from './format';
import type { CheckInStatus, StatusFlag } from './types';

/** 원내 비잔류(귀가/종료) 상태 — Dashboard active 필터의 여집합 */
export const NOT_IN_CLINIC_STATUSES = new Set<CheckInStatus>(['done', 'cancelled']);

export type RxInClinicBlockReason = 'not_today' | 'discharged' | 'cancelled' | 'missing';

export interface RxInClinicGateResult {
  /** 빠른처방 실행 허용 여부 */
  allowed: boolean;
  /** 차단 사유(allowed=true 면 null) */
  reason: RxInClinicBlockReason | null;
}

export interface RxInClinicCheckInput {
  status?: CheckInStatus | string | null;
  checked_in_at?: string | null;
  /**
   * T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(status_flag='pink') = 원내 잔류 1급 신호.
   * 진료완료 ≠ 귀가. 진료완료 환자는 처방을 허용해야 함(원내 잔류, 처방·수납 전).
   * 미제공(undefined) 시 종전 동작(status 기준만) 보존 — 무회귀.
   */
  status_flag?: StatusFlag | string | null;
}

/**
 * 빠른처방 원내 잔류 게이트.
 *
 * @param checkIn  대상 체크인(status + checked_in_at)
 * @param todayISO 오늘 날짜(KST, YYYY-MM-DD). 미지정 시 현재 시각 기준 오늘(테스트 주입용).
 * @returns allowed=false 면 원내 비잔류(전날/미래/귀가/취소) → 빠른처방 불가.
 *
 * fail-closed: checkIn 정보를 확인할 수 없으면(누락) 차단.
 */
export function checkRxInClinic(
  checkIn: RxInClinicCheckInput | null | undefined,
  todayISO: string = todaySeoulISODate(),
): RxInClinicGateResult {
  if (!checkIn || !checkIn.checked_in_at) {
    return { allowed: false, reason: 'missing' };
  }

  const status = (checkIn.status ?? '') as CheckInStatus;

  // 취소는 날짜 무관 차단(취소 사유 안내가 더 정확).
  if (status === 'cancelled') return { allowed: false, reason: 'cancelled' };

  // 당일(KST) 여부 — 전날/미래 차단.
  if (seoulISODate(checkIn.checked_in_at) !== todayISO) {
    return { allowed: false, reason: 'not_today' };
  }

  // T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료(pink)는 원내 잔류 → 처방 허용(진료완료 ≠ 귀가).
  //   진료완료 전이는 status를 done으로 바꾸지 않고, 귀가(done) 전이는 status_flag를 dark_gray로 덮으므로
  //   pink와 done은 상호배타 → 이 조기 허용이 아래 귀가(done) 차단을 무력화하지 않는다.
  const flag = (checkIn.status_flag ?? '') as StatusFlag;
  if (flag === 'pink') return { allowed: true, reason: null };

  // 귀가(true discharge) 차단 — status='done'(+ 수납완료 dark_gray).
  if (status === 'done') return { allowed: false, reason: 'discharged' };

  return { allowed: true, reason: null };
}

/** checkIn 이 원내 잔류면 true (편의 헬퍼) */
export function isInClinicForRx(
  checkIn: RxInClinicCheckInput | null | undefined,
  todayISO?: string,
): boolean {
  return checkRxInClinic(checkIn, todayISO).allowed;
}

/**
 * 차단 사유별 현장 안내 문구.
 * 공통 골격: "원내 잔류 환자만 가능 / 이미 나간 처방은 차트에서 수정" (AC1~4).
 */
export function rxInClinicMessage(reason: RxInClinicBlockReason | null): string {
  switch (reason) {
    case 'discharged':
      // T-20260610-foot-DOCDASH-STATUS-SPLIT: 진료완료와 혼동 차단 — '귀가(수납완료)'로 명시.
      return '귀가(수납완료)한 환자예요. 진료완료 환자는 처방이 가능하고, 이미 나간 처방은 차트에서 수정하세요.';
    case 'not_today':
      return '원내 잔류 환자(오늘 내원)만 빠른처방이 가능해요. 지난/예정 처방은 차트에서 수정하세요.';
    case 'cancelled':
      return '취소된 접수에는 빠른처방을 할 수 없어요. 차트에서 확인하세요.';
    case 'missing':
    default:
      return '환자 상태를 확인할 수 없어 빠른처방을 할 수 없어요. 차트에서 확인하세요.';
  }
}

/** 차단 시 짧은 배지/라벨 문구 (인라인 패널용) */
export function rxInClinicShortLabel(reason: RxInClinicBlockReason | null): string {
  switch (reason) {
    case 'discharged':
      return '귀가(수납완료) 환자 — 빠른처방 불가';
    case 'not_today':
      return '오늘 내원 환자 아님 — 빠른처방 불가';
    case 'cancelled':
      return '취소된 접수 — 빠른처방 불가';
    case 'missing':
    default:
      return '상태 확인 불가 — 빠른처방 불가';
  }
}
