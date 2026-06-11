/**
 * E2E spec — T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN
 *
 * 풋 상병명 관리(DiagnosisNamesTab) 입력 잠금 — 자유텍스트 제거 → KCD-8 내장 번들 검색+클릭 only.
 *   AC-0 (A) 정적 asset 번들 + 인메모리 검색 (DB 무변경, dynamic import 코드스플릿, 신규 의존성 0).
 *   AC-1 자유타이핑 입력 제거 → KCD 공식목록 검색 → 후보 클릭 선택.
 *   AC-2 코드 중복 차단(신규) — 이름 달라도 같은 코드면 등록 불가(clinic 전체, dotless/dotted 동치).
 *   AC-3 이름 중복 차단(계승) + KCD 미존재 상병 등록 경로 부재(검색클릭 구조상 자연 충족).
 *   AC-4 기존 코드중복 = audit-only(컴포넌트에 backfill/자동수정 경로 없음).
 *
 * ※ 데이터셋은 PROVISIONAL 샘플(AC-0b 비블로킹). prod = HIRA/공식 KCD 전수 drop-in(field-soak 게이트).
 *   순수 함수/번들 검색은 데이터/로그인 비의존 단위 테스트, + 컴포넌트 결선 가드 + 브라우저 렌더.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeServiceCode,
  isDuplicateServiceCode,
  isDuplicateDiagnosisName,
  type DiagnosisNameItem,
  type DiagnosisCodeItem,
} from '../../src/lib/diagnosisCode';
import {
  loadKcdBundle,
  searchKcd,
  getKcdByCode,
  isKnownKcdCode,
} from '../../src/lib/kcd/kcdSearch';
import { KCD_DATASET, KCD_BUNDLE_META } from '../../src/lib/kcd/kcdData';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';

// 번들 1회 로드(dynamic import) — 검색/멤버십 테스트 선행.
test.beforeAll(async () => {
  await loadKcdBundle();
});

// ── 시나리오 1: 정상 — KCD 검색 후보 노출 (코드/명칭 부분일치) ──
test('시나리오1 정상: 코드·명칭 검색 모두 후보 반환 + 클릭 대상 존재', () => {
  // 코드로 검색 (M72.2)
  const byCode = searchKcd('M72.2');
  expect(byCode.length).toBeGreaterThan(0);
  expect(byCode.some((r) => r.code === 'M72.2')).toBe(true);
  // 명칭으로 검색 (족저근막염)
  const byName = searchKcd('족저근막염');
  expect(byName.some((r) => r.code === 'M72.2')).toBe(true);
  // dotless 검색(M722)도 M72.2 매치 (DIAG-CODE-VALIDATION 정규화 자산 승계)
  const dotless = searchKcd('M722');
  expect(dotless.some((r) => r.code === 'M72.2')).toBe(true);
});

// ── 시나리오 2: 자유텍스트(KCD 미존재) 입력 불가 — 검색 0건 → 클릭 대상 없음 ──
test('시나리오2 자유텍스트차단: KCD 미존재 임의문자열은 후보 0건', () => {
  for (const junk of ['존재하지않는상병명12345', 'zzqqxx', '내맘대로진단']) {
    expect(searchKcd(junk).length).toBe(0);
  }
  // 빈 질의도 0건
  expect(searchKcd('').length).toBe(0);
  expect(searchKcd('   ').length).toBe(0);
  // 멤버십: 번들에 없는 코드는 unknown
  expect(isKnownKcdCode('Q99.9')).toBe(false);
  expect(getKcdByCode('Q99.9')).toBeNull();
  // 번들에 있는 코드는 known (dotless 동치)
  expect(isKnownKcdCode('M72.2')).toBe(true);
  expect(isKnownKcdCode('M722')).toBe(true);
  expect(getKcdByCode('M722')?.name).toContain('족저근막염');
});

// ── 시나리오 3: 코드 중복 차단 (신규 핵심) — 이름 달라도 같은 코드면 불가 ──
test('시나리오3 코드중복차단: 동일 코드(dotless/dotted 동치) 재등록 차단', () => {
  const items: DiagnosisCodeItem[] = [
    { id: 'a', service_code: 'M72.2' },
    { id: 'b', service_code: 'M76.6' },
    { id: 'c', service_code: null }, // 빈 코드
  ];
  // 같은 코드(다른 이름이어도) → 차단
  expect(isDuplicateServiceCode(items, 'M72.2')).toBe(true);
  // dotless/dotted 동치 — M722 == M72.2
  expect(isDuplicateServiceCode(items, 'M722')).toBe(true);
  // 소문자/공백 정규화 후 비교
  expect(isDuplicateServiceCode(items, '  m72.2 ')).toBe(true);
  // 새 코드는 허용
  expect(isDuplicateServiceCode(items, 'M54.5')).toBe(false);
  // 자기 자신(excludeId) 제외 — 수정 시 본인 코드 유지 허용
  expect(isDuplicateServiceCode(items, 'M72.2', 'a')).toBe(false);
  // 빈 코드는 중복 판정 제외(nullable)
  expect(isDuplicateServiceCode(items, '')).toBe(false);
  expect(isDuplicateServiceCode(items, null)).toBe(false);
});

// ── 시나리오 4: 이름 중복 차단 (계승) ──
test('시나리오4 이름중복차단: 같은 폴더 동명 상병 차단(계승)', () => {
  const items: DiagnosisNameItem[] = [
    { id: 'a', name: '발바닥근막섬유종증(족저근막염)', diagnosis_folder_id: 'f1' },
    { id: 'b', name: '아킬레스힘줄염', diagnosis_folder_id: 'f1' },
  ];
  expect(isDuplicateDiagnosisName(items, '발바닥근막섬유종증(족저근막염)', 'f1')).toBe(true);
  expect(isDuplicateDiagnosisName(items, '발바닥근막섬유종증(족저근막염)', 'f1', 'a')).toBe(false); // 자기제외
  expect(isDuplicateDiagnosisName(items, '족저근막염2', 'f1')).toBe(false);
});

// ── 번들 무결성: 데이터셋 코드 유일 + 버전 스탬프(AC-5 ①) ──
test('번들무결성: 데이터셋 내 코드 유일 + provisional 버전 스탬프', () => {
  // dotless 기준 코드 유일성(데이터셋 자체 중복 없음)
  const keys = KCD_DATASET.map((e) => normalizeServiceCode(e.code).replace(/\./g, ''));
  expect(new Set(keys).size).toBe(keys.length);
  // 모든 엔트리 code/name 채워짐
  for (const e of KCD_DATASET) {
    expect(e.code.trim().length).toBeGreaterThan(0);
    expect(e.name.trim().length).toBeGreaterThan(0);
  }
  // 버전 스탬프 = provisional (prod drop-in 시 갱신 대상)
  expect(KCD_BUNDLE_META.provisional).toBe(true);
  expect(KCD_BUNDLE_META.version).toContain('provisional');
});

// ── 결선 가드: 컴포넌트가 KCD 검색클릭 입력 + 코드중복 검증을 결선 ──
test('결선: DiagnosisNamesTab 가 KCD 검색클릭 입력(자유타이핑 제거) + 코드중복을 결선', () => {
  const src = read(TAB);
  // KCD 번들 검색 결선
  expect(src).toContain("from '@/lib/kcd/kcdSearch'");
  expect(src).toContain('loadKcdBundle');
  expect(src).toContain('searchKcd');
  expect(src).toContain('KcdComboBox');
  // AC-1: 자유타이핑 폼 입력 제거 — 구 free-text testid 부재
  expect(src).not.toContain('data-testid="dx-name-input"');
  expect(src).not.toContain('data-testid="dx-code-input"');
  // 신규 검색 UI testid 존재
  expect(src).toContain('data-testid="dx-kcd-search"');
  expect(src).toContain('data-testid="dx-kcd-option"');
  // AC-2: 코드중복 검증 결선 + 에러 문구
  expect(src).toContain('isDuplicateServiceCode');
  expect(src).toContain('이미 등록된 코드예요');
  // AC-3: 이름중복 계승
  expect(src).toContain('isDuplicateDiagnosisName');
  expect(src).toContain('이미 등록된 상병명이에요');
  // 저장은 선택(selectedKcd) 없으면 차단
  expect(src).toContain('disabled={upsert.isPending || !selectedKcd}');
});

// ── AC-4 가드: 코드중복 audit-only — 컴포넌트에 자동삭제/병합/backfill 경로 없음 ──
test('AC-4: 기존 코드중복 자동수정/병합/backfill 경로 부재(audit-only)', () => {
  const src = read(TAB);
  expect(src).not.toContain('backfill');
  expect(src).not.toContain('dedupeServiceCode');
  expect(src).not.toContain('mergeDuplicate');
});

// ── AC-0 가드: DB 무변경 — 신규 마이그레이션/테이블 없음, 정적 번들만 ──
test('AC-0: DB 무변경 — KCD 데이터는 정적 asset(dynamic import), 신규 테이블/마이그 없음', () => {
  const search = read('src/lib/kcd/kcdSearch.ts');
  // dynamic import 코드스플릿 — 정적 import 아님
  expect(search).toContain("import('./kcdData')");
  // supabase/DB 호출이 KCD 검색 경로에 없음(순수 인메모리)
  expect(search).not.toContain('supabase');
  expect(search).not.toContain('.from(');
});

// ── 브라우저 렌더 가드: 상병명 관리 탭 = /admin/clinic-management 내부 탭 ──
test('브라우저: 상병명 관리 탭 렌더 + 추가 다이얼로그에 KCD 검색창 노출', async ({ page }) => {
  await page.goto('/admin/clinic-management?tab=diagnosis_names');
  const tab = page.getByTestId('tab-diagnosis-names');
  await expect(tab).toBeVisible({ timeout: 15000 });
  await expect(tab).toContainText('상병명 관리');
  // 상병명 추가 → KCD 검색창(자유타이핑 입력 아님) 노출
  const addBtn = page.getByText('상병명 추가');
  await expect(addBtn).toBeVisible();
  await addBtn.click();
  await expect(page.getByTestId('dx-kcd-search')).toBeVisible({ timeout: 10000 });
  // 구 자유타이핑 입력칸은 부재
  await expect(page.getByTestId('dx-name-input')).toHaveCount(0);
  await expect(page.getByTestId('dx-code-input')).toHaveCount(0);
});
