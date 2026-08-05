// issuanceHistory.ts — 발행 이력(발행된 서류) 목록 판별 SSOT.
//
// T-20260805-foot-PREVDOC-OPEN-FAIL (RC 확정 — 현장 F-4741 07/28 '알 수 없는 양식 임시'):
//   form_submissions 테이블은 두 종류의 row 를 담는다.
//     ① 실제 발행된 출력 서류(계산서·영수증·처방전·소견서 등) — 항상 template_id 를 세팅해 INSERT.
//     ② 내부 상태 레코드 — 혈액/검사 접수·항목상태 레이어(examItemStatus.ts·BloodDailyListSection.tsx·
//        ExamTargetsSection.tsx)가 form_submissions 를 key-value 영속 저장소로 재사용하며
//        template_id=NULL·status='draft' 로 기록(field_data.form_key =
//        blood_reception_daily·blood_item_action_status·koh_exam_item_status).
//
//   ②는 출력 서류가 아니다. 그런데 발행 이력 목록이 check_in 의 전체 form_submissions 를 필터 없이
//   렌더하면서 ②까지 섞여 '알 수 없는 양식 임시'(양식 미해석 fallback 라벨 + draft 뱃지)로 노출됐고,
//   template_id 가 없어 클릭해도 양식이 해석되지 않아 열리지 않았다(열기·수정·저장 3동작 동반 실패의 표면).
//
//   판별 규칙 = printable-doc 불변식: '발행된 서류'는 template_id 를 갖는다. template_id=NULL writer 는
//   위 상태 레이어뿐(전 코드 전수 grep 확인). 구조 불변식 기반이라 향후 신규 상태 레이어(동일 NULL 패턴)도
//   자동 제외 — form_key 하드코딩 열거가 불필요하다.

/** 발행 이력에 노출할 '실제 발행된 서류' 판별. template_id 가 있으면 발행 서류, 없으면 내부 상태 레코드. */
export function isPrintableSubmission(sub: { template_id?: string | null }): boolean {
  return !!sub.template_id;
}

/** form_submissions 목록에서 발행 이력에 노출할 서류만 남긴다(내부 상태 레코드 제외). */
export function filterIssuanceHistory<T extends { template_id?: string | null }>(subs: T[]): T[] {
  return subs.filter(isPrintableSubmission);
}
