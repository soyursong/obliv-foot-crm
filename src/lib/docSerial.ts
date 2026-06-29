// T-20260622-foot-DOCSERIAL-AUTOGEN — 서류 출력 연번호 자동 생성 (단일 config / 헬퍼)
//
// 연번호 형식: {서류종류 prefix}-{발급일 YYYYMMDD}-{차트번호 F-XXXX}-{발급순번 2자리}
//   예) VC-20260622-F-4302-01
//
// 발급순번 = C(무리셋 통산) — 날짜·서류종류·환자 무관 단일 통산 카운터(클리닉 단위). 발번마다 +1, 리셋 없음.
//   (확정: 김주연 총괄 2026-06-29 MSG-20260629-202802-cyn1 / FIX-REQUEST T-20260622-foot-DOC-SERIAL-AUTOGEN.
//    이전 'A. 일별·환자·서류종류 리셋' 기각 → C 단일 통산으로 변경. 일별/파티션 리셋 로직 제거.)
//   form_submissions read-only count(clinic 전역) 으로 산출 → DB 스키마 변경 0 (영속 컬럼/시퀀스 미사용).
//   미리보기는 INSERT 하지 않으므로 반복 호출해도 seq 불변(idempotent, AC-4 '재출력=불변').
//   실제 출력(form_submissions INSERT) 후 재오픈 시 전역 count+1 → '신규 교부=통산 +1'(전체 연번호 항상 유일).
//   ⚠ 동시 발번 race: runtime count+1(approach b)는 유니크 제약이 없어 동시 INSERT 시 동일 seq 가능.
//     단일 클리닉·순차 발행 환경에서 window 극소. 완전 보장은 DB 시퀀스+유니크 제약(approach a, ADDITIVE,
//     data-architect CONSULT 게이트) 후속 필요 — 본 변경 범위 외(planner 비차단 FOLLOWUP).
//
// ⚠ 이 파일은 LOGIC-LOCK L-006 대상이 아니다(신규 파일). 단, DocumentPrintPanel 에서 호출하므로
//   prefix 매핑/형식 변경 시 서류 출력 회귀 확인 필요.

/**
 * 서류종류(form_key) → 연번호 prefix 매핑. **단일 SSOT config.**
 *
 * 김주연 총괄(풋센터) 확정 10종 (MSG-20260622-163946-ld2r, ts:1782113892.666469):
 *   진료비영수증=REC / 진료비세부내역서=BILL / KOH균검사결과지=KOH / 소견서=OPN / 진단서=DIAG /
 *   진료확인서=VC / 진료의뢰서=REF / 통원확인서=AV / 진료기록사본=MR / 처방전=RX
 *   (VC=진료확인서, AV=통원확인서로 분리 확정 — 이전 prefix 충돌 해소)
 *
 * form_key 매핑 근거 = formTemplates.ts DOCLIST_ORDER_10 (운영 DB form_templates 실측 2026-06-20):
 *   bill_receipt / bill_detail / koh_result / diag_opinion / diagnosis / treat_confirm /
 *   referral_letter / visit_confirm / medical_record_request / rx_standard
 *
 * ⚠ 표에 없는(11번째+) form_key 는 여기 등록하지 않는다(임의 prefix 하드코딩 금지).
 *   미등록 form_key → buildDocSerial 가 null 반환(발번 보류, 안전 fallback). 확정 매핑은
 *   responder relay 후 본 config 1곳만 갱신해 일괄 반영.
 */
export const DOC_SERIAL_PREFIX: Readonly<Record<string, string>> = {
  bill_receipt: 'REC',            // 진료비영수증
  bill_detail: 'BILL',            // 진료비세부내역서
  koh_result: 'KOH',              // KOH균검사결과지
  diag_opinion: 'OPN',            // 소견서
  diagnosis: 'DIAG',              // 진단서
  treat_confirm: 'VC',            // 진료확인서
  referral_letter: 'REF',         // 진료의뢰서
  visit_confirm: 'AV',            // 통원확인서
  medical_record_request: 'MR',   // 진료기록사본
  rx_standard: 'RX',              // 처방전
};

/** form_key 에 확정된 prefix 가 있으면 반환, 없으면 null(발번 보류). */
export function docSerialPrefix(formKey: string | null | undefined): string | null {
  if (!formKey) return null;
  return DOC_SERIAL_PREFIX[formKey] ?? null;
}

/** 발급순번 2자리 zero-pad ('01', '02' … '99' 초과는 그대로). */
export function formatIssueSeq(seq: number): string {
  return String(Math.max(1, Math.trunc(seq))).padStart(2, '0');
}

export interface DocSerialParts {
  /** 서류 form_key (prefix 매핑 키) */
  formKey: string | null | undefined;
  /** 차트번호 (예: 'F-4302'). 미발번(null/빈값)이면 연번호 발번 보류. */
  chartNo: string | null | undefined;
  /** 발급일 YYYYMMDD (Asia/Seoul). */
  dateYYYYMMDD: string;
  /** 발급순번(1-base). null 이면 아직 산출 전 → 발번 보류. */
  seq: number | null | undefined;
}

/**
 * 연번호 문자열 생성. `{prefix}-{YYYYMMDD}-{chartNo}-{NN}`.
 * 아래 중 하나라도 빠지면 null 반환(임시값 fabrication 금지 — 호출부가 기존 fallback 유지):
 *   - form_key 미등록(확정 10종 외) → prefix 없음
 *   - 차트번호 미발번
 *   - 발급순번 미산출(count 쿼리 진행 중)
 */
export function buildDocSerial(parts: DocSerialParts): string | null {
  const prefix = docSerialPrefix(parts.formKey);
  if (!prefix) return null;
  const chart = (parts.chartNo ?? '').trim();
  if (!chart) return null;
  if (parts.seq === null || parts.seq === undefined) return null;
  if (!parts.dateYYYYMMDD) return null;
  return `${prefix}-${parts.dateYYYYMMDD}-${chart}-${formatIssueSeq(parts.seq)}`;
}
