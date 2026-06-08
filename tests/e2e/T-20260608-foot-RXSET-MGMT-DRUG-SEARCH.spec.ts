/**
 * E2E spec — T-20260608-foot-RXSET-MGMT-DRUG-SEARCH
 *
 * 현장(문지은 대표원장) 신고: "처방세트관리에서 약이 검색 자체가 안 되는 듯. 드롭다운으로 검색 열리면 좋겠다."
 * ★ RXSET-CONTRA-DRUG-LOAD '처방세트에 약 0건'의 상류 근본 원인 —
 *   세트관리 약품명 필드가 자유텍스트 Input 뿐이라 약품 마스터(prescription_codes)를 검색·연결할 수단이 없었음.
 *   → prescription_code_id 가 항상 null 로 저장되어 하류(금기증 로드 등)가 빈손이 됨.
 *
 * STEP1 그라운딩 결론(무DB): FE 검색UI 미연결. 쿼리 단절/RLS 아님(prescription_codes 는
 *   MedicalChartPanel 에서 동일 쿼리로 정상 동작 중). DB 변경 불필요.
 *
 * 핵심 AC:
 *   AC1: 처방세트관리 약품명 필드가 드롭다운 검색(약품명·보험코드 ilike) — searchRxMaster.
 *   AC2: 검색 결과 선택 → 세트 항목에 name·route·classification·prescription_code_id 자동채움.
 *   AC3: 저장 세트가 prescription_code_id 보유 상태로 영속(items JSONB) → CONTRA-DRUG-LOAD 실데이터 경로 충족.
 *   AC4: 빈 결과 명확한 빈 상태.
 *
 * 본 spec 은 검색 드롭다운의 불변식(출처=전체 마스터·디바운스·선택 자동채움·수기변경 시 연결해제·빈상태)을
 *   정본 소스에 정적 단언으로 인코딩해 회귀를 가드한다(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RX = 'src/components/admin/PrescriptionSetsTab.tsx';
const CONTRA = 'src/components/admin/ContraindicationsTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC1: 드롭다운 검색 — 전체 약품 마스터(prescription_codes) 직접 검색
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-1: searchRxMaster 가 prescription_codes 전체 카탈로그를 ilike 검색', () => {
  const src = read(RX);
  expect(src).toContain('async function searchRxMaster');
  expect(src).toContain(".from('prescription_codes')");
  expect(src).toContain('name_ko.ilike.%${esc}%,claim_code.ilike.%${esc}%');
  // custom(자체·카피약) 우선 노출
  expect(src).toContain("order('code_source', { ascending: false })");
});

test('AC1-2: 출처제한 검색(prescribableDrugs) import·호출 안 함 — 0건 순환 회피', () => {
  const src = read(RX);
  // 세트관리에서 출처를 '처방세트 등록 약'으로 제한하면 빈 세트 상태에서 0건 순환 → 사용 금지.
  //   (주석 언급은 허용. import/호출만 금지)
  expect(src).not.toMatch(/from\s+['"]@\/lib\/prescribableDrugs['"]/);
  expect(src).not.toMatch(/searchPrescribableDrugs\s*\(/);
  expect(src).not.toMatch(/getPrescribableCodeIds\s*\(/);
});

test('AC1-3: 약품명 필드가 검색 인풋 + 드롭다운(Search 아이콘·디바운스)', () => {
  const src = read(RX);
  expect(src).toContain('rx-set-item-name-input');
  expect(src).toContain('rx-set-drug-search-dropdown');
  expect(src).toContain('약품명·보험코드 검색');
  // 디바운스(과도 호출 방지)
  expect(src).toContain('setTimeout');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2: 검색 결과 선택 → 자동채움
// ─────────────────────────────────────────────────────────────────────────────
test('AC2-1: 결과 선택 시 name·route·classification·prescription_code_id 자동채움', () => {
  const src = read(RX);
  expect(src).toContain('function handleSelectDrug');
  expect(src).toContain('prescription_code_id: code.id');
  expect(src).toContain('classification: code.classification ?? null');
  // route 는 classification 파생(classificationToRoute), 파생 비면 기존값 유지
  expect(src).toContain('classificationToRoute(code.classification)');
  expect(src).toContain('rx-set-drug-search-option');
});

test('AC2-2: 약품명 수기변경 시 마스터 연결 해제(잘못된 code_id 잔존 방지)', () => {
  const src = read(RX);
  // handleItemChange 에서 name 변경 시 code_id/classification null 화
  expect(src).toContain("if (field === 'name')");
  expect(src).toContain('next.prescription_code_id = null');
  expect(src).toContain('next.classification = null');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3: 저장 영속 경로 — items JSONB 에 prescription_code_id 보존
// ─────────────────────────────────────────────────────────────────────────────
test('AC3-1: upsert payload 가 items(JSONB) 전체를 저장 → code_id 영속', () => {
  const src = read(RX);
  // 항목 배열을 통째로 저장하므로 prescription_code_id 가 함께 영속됨
  expect(src).toContain('items: form.items as unknown as Record<string, unknown>[]');
  expect(src).toContain("from('prescription_sets')");
  // PrescriptionItem 타입에 prescription_code_id 필드 존재(CONTRA-DRUG-LOAD 매칭 키)
  expect(src).toContain('prescription_code_id?: string | null');
});

test('AC3-2: 연결 상태 시각 표식(연결됨 배지) — 마스터 연결 확인 가능', () => {
  const src = read(RX);
  expect(src).toContain('연결됨');
  expect(src).toContain('item.prescription_code_id != null');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4: 빈 결과 빈 상태
// ─────────────────────────────────────────────────────────────────────────────
test('AC4-1: 검색 결과 0건 명확한 빈 상태 + 수기 등록 안내', () => {
  const src = read(RX);
  expect(src).toContain('rx-set-drug-search-empty');
  expect(src).toContain('검색 결과가 없습니다.');
  // 자유텍스트 수기입력 fallback(레거시 무중단)
  expect(src).toContain('입력한 이름 그대로 수기 등록됩니다.');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5 (현장 추가요청 MSG-...-ww5k): 금기증관리 약품검색 — 처방세트관리와 동일 드롭다운 검색 패턴/UX 재사용
//   ★ 핵심 결정: '동일 패턴/UX 재사용'은 드롭다운 검색 UX(타이핑→디바운스→결과 드롭다운→선택) 재사용을 의미.
//     검색 '출처'는 그대로 '처방세트 등록 약'(searchPrescribableDrugs) 제한 유지 —
//     세트 미등록 약(orphan) 차단은 T-20260607-foot-CONTRAINDICATION-MGMT AC-1(문지은 대표원장) 확정 요구.
//     전체 마스터로 바꾸면 그 요구·deployed 테스트를 뒤집으므로 변경하지 않는다.
//     ('자연 연결' = 세트관리 약 검색이 살아나면 이 제한 검색에도 실데이터가 흐름)
// ─────────────────────────────────────────────────────────────────────────────
test('AC5-1: 금기증관리도 드롭다운 검색 패턴 재사용 — 디바운스(250ms setTimeout) 적용', () => {
  const src = read(CONTRA);
  expect(src).toContain('setTimeout');
  expect(src).toContain('250');
  expect(src).toContain('searchDebounceRef');
  // 검색 입력/결과 드롭다운 testid 유지(처방세트관리와 동일 검색 UX 흐름)
  expect(src).toContain('contra-drug-search-input');
  expect(src).toContain('contra-drug-result-item');
});

test('AC5-2: 검색 출처 제한(처방세트 등록 약) 보존 — orphan 차단(T-20260607 AC-1) 미변경', () => {
  const src = read(CONTRA);
  // 금기증관리는 전체 마스터가 아닌 '처방세트 등록 약'만 노출(현장 확정 요구) → 소스 함수·import 유지.
  expect(src).toContain('searchPrescribableDrugs');
  expect(src).toMatch(/from\s+['"]@\/lib\/prescribableDrugs['"]/);
});

test('AC5-3: 결과 드롭다운 + 빈 상태 두 갈래 유지 — 무한 빈 드롭다운 방지', () => {
  const src = read(CONTRA);
  expect(src).toContain('contra-drug-results');
  expect(src).toContain('contra-drug-no-source'); // 처방세트에 약 0건
  expect(src).toContain('contra-drug-no-match');  // 검색어 매칭 없음
});

// ─────────────────────────────────────────────────────────────────────────────
// 무DB 가드 — 본 변경은 FE only, 스키마 변경 없음
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD: 스키마 변경(ALTER TABLE) 없음 — 순수 FE 검색UI 연결', () => {
  const src = read(RX);
  expect(src).not.toMatch(/alter\s+table/i);
  expect(read(CONTRA)).not.toMatch(/alter\s+table/i);
});
