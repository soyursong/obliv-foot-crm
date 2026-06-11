/**
 * E2E spec — T-20260610-foot-DIAG-CODE-VALIDATION
 *
 * 풋 상병명 관리(DiagnosisNamesTab) 입력 검증 강화.
 *   AC-1 service_code KCD-8 형식 검증 ^[A-Z][0-9]{2,4}(\.[0-9]{1,4})?$  (A2: dotless 3~4자리 수용, planner_decision)
 *        — trim + 소문자→대문자 자동변환 후 검증, 위반 시 인라인에러+저장차단. 빈 코드는 통과.
 *   AC-2 같은 폴더 내 상병명 중복 저장 차단(trim 비교) → "이미 등록된 상병명이에요".
 *   AC-3 기존 malformed service_code = audit-only(별도 보고). backfill/자동수정 금지.
 *
 * 검증 로직은 순수 함수(@/lib/diagnosisCode)로 분리 — 데이터/로그인 비의존 동작 테스트.
 * 4개 핵심 시나리오: 정상 / 소문자자동변환 / 형식차단 / 중복차단.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KCD8_RE,
  normalizeServiceCode,
  validateServiceCode,
  isDuplicateDiagnosisName,
  type DiagnosisNameItem,
} from '../../src/lib/diagnosisCode';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';

// ── 시나리오 1: 정상 코드 — 형식 통과, 저장 허용 ──
test('시나리오1 정상: 유효 KCD-8 코드는 통과(에러 null)', () => {
  for (const ok of ['M79', 'M79.3', 'S93.401', 'A00', 'Z99.9', 'M72.2', 'S92.30']) {
    expect(validateServiceCode(ok)).toBeNull();
    expect(KCD8_RE.test(ok)).toBe(true);
  }
  // dotless 표기관례(현장 실데이터 8건) — 편집 회귀 방지 가드: M722=M72.2, L600=L60.0 등
  for (const dotless of ['M722', 'L600', 'L840', 'L720', 'K297', 'B354', 'B351', 'B353', 'L6005']) {
    expect(validateServiceCode(dotless)).toBeNull();
    expect(KCD8_RE.test(dotless)).toBe(true);
  }
  // 빈 코드도 통과(nullable 유지)
  expect(validateServiceCode('')).toBeNull();
  expect(validateServiceCode('   ')).toBeNull();
  expect(validateServiceCode(null)).toBeNull();
});

// ── 시나리오 2: 소문자 자동변환 — 입력 정규화 후 통과 ──
test('시나리오2 소문자자동변환: trim+대문자 정규화 후 검증/저장', () => {
  expect(normalizeServiceCode('  m79.3  ')).toBe('M79.3');
  expect(normalizeServiceCode('s93.401')).toBe('S93.401');
  // 소문자/공백 입력도 정규화되어 통과
  expect(validateServiceCode('m79.3')).toBeNull();
  expect(validateServiceCode('  z99.9 ')).toBeNull();
});

// ── 시나리오 3: 형식 차단 — 위반 코드는 인라인 에러 ──
test('시나리오3 형식차단: 비정형 코드는 에러 문구 반환', () => {
  // 한글·중간공백·구조오류(MM=대문자2자)·5자리·소수점5자리는 여전히 차단
  for (const bad of ['ABC', '123', 'M7', '족저123', 'MM72.2', 'M79.', 'M79.12345', '79.3', 'M-79', 'M79 3', 'M12345']) {
    const err = validateServiceCode(bad);
    expect(err).not.toBeNull();
    expect(err).toContain('KCD 코드 형식이 올바르지 않아요');
  }
  // 에러 문구에 dotless 예시(M722) 병기 확인
  expect(validateServiceCode('족저123')).toContain('M722');
});

// ── 시나리오 4: 중복 차단 — 같은 폴더 동명 상병 저장 불가 ──
test('시나리오4 중복차단: 같은 폴더 동명 상병 차단(trim, 자기제외)', () => {
  const items: DiagnosisNameItem[] = [
    { id: 'a', name: '족저근막염', diagnosis_folder_id: 'f1' },
    { id: 'b', name: '무지외반증', diagnosis_folder_id: 'f1' },
    { id: 'c', name: '족저근막염', diagnosis_folder_id: null }, // 미분류
  ];
  // 같은 폴더(f1) 동명 → 차단
  expect(isDuplicateDiagnosisName(items, '족저근막염', 'f1')).toBe(true);
  // trim 비교 — 앞뒤 공백 무시
  expect(isDuplicateDiagnosisName(items, '  족저근막염 ', 'f1')).toBe(true);
  // 다른 폴더(f2)면 허용
  expect(isDuplicateDiagnosisName(items, '족저근막염', 'f2')).toBe(false);
  // 미분류(NULL) 폴더 동명 → 차단
  expect(isDuplicateDiagnosisName(items, '족저근막염', null)).toBe(true);
  // 자기 자신(excludeId) 제외 → 수정 시 본인 이름 그대로 허용
  expect(isDuplicateDiagnosisName(items, '족저근막염', 'f1', 'a')).toBe(false);
  // 신규 이름은 허용
  expect(isDuplicateDiagnosisName(items, '아킬레스건염', 'f1')).toBe(false);
});

// ── 결선 가드: 컴포넌트가 검증 lib 를 실제로 사용 + 저장 정규화 ──
//   ※ T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN 이 입력방식을 supersede:
//     자유텍스트 입력(dx-name-input/dx-code-input + validateServiceCode 인라인) 제거 →
//     KCD 검색클릭(KcdComboBox). 저장 정규화(normalizeServiceCode)·중복차단(isDuplicateDiagnosisName)·
//     인라인 에러 testid 는 계승. 본 결선 가드는 supersede 후 잔존 결선만 검증한다.
test('결선: DiagnosisNamesTab 가 diagnosisCode 검증을 저장/입력 경로에 결선(KCD supersede 반영)', () => {
  const src = read(TAB);
  expect(src).toContain("from '@/lib/diagnosisCode'");
  expect(src).toContain('isDuplicateDiagnosisName');
  // 저장 payload 는 정규화된 코드(대문자) — normalizeServiceCode 계승(useUpsertDx + KCD 선택값 정규화)
  expect(src).toContain('normalizeServiceCode');
  // 인라인 에러 노출 + 저장 차단 결선(계승)
  expect(src).toContain('data-testid="dx-code-error"');
  expect(src).toContain('data-testid="dx-name-error"');
  expect(src).toContain('이미 등록된 상병명이에요');
  // 입력방식 supersede — 자유텍스트 입력칸 제거(KCD 검색클릭으로 교체)
  expect(src).not.toContain('data-testid="dx-name-input"');
  expect(src).toContain('KcdComboBox');
});

// ── AC-3 가드: 컴포넌트에 backfill/자동수정 경로 없음(audit-only) ──
test('AC-3: 기존 malformed 코드 자동수정/backfill 경로 부재(audit-only)', () => {
  const src = read(TAB);
  // 저장 외 일괄 코드 UPDATE/정규화 루프가 없어야 함
  expect(src).not.toContain('backfill');
  expect(src).not.toContain('migrateServiceCode');
});

// ── 브라우저 렌더 가드(경로 SSOT): "상병명 관리" 탭은 /admin 루트(대시보드)가 아니라
//    /admin/clinic-management(진료관리, role admin/manager/director) 내부 탭이다.
//    QA 진단이 잘못된 경로(/admin)를 보고 실패하는 false-negative 재발 방지용 — 정확한 경로를 코드로 못박는다.
test('브라우저: 상병명 관리 탭은 /admin/clinic-management 에서 렌더(/admin 루트 아님)', async ({ page }) => {
  await page.goto('/admin/clinic-management?tab=diagnosis_names');
  const tab = page.getByTestId('tab-diagnosis-names');
  await expect(tab).toBeVisible({ timeout: 15000 });
  await expect(tab).toContainText('상병명 관리');
  // DiagnosisNamesTab 본문(폴더/상병 2패널)까지 마운트 확인
  await expect(page.getByText('상병명 추가')).toBeVisible();
});
