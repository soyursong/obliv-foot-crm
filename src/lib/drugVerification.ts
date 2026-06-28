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
