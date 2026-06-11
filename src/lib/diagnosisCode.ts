// diagnosisCode — 상병코드(KCD-8) 입력 검증 + 같은 폴더 상병명 중복 판정.
// Ticket: T-20260610-foot-DIAG-CODE-VALIDATION (DiagnosisNamesTab 입력 guard 전용)
//   AC-1 service_code 형식 검증(trim + 소문자→대문자 정규화 후). 빈 코드는 통과(nullable 유지).
//   AC-2 같은 폴더(미분류 포함) 내 상병명 중복 저장 차단(trim 비교, 자기 자신 제외).
//   ※ 순수 함수로 분리 — 데이터/로그인 비의존 단위 테스트 가능(컴포넌트 결합 최소화).

// KCD-8(한국표준질병사인분류) 코드 형식: 영문 대문자 1 + 숫자 2~4 + (소수점 + 숫자 1~4) 선택.
//   예) M79 · M79.3 · S93.401 · M722(dotless 4자리 현장 표기관례=M72.2) · L6005(dotless subdivided).
//   ★ regex 완화(A2, planner_decision T-20260610-foot-DIAG-CODE-VALIDATION):
//     dotless 3~4자리(L600=L60.0, K297 등 현장 실데이터 8건)를 수용하고 미래 subdivided 코드까지 커버.
//     한글·중간공백·구조오류(MM72.2)는 여전히 차단.
export const KCD8_RE = /^[A-Z][0-9]{2,4}(\.[0-9]{1,4})?$/;

/** trim + 소문자→대문자 정규화 — 저장/검증 직전 공통 적용. */
export function normalizeServiceCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/**
 * 상병코드 검증 — 통과 시 null, 위반 시 인라인 에러 문구.
 *   빈 코드(정규화 후 '')는 통과(상병코드 nullable 유지).
 */
export function validateServiceCode(raw: string | null | undefined): string | null {
  const v = normalizeServiceCode(raw);
  if (!v) return null; // 빈 코드 통과
  if (!KCD8_RE.test(v)) return 'KCD 코드 형식이 올바르지 않아요 (예: M72.2 또는 M722)';
  return null;
}

export interface DiagnosisNameItem {
  id: string;
  name: string;
  diagnosis_folder_id: string | null;
}

/** 코드 비교 정규화 — trim·대문자·점 제거(dotless/dotted 동치: M72.2 == M722). */
function codeCompareKey(raw: string | null | undefined): string {
  return normalizeServiceCode(raw).replace(/\./g, '');
}

export interface DiagnosisCodeItem {
  id: string;
  service_code: string | null;
}

/**
 * 같은 코드 중복 여부 (AC-2, T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN).
 *   ★ 스코프 = clinic 전체(폴더 무관). KCD 코드는 진료/청구 정본이므로 한 clinic에 1회만 존재해야 함
 *     — reporter "같은 코드로 이름 두 개" 제보를 폴더 경계와 무관하게 차단.
 *   dotless/dotted 동치(M72.2 == M722) 비교, 자기 자신(excludeId) 제외, 빈 코드는 중복 아님.
 */
export function isDuplicateServiceCode(
  items: DiagnosisCodeItem[],
  code: string | null | undefined,
  excludeId?: string,
): boolean {
  const key = codeCompareKey(code);
  if (!key) return false; // 빈 코드는 중복 판정 제외(nullable 유지)
  return items.some((d) => d.id !== excludeId && codeCompareKey(d.service_code) === key);
}

/**
 * 같은 폴더(folderId, null=미분류) 내 상병명 중복 여부 — trim 비교, 자기 자신(excludeId) 제외.
 *   다른 폴더의 동명 상병은 허용(폴더 단위 유일성).
 */
export function isDuplicateDiagnosisName(
  items: DiagnosisNameItem[],
  name: string,
  folderId: string | null,
  excludeId?: string,
): boolean {
  const target = name.trim();
  if (!target) return false;
  const folder = folderId ?? null;
  return items.some(
    (d) =>
      d.id !== excludeId &&
      (d.diagnosis_folder_id ?? null) === folder &&
      d.name.trim() === target,
  );
}
