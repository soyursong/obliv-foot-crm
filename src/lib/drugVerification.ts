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
