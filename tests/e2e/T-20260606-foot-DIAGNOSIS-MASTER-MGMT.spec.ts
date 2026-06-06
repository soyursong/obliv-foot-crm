/**
 * E2E spec — T-20260606-foot-DIAGNOSIS-MASTER-MGMT
 *
 * 문지은 대표원장(6/6, C0ATE5P6JTH): 진단명(상병) 시스템 전면 재설계.
 *   [A] 진료도구 상병명 관리 신규 메뉴(CRUD + 폴더)
 *   [B] 진료차트 진단명 입력 = 자동완성/이력 폐지 → 폴더 탐색 드롭다운(등록 상병만)
 *   [C] 원장별 즐겨찾기
 *
 * AC-0 정본 결정(planner MSG-150034-3hbt): (a) 기존 services 확장 채택 / (b) 신규 상병 마스터
 *   테이블 기각 = "두번째 상병 마스터 신설 금지". 폴더 = services.diagnosis_folder(additive),
 *   즐겨찾기 = doctor_diagnosis_favorites(원장별 RLS auth.uid() 격리), 저장경로 medical_charts.diagnosis 무변경.
 *
 * 본 spec 은 구조 불변식을 정본 그대로 인코딩해 회귀를 가드한다(데이터·로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PICKER = 'src/components/medical/DiagnosisFolderPicker.tsx';
const TAB = 'src/components/admin/DiagnosisNamesTab.tsx';
const CHART = 'src/components/MedicalChartPanel.tsx';
const TOOLS = 'src/pages/DoctorTools.tsx';
const MIG = 'supabase/migrations/20260606160000_diagnosis_folder_and_favorites.sql';
const MIG_RB = 'supabase/migrations/20260606160000_diagnosis_folder_and_favorites.rollback.sql';

// ── AC-0: 상병 정본 = 단일 SSOT (services category_label='상병'), 신규 마스터 테이블 0건 ──
test('AC-0: 상병 후보 소스는 services category_label=상병 단일 SSOT (두번째 마스터 신설 금지)', () => {
  for (const f of [PICKER, TAB]) {
    const src = read(f);
    expect(src).toContain("category_label");
    expect(src).toContain("'상병'");
    // 신규 전용 상병 마스터 테이블(diagnosis_categories / clinic_diagnoses) 참조 금지
    expect(src).not.toContain('diagnosis_categories');
    expect(src).not.toContain('clinic_diagnoses');
  }
});

// ── AC-1 [A]: 상병명 관리 탭 등록 + 처방세트 패턴(폴더 그룹핑) 재사용 ──
test('AC-1: DoctorTools 에 상병명 관리 탭(diagnosis_names) 등록', () => {
  const t = read(TOOLS);
  expect(t).toContain('DiagnosisNamesTab');
  expect(t).toContain('value="diagnosis_names"');
  expect(t).toContain("'diagnosis_names'"); // accessibleTabs 화이트리스트
  expect(t).toContain('상병명 관리');
});

test('AC-1: 상병명 탭은 폴더 그룹핑 + services insert 시 category_label/category=상병', () => {
  const tab = read(TAB);
  expect(tab).toContain('diagnosis_folder');
  expect(tab).toContain('미분류');
  // 신규 상병 = services 행, 진단코드(단가 0)
  expect(tab).toContain("category: '상병'");
  expect(tab).toContain("category_label: '상병'");
  expect(tab).toContain('price: 0');
});

// ── AC-2 [B]: 진료차트 자동완성/이력 datalist 폐지 + super_phrases 보조소스 제거 ──
test('AC-2: 진료차트 진단명 datalist 자동완성 완전 제거', () => {
  const c = read(CHART);
  expect(c).not.toContain('medchart-diagnosis-options'); // 기존 datalist id 제거
  expect(c).not.toContain('registeredDiagnoses');        // 기존 자동완성 상태 제거
  // picker 로 대체
  expect(c).toContain('DiagnosisFolderPicker');
});

test('AC-2: super_phrases.diagnosis 보조 자동완성 소스 폐지 (picker 는 services 만 조회)', () => {
  const picker = read(PICKER);
  expect(picker).not.toContain('super_phrases');
  expect(picker).toContain("from('services')");
});

test('AC-2/3: 저장경로 medical_charts.diagnosis 무변경 (formDx 가 값 sink)', () => {
  const c = read(CHART);
  // picker onChange 는 setFormDx 로 연결 → 기존 저장경로(diagnosis: formDx) 보존
  expect(c).toContain('onChange={setFormDx}');
  expect(c).toContain('diagnosis: formDx');
});

// ── AC-2/AC-3: 폴더 탐색 + 넓은 드롭다운 + 원장별 즐겨찾기 ──
test('AC-2: picker 는 폴더 탐색 드롭다운, 넓게/오른쪽 아래로 확장', () => {
  const p = read(PICKER);
  expect(p).toContain('dx-picker-panel');
  expect(p).toContain('dx-picker-folder');
  // 넓은 패널 + 좌측정렬(오른쪽 아래 방향 확장) + 아래 방향(top-full)
  expect(p).toMatch(/w-\[min\(560px/);
  expect(p).toContain('left-0');
  expect(p).toContain('top-full');
});

test('AC-3: 원장별 즐겨찾기 = doctor_diagnosis_favorites, staff_id 본인 스코프', () => {
  const p = read(PICKER);
  expect(p).toContain('doctor_diagnosis_favorites');
  expect(p).toContain('staff_id');
  // profile.id(=원장) 로 격리 조회
  expect(p).toContain('profile?.id');
});

// ── 마이그레이션: additive + 롤백 + 원장별 RLS ──
test('MIG: diagnosis_folder additive(nullable) + favorites 테이블 + 롤백 동반', () => {
  const m = read(MIG);
  expect(m).toContain('ADD COLUMN IF NOT EXISTS diagnosis_folder TEXT');
  expect(m).toContain('CREATE TABLE IF NOT EXISTS public.doctor_diagnosis_favorites');
  expect(m).toContain('REFERENCES public.services(id) ON DELETE CASCADE');
  // 기존 저장경로/마스터 파괴 금지 (additive only)
  expect(m).not.toMatch(/DROP\s+COLUMN/i);
  expect(m).not.toMatch(/DROP\s+TABLE/i);
  // 롤백 존재
  const rb = read(MIG_RB);
  expect(rb).toContain('DROP TABLE IF EXISTS public.doctor_diagnosis_favorites');
  expect(rb).toContain('DROP COLUMN IF EXISTS diagnosis_folder');
});

test('MIG: 원장별 즐겨찾기 RLS = auth.uid() 본인 행만 (원장 간 격리)', () => {
  const m = read(MIG);
  expect(m).toContain('ENABLE ROW LEVEL SECURITY');
  expect(m).toContain('staff_id = auth.uid()');
  expect(m).toContain('UNIQUE (staff_id, service_id)');
});
