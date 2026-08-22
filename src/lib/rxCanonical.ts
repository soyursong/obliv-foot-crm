// rxCanonical — 처방약/주사제 표기형식 canonical SSOT (순수 함수 · DB/외부API 비의존)
// Ticket: T-20260822-foot-RX-NOTATION-FORMAT-CANONICAL-SPEC (문지은 대표원장, U0ALGAAAJAV)
//
// canonical 표기형식(본 티켓이 SSOT):
//   [구분]약품명(성분명)_(함량/단위)
//   예) [내복]엔테론정150밀리그람(비티스비니페라엑스)
//       [외용]니조랄2%액(케토코나졸)_(20mg/1mL)
//
//   · [구분] = 내복(먹는약) / 외용(바르는약) / 주사(주사제)
//   · 약품명·성분명·함량·단위는 원본 그대로 — 임의 축약 절대 금지.
//   · "니조랄액2%" 같은 순서 변형 = 사고 원인(순서 고정).
//
// B안 스코프(2026-08-22 23:22 대표원장 확정):
//   AC-1(검색결과 canonical 표시) · AC-4(축약·순서변형 입력 validation) · AC-5(조회화면 동일형식)만 IN-SCOPE.
//   급여약 HIRA / 비급여약 MFDS 자동연동(AC-2/3)은 OUT-OF-SCOPE(외부 API 후속 트랙).
//   → 본 모듈은 외부 호출 0 · 신규 DB 스키마 0 · 신규 npm 0 (순수 함수/상수만).

// ─────────────────────────────────────────────────────────────────────────────
// [구분] 카테고리 — 내복 / 외용 / 주사
// ─────────────────────────────────────────────────────────────────────────────
export type RxRoute = 'oral' | 'topical' | 'injection';

/** [구분] 표기 라벨(한국어, 현장 표기 canonical). */
export const RX_ROUTE_LABEL: Record<RxRoute, string> = {
  oral: '내복',
  topical: '외용',
  injection: '주사',
};

/** [구분] 라벨 + 현장 풀이(개발용어 배제). */
export const RX_ROUTE_DESC: Record<RxRoute, string> = {
  oral: '내복(먹는약)',
  topical: '외용(바르는약)',
  injection: '주사(주사제)',
};

/** canonical [구분] 라벨 3종(표시 순서 고정). */
export const RX_ROUTE_LABELS: readonly string[] = ['내복', '외용', '주사'];

/** 라벨(내복/외용/주사) → RxRoute. 동의어(먹는약/경구·바르는약/외용제·주사제)도 흡수. */
export function toRxRoute(raw: string | null | undefined): RxRoute | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;
  if (/(^내복|먹는약|경구|내복약)/.test(s)) return 'oral';
  if (/(^외용|바르는|외용제|국소)/.test(s)) return 'topical';
  if (/(^주사|주사제|주사약|inj)/i.test(s)) return 'injection';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// canonical 조립(build) — [구분]약품명(성분명)_(함량/단위)
// ─────────────────────────────────────────────────────────────────────────────
export interface RxCanonicalParts {
  /** [구분] — RxRoute | 라벨 문자열(내복/외용/주사). 없으면 [구분] 접두 생략. */
  route?: RxRoute | string | null;
  /** 약품명(원본 그대로, 축약 금지). 필수. */
  name: string;
  /** 성분명(괄호 안). 없으면 (성분명) 생략. */
  ingredient?: string | null;
  /** 함량/단위 — _(...) 꼬리. 예 '20mg/1mL'. 없으면 생략. */
  amountUnit?: string | null;
}

/**
 * canonical 표기형식 조립. 원본 값은 손대지 않고(축약·재정렬 없음) 정해진 순서로만 결합한다.
 *   [구분]약품명(성분명)_(함량/단위)
 *   · route 없음 → [구분] 접두 생략(부분 데이터 tolerant).
 *   · ingredient 없음 → (성분명) 생략.
 *   · amountUnit 없음 → _(...) 생략.
 */
export function formatRxCanonical(parts: RxCanonicalParts): string {
  const name = (parts.name ?? '').trim();
  if (name === '') return '';
  const routeLabel = normalizeRouteLabel(parts.route);
  const ingredient = (parts.ingredient ?? '').trim();
  const amountUnit = (parts.amountUnit ?? '').trim();

  let out = '';
  if (routeLabel) out += `[${routeLabel}]`;
  out += name;
  if (ingredient) out += `(${ingredient})`;
  if (amountUnit) out += `_(${amountUnit})`;
  return out;
}

/** route 입력(RxRoute|라벨) → canonical 라벨(내복/외용/주사) 또는 null. */
function normalizeRouteLabel(route: RxRoute | string | null | undefined): string | null {
  if (route == null) return null;
  if (route === 'oral' || route === 'topical' || route === 'injection') {
    return RX_ROUTE_LABEL[route];
  }
  const mapped = toRxRoute(route);
  if (mapped) return RX_ROUTE_LABEL[mapped];
  const s = `${route}`.trim();
  return s === '' ? null : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// canonical 파싱(parse) — 문자열 → 파트. 원본 손실 없이 분해(표시/검증 보조).
// ─────────────────────────────────────────────────────────────────────────────
export interface RxCanonicalParsed extends RxCanonicalParts {
  /** 원본 문자열 그대로. */
  raw: string;
  /** [구분] 접두가 있었는가. */
  hasRoute: boolean;
}

const ROUTE_PREFIX_RE = /^\[([^\]]+)\]/;
const AMOUNT_TAIL_RE = /_\(([^)]*)\)\s*$/;
const INGREDIENT_TAIL_RE = /\(([^)]*)\)\s*$/;

/**
 * canonical 문자열 파싱. 부분 데이터 tolerant — [구분]/(성분명)/_(함량) 각 파트는 없으면 생략된다.
 * 파싱은 원본을 변형하지 않는다(재정렬·축약 0). 매칭 실패분은 name 에 그대로 남는다.
 */
export function parseRxCanonical(raw: string | null | undefined): RxCanonicalParsed {
  const src = (raw ?? '').trim();
  let rest = src;
  let routeLabel: string | null = null;

  const rm = rest.match(ROUTE_PREFIX_RE);
  if (rm) {
    routeLabel = rm[1].trim();
    rest = rest.slice(rm[0].length);
  }

  // 꼬리부터 분리: _(함량/단위) 먼저, 그다음 (성분명).
  let amountUnit: string | null = null;
  const am = rest.match(AMOUNT_TAIL_RE);
  if (am) {
    amountUnit = am[1].trim();
    rest = rest.slice(0, am.index).trim();
  }

  let ingredient: string | null = null;
  const im = rest.match(INGREDIENT_TAIL_RE);
  if (im) {
    ingredient = im[1].trim();
    rest = rest.slice(0, im.index).trim();
  }

  return {
    raw: src,
    hasRoute: routeLabel != null,
    route: routeLabel ? toRxRoute(routeLabel) ?? routeLabel : null,
    name: rest.trim(),
    ingredient,
    amountUnit,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 표기 validation — 순서변형 / 축약 감지 (입력 단계 게이트)
// ─────────────────────────────────────────────────────────────────────────────
export type RxNotationViolationCode = 'pct_after_form' | 'empty';

export interface RxNotationViolation {
  code: RxNotationViolationCode;
  /** 현장 친화 한국어 메시지(개발용어 배제). */
  message: string;
}

export interface RxNotationValidationResult {
  ok: boolean;
  violations: RxNotationViolation[];
}

// 액상·국소 제형어(농도 % 가 앞에 와야 하는 제형). 예 '2%액' O / '액2%' X(사고원인).
const LIQUID_FORM_WORDS = ['액', '크림', '연고', '겔', '로션', '시럽', '점안액', '점이액', '스프레이'];

// 농도 표기(퍼센트) 토큰.
const PERCENT_TOKEN_RE = /\d+(?:\.\d+)?\s*%/;

/**
 * AC-4 표기형식 validation — 순서변형(사고원인) 감지.
 *
 * 감지 규칙(보수적·false-positive 0 지향):
 *   · pct_after_form: 액상/국소 제형어(액·크림·연고·겔·로션·시럽…) 뒤에 농도(%) 가 오는 순서변형.
 *     canonical = "니조랄2%액" (농도가 제형어 앞). 위반 = "니조랄액2%".
 *     ※ "엔테론정150밀리그람"(정+150밀리그람=정제 함량)은 % 가 아니므로 무해 — 오탐 없음.
 *   · empty: 빈 문자열.
 *
 * 축약(예 '니조랄'→'니조') 자동감지는 원본 대조 소스가 없어 판정 불가 → 여기선 규칙화하지 않는다
 *   (오탐으로 정상약 입력을 막으면 임상 위해). 마스터 검색·선택 동선이 원본 풀네임을 보장한다.
 */
export function validateRxNotation(name: string | null | undefined): RxNotationValidationResult {
  const s = (name ?? '').trim();
  const violations: RxNotationViolation[] = [];
  if (s === '') {
    violations.push({ code: 'empty', message: '약 이름을 입력해주세요.' });
    return { ok: false, violations };
  }

  // 제형어 뒤에 농도(%)가 오는지 검사 — 각 제형어의 마지막 등장 위치 이후에 % 토큰이 있으면 순서변형.
  for (const form of LIQUID_FORM_WORDS) {
    const formIdx = s.lastIndexOf(form);
    if (formIdx < 0) continue;
    const after = s.slice(formIdx + form.length);
    if (PERCENT_TOKEN_RE.test(after)) {
      violations.push({
        code: 'pct_after_form',
        message: `순서가 뒤바뀌었어요. 농도(%)는 "${form}" 앞에 와야 해요 (예: "2%${form}" ○ / "${form}2%" ✕). 원본 표기 그대로 입력해주세요.`,
      });
      break; // 하나만 안내(중복 메시지 방지)
    }
  }

  return { ok: violations.length === 0, violations };
}

/** 검증 실패 시 첫 위반 메시지(토스트용). ok 면 빈 문자열. */
export function firstRxNotationError(name: string | null | undefined): string {
  const r = validateRxNotation(name);
  return r.ok ? '' : r.violations[0]?.message ?? '표기형식을 확인해주세요.';
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / AC-5 표시 SSOT — 검색결과·조회화면 약품명 표시를 한 곳으로 수렴.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 약품명 표시 정규화(display SSOT). 원본을 절대 축약·재정렬하지 않는다 —
 *   앞뒤 공백만 정리해 원본 풀네임을 그대로 반환(말줄임·순서변형 0).
 *   급여약(HIRA 원본 풀네임)·비급여약(MFDS 조합) 모두 원본 표기 유지가 canonical.
 *
 * ※ 검색결과(AC-1)·처방전 조회(AC-5)가 이 함수 한 곳을 통과하므로, 향후 표기형식 조정 시
 *   재바인딩 지점이 단일화된다(화면별 임의 변형 재발 방지).
 */
export function displayRxName(name: string | null | undefined): string {
  return (name ?? '').trim();
}
