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
  treat_confirm: 'VC',            // 진료확인서 (레거시 단일 — 기존 발행문서 재출력 보존)
  // T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT: 진료확인서 2 발급폼 분리.
  //   code/nocode 는 동일 '서류종류(진료확인서)'의 표시변이 → prefix 둘 다 VC 공유.
  //   11번째 서류종류 신설·발번 분기 금지(티켓 §5) → 같은 VC 통산열 사용.
  treat_confirm_code: 'VC',       // 진료확인서(코드·진단명 포함)
  treat_confirm_nocode: 'VC',     // 진료확인서(코드·진단명 불포함)
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

/**
 * 처방전 교부번호(issue_no) 당일 순번 zero-pad 폭 N — **설정 상수 (CEO 지시 MSG-n7ip: 하드코딩 금지)**.
 *
 * 교부번호 총자릿수 = 8(YYYYMMDD) + N. 자릿수 규격이 검증 중이라 **파라미터화**한다:
 *   - 총괄 확정(MSG-a2zc) = N=6 → 총 14자리 (예 20260718000025)
 *   - 심평원 실무 안내(약업신문 게재 규격) = N=5 → 총 13자리 (예 2026071800025)
 *   확정 검증 경로: (a) 「요양급여비용 청구방법·명세서서식·작성요령」 law.go.kr admRulSeq=2000000081143,
 *                  (b) 반려 약국 실무검증(RX-DUR-INTEGRATION-SCOPE AC6, 자릿수/형식 확인 포함).
 *   → N lock 시 **이 상수 1줄만 flip**(재수정 비용 제거). length CHECK/정규식을 특정 자릿수로 고정 금지.
 *
 * ⚠ 현재값 = 6 (총괄 확정 잠정). 심평원 규격(5) 확정 시 이 값만 5 로 변경.
 */
export const ISSUE_NO_SEQ_WIDTH = 6;

/**
 * 처방전 교부번호(issue_no) 생성 — (8+N)자리 = YYYYMMDD(발행일 8) + 당일 clinic 발행순번(zero-pad N).
 *   예) buildIssueNo('20260718', 25) → '20260718000025'  (N=6, "제 20260718000025 호")
 *       buildIssueNo('20260718', 25, 5) → '2026071800025'  (N=5, 심평원 실무규격)
 *
 * T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (총괄 확정 format MSG-a2zc):
 *   앞 8 = 발행 날짜(Asia/Seoul) / 뒤 N = 해당 의료기관(clinic) 당일 순차번호 zero-pad.
 *   ⚠ 폐기: 기존 UUID-slice fallback(checkIn.id.slice(0,5).toUpperCase()) — 약국 판독불가 교부번호로
 *     실제 처방전 반려(약 수령 실패)를 유발한 실사고. 다시 도입 금지.
 *   ⚠ zero-pad 폭은 하드코딩하지 않는다(CEO n7ip). 기본값 = ISSUE_NO_SEQ_WIDTH 설정 상수.
 *   seq 미산출(null/undefined) 또는 날짜 형식 이상이면 null 반환(임시값 fabrication 금지 —
 *     호출부는 발번 완료를 대기하거나 seq=1 로 폴백해 (8+N)자리를 항상 보장).
 *
 * ※ 당일 순번의 gapless·동시성 무결성 완전 보장은 DB 당일-스코프 시퀀스/유니크 제약(ADDITIVE,
 *   data-architect CONSULT 게이트) 후속 필요 — 본 FE 헬퍼 범위 외(planner 비차단 FOLLOWUP).
 */
export function buildIssueNo(
  dateYYYYMMDD: string,
  seq: number | null | undefined,
  seqWidth: number = ISSUE_NO_SEQ_WIDTH,
): string | null {
  if (!dateYYYYMMDD || dateYYYYMMDD.length !== 8) return null;
  if (seq === null || seq === undefined || !Number.isFinite(seq)) return null;
  const n = Math.max(1, Math.trunc(seq));
  return `${dateYYYYMMDD}${String(n).padStart(seqWidth, '0')}`;
}
