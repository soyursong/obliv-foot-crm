// drugVerification — 약품 외부DB(HIRA/식약처) 3-key 검증 판정 모델 (FE-presentational)
// Ticket: T-20260629-foot-RXSET-DRUG-EXTDB-VERIFY (AC-2 매칭설계 / AC-4 검증배지)
//
// ⚠️ 이 모듈은 화면 배지 렌더용 FE 상태 모델·순수 매핑이다. **DB 컬럼/enum 아님.**
//    검증결과 영속 캐시 스키마는 AC-3(prescription_codes 클러스터 종료 후, data-architect
//    CONSULT 선행)에서 별도 확정한다. 캐시 스키마 확정 시 그 값을 이 FE 모델로 매핑한다.
//    (planner MSG-20260629-045932-1hly: AC-3 스키마 보류·추정 착수 금지.)
//
// 매칭 설계(AC-2, evidence/...AC2_matching_design.md §2~§3 요약):
//   Tier1 코드(HIRA 표준코드/EDI) 정확매칭 → 'verified' (1급)
//   Tier2 코드 부재/불일치 → 상품명(+성분명) 보조: 정확일치='partial' / 모호=자동연결금지='unverified'
//   성분축(식약처 E, 2차 비차단): 'matched' | 'mismatch' | 'unverified'(graceful degrade, AC-5)
//   퍼지·용량표기 자동연결 금지(drug_identity_rule auto-merge 금지 정합).
//
// 데이터 의존 0 · 외부 호출 0 · 신규 패키지 0 (순수 함수/상수만).

/** 약 코드축(HIRA) 1차 검증 상태 — 화면 배지 1급 표시. */
export type DrugVerifyStatus = 'verified' | 'partial' | 'unverified' | 'pending';

/** 성분명축(식약처 E) 2차 보조 검증 상태 — 비차단 부가표기. */
export type IngredientVerifyStatus = 'matched' | 'mismatch' | 'unverified';

/** 단일 약의 검증 판정(presentational). DB row 아님. */
export interface DrugVerifyVerdict {
  status: DrugVerifyStatus;
  /** 식약처 성분 2차축 — 미수행/대조불가 시 undefined(배지 보조표기 생략). */
  ingredient?: IngredientVerifyStatus;
}

/** ui/Badge variant 키 부분집합(직접 정합). */
export type DrugVerifyBadgeVariant = 'success' | 'teal' | 'outline' | 'secondary';

interface VerifyStatusMeta {
  /** 배지 라벨(한국어, 현장 친화 — 개발용어 배제). */
  label: string;
  /** ui/Badge variant. */
  variant: DrugVerifyBadgeVariant;
  /** 배지 앞 표식(없으면 빈 문자열). */
  mark: string;
  /** hover 툴팁 설명 문구. */
  tooltip: string;
  /** 사람 확인이 필요한 상태인가(현장 후속액션 유도). */
  needsHumanCheck: boolean;
}

const STATUS_META: Record<DrugVerifyStatus, VerifyStatusMeta> = {
  verified: {
    label: '코드확인',
    variant: 'success',
    mark: '✓',
    tooltip: '심평원(HIRA) 약품코드와 정확히 일치 — 외부 공식 약품DB로 확인된 약입니다.',
    needsHumanCheck: false,
  },
  partial: {
    label: '이름대조',
    variant: 'teal',
    mark: '',
    tooltip: '약품코드가 없어 상품명으로만 대조했습니다. 코드 확인을 권장합니다.',
    needsHumanCheck: true,
  },
  unverified: {
    label: '미확인',
    variant: 'outline',
    mark: '!',
    tooltip: '외부 약품DB와 자동으로 일치시키지 못했습니다(모호). 직접 확인이 필요합니다.',
    needsHumanCheck: true,
  },
  pending: {
    label: '대조전',
    variant: 'secondary',
    mark: '',
    tooltip: '아직 외부 약품DB와 대조하지 않았습니다.',
    needsHumanCheck: false,
  },
};

const INGREDIENT_META: Record<IngredientVerifyStatus, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  matched: { label: '성분일치', tone: 'ok' },
  mismatch: { label: '성분불일치', tone: 'warn' },
  unverified: { label: '성분 미확인', tone: 'muted' }, // 식약처 미수행/장애(AC-5 graceful degrade)
};

/** status → 배지 메타. 알 수 없는 값은 안전하게 'pending'으로 폴백. */
export function describeVerifyStatus(status: DrugVerifyStatus | string | null | undefined): VerifyStatusMeta {
  const key = (status ?? '') as DrugVerifyStatus;
  return STATUS_META[key] ?? STATUS_META.pending;
}

/** 성분 2차축 → 부가표기 메타. 없으면 null(배지 보조표기 생략). */
export function describeIngredient(
  ingredient: IngredientVerifyStatus | string | null | undefined,
): { label: string; tone: 'ok' | 'warn' | 'muted' } | null {
  const key = (ingredient ?? '') as IngredientVerifyStatus;
  return INGREDIENT_META[key] ?? null;
}

/** 판정에 사람 확인이 필요한가(현장 후속액션 유도용). 성분 불일치도 주의 대상. */
export function verdictNeedsHumanCheck(verdict: DrugVerifyVerdict | null | undefined): boolean {
  if (!verdict) return false;
  if (describeVerifyStatus(verdict.status).needsHumanCheck) return true;
  return verdict.ingredient === 'mismatch';
}

// ---------------------------------------------------------------------------
// AC-7 식약처(MFDS) 2차 성분축 대조 — 순수 판정 로직.
// Ticket: T-20260629-foot-RXSET-DRUG-VERIFY-PHASE2
//
//   ⚠️ 외부 호출 0 · 신규 DB 스키마 0 (여기는 순수 함수만). 실 대조 데이터(공식 성분명)는
//      Edge Function(mfds-ingredient-verify)이 식약처 e약은요/완제의약품 OpenAPI에서 가져오고,
//      본 함수들은 그 값으로 판정만 한다. 키(data.go.kr)=Edge Secret(supervisor 주입, 평문하드코딩 금지).
//      키 부재/장애 → 'unverified'(AC-5 graceful degrade, 비차단 — 1차 HIRA 코드축은 항상 동작).
//   ★canon(부모 drug_identity_rule): 퍼지 매칭·용량표기 자동연결 금지(auto-merge 금지).
// ---------------------------------------------------------------------------

/**
 * 성분명 정규화(대조 전처리). canon 준수:
 *   · 앞뒤 공백 제거 + 내부 연속 공백 1칸 축약 + 소문자 fold(영문 대소문자 차 흡수).
 *   · ★용량/함량 표기(250mg 등)는 제거하지 않는다 — 용량표기 자동연결 금지.
 *     따라서 "아목시실린 250mg" ≠ "아목시실린"(서로 다른 성분표기로 취급).
 *   · 퍼지(부분일치·유사도) 없음 — 정확일치 전용.
 */
export function normalizeIngredientName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 내부 성분명 ↔ 식약처 공식 성분명(들) 대조 판정(순수, canon).
 *   · officialNames 중 하나라도 정규화 후 정확일치 → 'matched'.
 *   · officialNames 가 있는데 아무것도 정확일치 안 함 → 'mismatch'(성분 주의).
 *   · 내부 성분명 없음 or 공식 목록 없음(대조불가) → 'unverified'(비차단).
 *   ※ 정확일치만 인정 — 퍼지/용량표기 자동연결 금지.
 */
export function compareIngredient(
  internalName: string | null | undefined,
  officialNames: readonly (string | null | undefined)[] | null | undefined,
): IngredientVerifyStatus {
  const internal = normalizeIngredientName(internalName);
  const officials = (officialNames ?? [])
    .map(normalizeIngredientName)
    .filter((s) => s !== '');
  if (internal === '' || officials.length === 0) return 'unverified';
  return officials.includes(internal) ? 'matched' : 'mismatch';
}

/**
 * 1차(HIRA 코드축) 판정에 2차 성분축을 결합(순수). **1차 status 는 절대 바꾸지 않는다.**
 *   · 'matched'/'mismatch' → 배지 보조표기 유지(확인/주의 신호).
 *   · 'unverified'(대조불가 — 키 미주입·장애 포함) → 보조표기 생략(undefined)으로 접는다:
 *     매 약마다 "성분 미확인"을 띄우면 노이즈이므로, 실제로 못 맞춘 경우만 조용히 생략(graceful).
 */
export function mergeIngredientAxis(
  verdict: DrugVerifyVerdict | null | undefined,
  ingredient: IngredientVerifyStatus | null | undefined,
): DrugVerifyVerdict | null {
  if (!verdict) return null;
  if (ingredient == null || ingredient === 'unverified') return { ...verdict };
  return { ...verdict, ingredient };
}

// ---------------------------------------------------------------------------
// 검증 판정 산출(AC-2 매칭로직) — 외부 공식소스(HIRA) 출처 기반.
//   ⚠️ 외부 API 런타임 호출 0 · 신규 DB 스키마 0. prescription_codes 에 이미 있는 출처 필드
//      (code_source · claim_code · insurance_status_source)만으로 판정한다.
//      검증결과 영속 캐시(AC-3) · 식약처 성분축(2차) · HIRA 명칭 인덱스 적재는 후속 트랙(직렬화).
//
//   판정 근거(외부 공식DB 출처 = source-of-truth):
//     · insurance_status_source='hira' → 월배치가 약제급여목록(외부 공식)에 코드 positively 매칭 → verified
//     · code_source='official'(실코드)  → HIRA 의약품표준코드 master 출처 코드 보유 → verified
//     · code_source='custom' / LEGACY  → 자체 입력약(외부 공식DB 미수록) → unverified(사람확인)
//     · 그 외 / 판정불가                → pending(대조전, graceful degrade — 에러 아님)
//   ※ 'partial'(상품명만 대조)은 HIRA 명칭 인덱스 적재(후속 트랙) 후 산출 — 현재는 미발생.
//   ※ 검증 실패(unverified)는 저장/처방을 차단하지 않는다 — 표시 전용(AC-6 비차단).
// ---------------------------------------------------------------------------

/** 검증 판정 입력 — prescription_codes 출처 필드의 부분집합(읽기). DB row 전체 아님. */
export interface DrugVerifyInput {
  claim_code?: string | null;
  /** 'official'(HIRA 표준코드 master 출처) | 'custom'(자체 입력약). */
  code_source?: string | null;
  /** 'hira'(월배치 급여목록 매칭) | 'manual' | null. 없으면 code_source 로 판정. */
  insurance_status_source?: string | null;
}

/** 자체/이관 placeholder 코드 형태(실 HIRA 코드 아님 — LEGACY-/HIRA-STD-/HIRA- 접두). */
const PLACEHOLDER_CODE_RE = /^(LEGACY|HIRA-STD|HIRA)[-_]/i;

/** 코드가 외부 공식(HIRA) 실코드인가(placeholder 아님). */
export function isExternalOfficialCode(
  claimCode: string | null | undefined,
  codeSource: string | null | undefined,
): boolean {
  const code = (claimCode ?? '').trim();
  if (code === '') return false;
  if (PLACEHOLDER_CODE_RE.test(code)) return false;
  return (codeSource ?? '').trim().toLowerCase() === 'official';
}

/**
 * 약 1건의 외부DB 검증 판정 산출(presentational). DB row/enum 아님.
 * 외부 호출 0 · 신규 스키마 0 — 기존 출처 필드만으로 결정.
 */
export function computeDrugVerifyVerdict(
  input: DrugVerifyInput | null | undefined,
): DrugVerifyVerdict | null {
  if (!input) return null;
  const codeSource = (input.code_source ?? '').trim().toLowerCase();
  const insSource = (input.insurance_status_source ?? '').trim().toLowerCase();
  const claim = (input.claim_code ?? '').trim();
  const isPlaceholder = claim !== '' && PLACEHOLDER_CODE_RE.test(claim);

  // 외부 공식 급여목록(HIRA)에 월배치가 positively 매칭한 코드 → 코드확인.
  if (insSource === 'hira') return { status: 'verified' };

  // HIRA 의약품표준코드 master 출처의 실코드 보유 → 코드확인.
  if (isExternalOfficialCode(claim, codeSource)) return { status: 'verified' };

  // 자체 입력약(custom) 또는 placeholder 코드 → 외부 공식DB 미확인(사람확인 필요).
  if (codeSource === 'custom' || isPlaceholder) return { status: 'unverified' };

  // 출처 불명·데이터 부족 → 대조전(에러 아님, AC-5 graceful degrade).
  return { status: 'pending' };
}

// ---------------------------------------------------------------------------
// AC-3 검증결과 영속 캐시 — read-side staleness 가드 + 읽기 폴백(J2/J3).
// Ticket: T-20260803-foot-RXSET-VERIFY-CACHE-AC3
// DA CONSULT-REPLY: DA-20260803-foot-RXSET-VERIFY-CACHE-AC3 (GO/ADDITIVE 조건부).
//   SSOT = da_decision_foot_rxset_verify_cache_ac3_20260803.md
//
// ★ 이 섹션은 prescription_codes 의 verify_* 캐시 컬럼(마이그레이션
//   20260803210000_prescription_codes_verify_cache.sql)을 "비-권위 성능 materialization"으로
//   안전하게 읽기 위한 순수 로직이다. 캐시는 절대 유일진실이 아니다.
//
//   J2 SSOT 방화벽(HARD): 이 모듈(computeDrugVerifyVerdict/compareIngredient)이 판정 권위.
//     캐시는 그 결과의 materialization일 뿐 → 읽기 경로는 항상 recompute 폴백 가능해야 하고,
//     캐시를 유일진실로 신뢰하지 않는다(FE 로직 개정 시 divergence 방지).
//   J3 staleness 가드(DISPOSITIVE·옵션 아님): 캐시 = 입력3필드(claim_code/code_source/
//     insurance_status_source)의 순수함수 + model_version. self-healing 방식(택1-a):
//       verify_input_hash(3입력 지문) + verify_model_version 을 읽기 시 대조 →
//       hash 불일치 OR version 불일치 → 캐시 MISS → recompute(트리거 불요,
//       FE 로직 버전업까지 자동 무효화). stale 을 조용히 서빙하면 캐시 없는 것보다 나쁘다.
//
//   ⚠️ 성분축(verify_ingredient)의 외부(MFDS) 원천 drift 는 이 hash 범위 밖이다
//      (DA J3 = 행-소유 3필드 + model_version 로 명시적 한정). 외부 성분 재검증은
//      EF(mfds-ingredient-verify)가 자체 주기로 재적재하며 verified_at 을 갱신한다.
//      FE 판정 로직(성분 대조 포함)이 바뀌면 VERIFY_MODEL_VERSION 을 올려 전체 무효화한다.
//   외부 호출 0 · 신규 패키지 0 (순수 함수/상수만).
// ---------------------------------------------------------------------------

/**
 * 검증 판정 로직 버전. computeDrugVerifyVerdict/compareIngredient(+매핑) 로직이 바뀔 때마다
 * 반드시 올린다. 읽기 시 캐시의 verify_model_version 과 불일치하면 캐시 MISS → recompute
 * (self-healing: FE 배포로 과거 캐시가 자동 무효화된다).
 */
export const VERIFY_MODEL_VERSION = 'v1' as const;

/** prescription_codes verify_* 캐시 컬럼의 읽기 표현(부분집합). DB row 전체 아님. */
export interface DrugVerifyCacheRow {
  verify_status?: string | null;
  verify_ingredient?: string | null;
  verify_matched_code?: string | null;
  verified_at?: string | null;
  verify_input_hash?: string | null;
  verify_model_version?: string | null;
}

/** 영속에 실을 verify_* 캐시 값(쓰기 표현). populate(EF/데스크) 가 그대로 UPDATE 한다. */
export interface DrugVerifyCacheWrite {
  verify_status: DrugVerifyStatus;
  verify_ingredient: IngredientVerifyStatus | null;
  verify_matched_code: string | null;
  verify_input_hash: string;
  verify_model_version: string;
}

/** 32-bit FNV-1a 지문(순수·동기·의존0). 브라우저/Deno(EF) 동일 산출 — 캐시 write/read 정합. */
function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * verify_input_hash 산출 — 판정에 영향을 주는 3입력의 canonical 지문.
 *   claim_code(trim) · code_source(trim+lower) · insurance_status_source(trim+lower).
 * ★compute 판정과 동일 정규화 → 판정 결과가 바뀌는 입력변경만 hash 를 바꾼다(정합).
 *   ★write/read 양쪽이 이 함수를 써야 self-healing 대조가 성립한다(EF 는 동형 포팅).
 */
export function computeVerifyInputHash(input: DrugVerifyInput | null | undefined): string {
  const claim = (input?.claim_code ?? '').trim();
  const codeSource = (input?.code_source ?? '').trim().toLowerCase();
  const insSource = (input?.insurance_status_source ?? '').trim().toLowerCase();
  return fnv1aHex(`${claim}${codeSource}${insSource}`);
}

/** verify_matched_code 스냅샷 — HIRA claim_code(placeholder 제외). FK 아님. 없으면 null. */
export function pickVerifyMatchedCode(input: DrugVerifyInput | null | undefined): string | null {
  const code = (input?.claim_code ?? '').trim();
  if (code === '' || PLACEHOLDER_CODE_RE.test(code)) return null;
  return code;
}

/**
 * J3 staleness 가드 — 캐시가 현재 입력·현재 로직버전에 대해 신선한가.
 *   verify_input_hash == computeVerifyInputHash(input)  AND
 *   verify_model_version == VERIFY_MODEL_VERSION        (둘 다 충족해야 HIT)
 * 하나라도 불일치/누락 → false(MISS → recompute).
 */
export function isVerifyCacheFresh(
  cache: DrugVerifyCacheRow | null | undefined,
  input: DrugVerifyInput | null | undefined,
): boolean {
  if (!cache) return false;
  if (!cache.verify_input_hash || !cache.verify_model_version) return false;
  if (cache.verify_model_version !== VERIFY_MODEL_VERSION) return false;
  return cache.verify_input_hash === computeVerifyInputHash(input);
}

/**
 * J2 읽기 폴백(권위 read 경로) — 캐시가 신선하면 캐시값으로 판정을 구성하고,
 * 아니면(MISS/누락/stale) computeDrugVerifyVerdict 로 recompute 한다. **캐시를 유일진실로 신뢰하지 않는다.**
 *   반환 source: 'cache'(HIT) | 'recompute'(MISS). 소비자는 이 함수만 호출하면 안전하다.
 */
export function resolveVerifyVerdict(
  cache: DrugVerifyCacheRow | null | undefined,
  input: DrugVerifyInput | null | undefined,
): { verdict: DrugVerifyVerdict | null; source: 'cache' | 'recompute' } {
  if (isVerifyCacheFresh(cache, input)) {
    const status = (cache?.verify_status ?? '') as DrugVerifyStatus;
    const known = STATUS_META[status] ? status : null;
    if (known) {
      const ing = (cache?.verify_ingredient ?? '') as IngredientVerifyStatus;
      const base: DrugVerifyVerdict = { status: known };
      return { verdict: mergeIngredientAxis(base, INGREDIENT_META[ing] ? ing : null), source: 'cache' };
    }
    // 캐시 status 가 알 수 없는 값 → 신뢰 금지, recompute 로 폴백.
  }
  return { verdict: computeDrugVerifyVerdict(input), source: 'recompute' };
}

/**
 * populate 헬퍼 — 현재 입력(+선택 성분 대조결과)으로 영속에 실을 verify_* 값을 만든다.
 * verified_at 은 쓰기 주체(DB now()/EF)가 스탬프한다(여기서는 미포함 — 순수 유지).
 *   ingredient: 외부(MFDS) 성분 대조결과가 있으면 전달(없으면 null → 성분축 미기록).
 */
export function buildVerifyCacheWrite(
  input: DrugVerifyInput | null | undefined,
  ingredient?: IngredientVerifyStatus | null,
): DrugVerifyCacheWrite {
  const verdict = computeDrugVerifyVerdict(input);
  return {
    verify_status: verdict?.status ?? 'pending',
    verify_ingredient: ingredient ?? null,
    verify_matched_code: pickVerifyMatchedCode(input),
    verify_input_hash: computeVerifyInputHash(input),
    verify_model_version: VERIFY_MODEL_VERSION,
  };
}
