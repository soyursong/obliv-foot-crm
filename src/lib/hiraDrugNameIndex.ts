// hiraDrugNameIndex — HIRA 명칭 인덱스(외부 참조 유니버스) 정규화·코드축 공용 유틸.
// Ticket: T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
// DA CONSULT-REPLY: DA-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 (GO / Option A / ADDITIVE).
//   SSOT = da_decision_foot_rxset_hira_name_index_ac8_20260803.md
//
// ⚠️ 이 모듈은 코퍼스 적재/조회의 **정규화·코드축 규칙**만 담는 순수 유틸이다.
//    ★VG-4: AC-8은 코퍼스만 적재한다. 이 파일은 computeDrugVerifyVerdict 를 건드리지 않는다
//      (partial 활성화=forward read-path=VG-1 후속 트랙, 별도). 여기에는 판정 로직이 없다.
//    ★VG-1(query-path topology): partial 발화의 조회 경로(FE bounded load vs 서버 SECDEF RPC)는
//      코퍼스 사이징 후 확정(evidence 문서 참조). 코퍼스가 크면 서버 lookup → 신규 SECDEF RPC 착지 시
//      DA 재-CONSULT 트리거(b). 그 RPC/FE 조회부는 이 티켓 범위 밖.
//
// 데이터 의존 0 · 외부 호출 0 · 신규 패키지 0 (순수 함수/상수만).

/**
 * 명칭 정규화(매칭 전처리) — 코퍼스 적재(name_normalized)와 조회 질의가 **동형**으로 써야
 * write/read 정합이 성립(AC-3 computeVerifyInputHash 와 동일 원리).
 *   · 앞뒤 공백 제거 + 내부 연속 공백 1칸 축약 + 소문자 fold(영문 대소문자 차 흡수).
 *   · ★용량/함량 표기(250mg 등)는 제거하지 않는다 — drug_identity_rule canon(용량표기 자동연결 금지).
 *     "테르비나핀정 250mg" ≠ "테르비나핀정"(서로 다른 표기로 취급).
 *   · 퍼지(부분일치·유사도) 없음 — 정규화만. (trigram 인덱스는 서버-side 후보검색용이며,
 *     partial 판정은 정확일치 규칙을 상위에 둔다: AC-2 '정확일치=partial / 모호=unverified'.)
 * ※ normalizeIngredientName(drugVerification.ts)과 동일 canon 규칙 — 필드(제품명 vs 성분명)만 다르다.
 */
export function normalizeHiraDrugName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 품목기준코드9 접두 규약 — cross-ref 시 붙이는 prescription_codes.claim_code namespace. */
export const HIRA_CLAIM_CODE_PREFIX = 'HIRA-' as const;

/**
 * 품목기준코드9(자연 unique 키) 정규화 — 앞뒤 공백 제거만(코드 자체는 대소문자 없음).
 * 빈 문자열/부적격이면 null(적재 skip 대상).
 */
export function normalizeItemStdCode(code: string | null | undefined): string | null {
  const c = (code ?? '').trim();
  return c === '' ? null : c;
}

/**
 * item_std_code → prescription_codes.claim_code cross-ref 키('HIRA-'||code).
 * ★FK 아님(VG-3): 순수 reference-lookup 규칙. 매칭 시 claim_code 에서 접두를 벗겨 대조한다.
 */
export function toHiraClaimCode(itemStdCode: string | null | undefined): string | null {
  const code = normalizeItemStdCode(itemStdCode);
  return code == null ? null : `${HIRA_CLAIM_CODE_PREFIX}${code}`;
}

/** claim_code('HIRA-{code}')에서 품목기준코드9 추출(접두 없으면 그대로·EDI 등 비대상은 호출측 책임). */
export function fromHiraClaimCode(claimCode: string | null | undefined): string | null {
  const code = (claimCode ?? '').trim();
  if (code === '') return null;
  return code.startsWith(HIRA_CLAIM_CODE_PREFIX)
    ? code.slice(HIRA_CLAIM_CODE_PREFIX.length)
    : code;
}

/** 코퍼스 1행의 적재 표현(import 스크립트 write 표현). DB row 전체 아님. */
export interface HiraDrugNameIndexRow {
  item_std_code: string;
  name_ko: string;
  name_normalized: string;
  ingredient_code: string | null;
  ingredient_name: string | null;
  source_ref: string;
}

/**
 * 원천(source A) 레코드 → 적재 행 빌드(순수). 부적격(코드/명칭 부재)이면 null(skip).
 *   name_normalized 는 반드시 normalizeHiraDrugName 로 산출(write/read 동형 보장).
 */
export function buildHiraDrugNameIndexRow(
  src: {
    item_std_code?: string | null;
    name_ko?: string | null;
    ingredient_code?: string | null;
    ingredient_name?: string | null;
  },
  sourceRef: string,
): HiraDrugNameIndexRow | null {
  const code = normalizeItemStdCode(src.item_std_code);
  const name = (src.name_ko ?? '').trim();
  if (code == null || name === '') return null;
  return {
    item_std_code: code,
    name_ko: name,
    name_normalized: normalizeHiraDrugName(name),
    ingredient_code: (src.ingredient_code ?? '').trim() || null,
    ingredient_name: (src.ingredient_name ?? '').trim() || null,
    source_ref: sourceRef,
  };
}
