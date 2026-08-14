/**
 * T-20260814-foot-STAFFCHANGE-CONFIRM-POPUP — 담당자(assigned_staff_id) 변경 확인 가드 (canonical 공유 home).
 *
 * ★두 surface 공통 가드(김주연 총괄 MSG-20260814-205523-c4z3, SCOPE-EXPAND):
 *   ① 차트 담당자 변경 '모든 경로'(2번차트 정보구역·상담탭 select, 예약상세 팝업 담당자 select)
 *   ② 배분이력 담당자 변경 UI(자매 T-20260724 AC-5 — assigned_staff_id write UI, 게이트 해소 후 이 모듈 재사용)
 *   → 위 진입점이 모두 이 단일 모듈을 import 재사용한다 = 중복구현 금지(split-brain 방지, 문구·동작 1곳 SSOT).
 *   window.confirm 기반(기존 2번차트 구현 패턴 계승) — 새 모달 컴포넌트 추상화 없이 동일 동작을 1곳으로 단일화.
 *
 * 트리거 규칙: 이미 담당자가 지정된(prev 비어있지 않음) 고객의 담당자를 '다른 값'으로 바꾸려는 시점만.
 *   · 최초지정(빈값 '' → 값) = 변경 아님 → 팝업 없음(그대로 저장).
 *   · 동일값 재선택 = 변경 아님 → 팝업 없음.
 *   · 담당 해제(값 → 빈값/미배정)도 '변경'(prev 지정 + 새 값 상이) → 팝업 노출.
 *
 * ★deploy_coordination(배포순서, 하드블록 아님): money-attribution 문장('이후 매출은 신규 담당자 앞으로
 *   귀속됩니다')은 자매 T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE(Branch A) 스냅샷
 *   (attributed_staff_id)이 prod 반영된 이후에만 사실과 일치. 스냅샷 前 현행은 담당자 변경 시 과거 매출까지
 *   live-join 재귀속되어 이 문장이 현장에 오도됨.
 *   → 배포는 스냅샷 deployed 와 함께/그 다음(supervisor 배포게이트 C16 deploy-order 로 강제).
 *   → 조기 배포가 불가피하면 confirmStaffChange 호출부의 문구를 STAFFCHANGE_CONFIRM_MSG_SOFT 로 1줄 교체
 *     (스냅샷 라이브 시 STAFFCHANGE_CONFIRM_MSG 원안 복원). dev-foot 판단 + supervisor 배포게이트 확인.
 */

/** 원안(김주연 총괄) — money-attribution 문장 포함. 기본 문구. */
export const STAFFCHANGE_CONFIRM_MSG =
  '담당자를 정말 변경하시겠습니까?\n이후 매출은 신규 담당자 앞으로 귀속됩니다.';

/** 완화판 — T-20260724 스냅샷 라이브 前 조기배포 fallback(money-attribution 문장 생략). deploy_coordination 참조. */
export const STAFFCHANGE_CONFIRM_MSG_SOFT = '담당자를 정말 변경하시겠습니까?';

/**
 * 재지정 판정: 기존값이 지정돼 있고(prev 비어있지 않음) 새 값이 기존과 다를 때만 true.
 *   최초지정(prev==='')·동일값(next===prev)은 false → 팝업 미노출.
 * @param prev 기존 담당자 값('' = 미지정, 그 외 = staff.id)
 * @param next 새 담당자 값('' = 미지정, 그 외 = staff.id)
 */
export function isStaffReassignment(
  prev: string | null | undefined,
  next: string | null | undefined,
): boolean {
  const p = prev ?? '';
  const n = next ?? '';
  return p !== '' && n !== p;
}

/**
 * 담당자 변경 확인 가드(공통). 재지정이면 window.confirm 노출, 아니면(최초지정/동일값) 팝업 없이 통과.
 *   [취소] 시 호출부는 반드시 write/state 변경 전에 early-return 해 기존 담당자를 유지해야 한다.
 * @param prev 기존 담당자 값('' = 미지정, 그 외 = staff.id)
 * @param next 새 담당자 값('' = 미지정, 그 외 = staff.id)
 * @param msg  확인 문구(기본 = 원안 STAFFCHANGE_CONFIRM_MSG). 조기배포 시 SOFT 로 교체 가능.
 * @returns true = 진행(변경 아님 또는 [확인]) / false = 중단([취소], 기존 담당자 유지)
 */
export function confirmStaffChange(
  prev: string | null | undefined,
  next: string | null | undefined,
  msg: string = STAFFCHANGE_CONFIRM_MSG,
): boolean {
  if (!isStaffReassignment(prev, next)) return true; // 최초지정/동일값 = 변경 아님 → 무팝업 통과
  return window.confirm(msg);
}
