// examFlagPreserve — Surface B(피검사/KOH 치료신청) 플래그 보존 순수 로직 SSOT
// Ticket: T-20260724-foot-CHART2-TREATREQ-PKG-DECOUPLE
//
// [지배 RC] 피검사/KOH '치료신청' 은 request_blood_test_for_customer / request_koh_for_customer RPC 가
//   check_in_services.blood_test_requested / koh_requested 에 마킹하는 check-in 단위 플래그다.
//   결제 저장/자동저장(PaymentMiniWindow)이 check_in_services 를 DELETE+reinsert 할 때 이 플래그를
//   재적용하지 않으면 항상 false 로 초기화(clobber) → "치료테이블 이동/재진입 시 치료신청 체크 풀림"
//   재발의 근본 원인. (앞 2배포는 체크박스가 읽지도 않는 check_ins.package_id 를 고쳐 증상 생존.)
//
// [해소] DELETE 前 스냅샷한 플래그를 reinsert 행에 복원한다(package_session_id C3 보존과 동일 패턴).
//   no-DDL — 旣존 컬럼만 사용. 프로덕션·E2E 테스트 공용 SSOT(로직 드리프트 방지).

export interface ExamFlagState {
  blood: boolean;
  koh: boolean;
}

export type CisInsertRow = {
  check_in_id: string;
  service_id: string | null;
  service_name: string;
  price: number;
  original_price: number;
  is_package_session: boolean;
  package_session_id?: string | null;
  blood_test_requested?: boolean;
  koh_requested?: boolean;
};

/** KOH(균검사) 신청 플래그가 실리는 서비스명 판정 — request_koh_for_customer RPC 의 service_name 필터와 동일. */
export const isKohServiceName = (name: string | null | undefined): boolean =>
  /KOH|진균검사/i.test(name ?? '');

/**
 * DELETE+reinsert 하는 check_in_services 재저장 시 피검사/KOH 치료신청 플래그를 재적용해 clobber 를 막는다.
 *   · 피검사(blood): check-in 전체 행에 적용(request_blood_test_for_customer RPC UPDATE-all 과 동형).
 *   · KOH(koh): KOH명 행에만 적용. 재저장 행에 KOH명 행이 없으면 요청 마커 행(service_id NULL, price 0)을
 *     추가해 보존(request_koh_for_customer 의 no-service-row INSERT 동형). marker 행은 서비스 복원
 *     (services.find(service_id))에서 무시되므로 UI 부작용 0.
 *   · 재저장 행이 아예 없는데 blood 만 켜져 있으면 피검사 마커 행으로 보존.
 * baseRows 를 in-place 로 갱신하고 동일 배열을 반환한다(호출부 편의).
 */
export function applyExamFlagsToReinsert(
  baseRows: CisInsertRow[],
  checkInId: string,
  flags: ExamFlagState,
): CisInsertRow[] {
  for (const r of baseRows) {
    r.blood_test_requested = flags.blood;
    r.koh_requested = flags.koh && isKohServiceName(r.service_name);
  }
  if (flags.koh && !baseRows.some((r) => r.koh_requested === true)) {
    baseRows.push({
      check_in_id: checkInId,
      service_id: null,
      service_name: 'KOH 진균검사(요청)',
      price: 0,
      original_price: 0,
      is_package_session: false,
      package_session_id: null,
      blood_test_requested: flags.blood,
      koh_requested: true,
    });
  }
  if (flags.blood && baseRows.length === 0) {
    baseRows.push({
      check_in_id: checkInId,
      service_id: null,
      service_name: '혈액검사(피검사)',
      price: 0,
      original_price: 0,
      is_package_session: false,
      package_session_id: null,
      blood_test_requested: true,
      koh_requested: false,
    });
  }
  return baseRows;
}
