/**
 * E2E spec — T-20260608-foot-DX-BUNDLE-SET (묶음상병)
 *
 * 현장(문지은 대표원장 C0ATE5P6JTH, MSG-20260608-115731-x1xy):
 *   "묶음상병 기능을 만들어줘 — 여러 상병코드를 한 세트로 묶어 진료차트에서 일괄 적용.
 *    묶음처방(prescription_sets)이랑 동일한 개념이야."
 *
 * 설계:
 *   - AC-0: 묶음처방(prescription_sets) 패턴 미러. 단, 적용 대상이 RELATIONAL(진료차트 상병 행)이라
 *     items 는 정규화 자식 테이블(diagnosis_set_items, service_id FK → services 상병정본).
 *     신규 빈 테이블 2개(additive·롤백·supervisor 게이트). 상병 정본 = services.category_label='상병' 단일 SSOT.
 *   - AC-1: 진료관리 '묶음상병' 탭 — 세트 CRUD + 세트 내 상병(상병 마스터에서 선택) 추가/제거/주·부.
 *   - AC-2: 진료차트 상병 입력(DiagnosisFolderPicker)에서 묶음상병 세트 선택 → 상병 일괄 적용(누적).
 *           기존 단건 상병 입력경로 무변경(additive).
 *
 * 본 spec 은 묶음상병 불변식을 정본 소스/마이그에 정적 단언으로 인코딩(데이터·로그인 비의존)해 회귀를 가드.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MIG = 'supabase/migrations/20260608120000_diagnosis_sets.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260608120000_diagnosis_sets.rollback.sql';
const TAB = 'src/components/admin/DiagnosisSetsTab.tsx';
const CLINIC = 'src/pages/ClinicManagement.tsx';
const PICKER = 'src/components/medical/DiagnosisFolderPicker.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-0: 마이그레이션 — 신규 엔티티 2개(additive), service_id FK → services 상병정본, 롤백 존재
// ─────────────────────────────────────────────────────────────────────────────
test('AC-0: diagnosis_sets + diagnosis_set_items 신규 테이블 + FK + 롤백', () => {
  expect(existsSync(join(ROOT, MIG))).toBe(true);
  expect(existsSync(join(ROOT, MIG_ROLLBACK))).toBe(true);
  const sql = read(MIG);
  // 신규 빈 테이블(additive) — IF NOT EXISTS, ALTER/DROP 기존테이블 없음
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.diagnosis_sets');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.diagnosis_set_items');
  expect(sql).not.toMatch(/ALTER TABLE public\.(services|chart_diagnoses|prescription_sets)/);
  // 세트 item 은 상병 정본(services.id)을 FK 참조만 함(두번째 마스터 신설 아님)
  expect(sql).toContain('service_id       uuid NOT NULL REFERENCES public.services(id)');
  expect(sql).toContain('diagnosis_set_id uuid NOT NULL REFERENCES public.diagnosis_sets(id) ON DELETE CASCADE');
  // 주/부 구분 CHECK + 같은 세트 내 동일 상병 중복 차단(UNIQUE)
  expect(sql).toMatch(/diagnosis_type[\s\S]*CHECK \(diagnosis_type IN \('primary', 'secondary'\)\)/);
  expect(sql).toContain('uq_diagnosis_set_items_set_service');
  // clinic 격리
  expect(sql).toContain('clinic_id        uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE');
  // 롤백 = 자식→부모 역순 DROP
  const rb = read(MIG_ROLLBACK);
  expect(rb).toContain('DROP TABLE IF EXISTS public.diagnosis_set_items');
  expect(rb).toContain('DROP TABLE IF EXISTS public.diagnosis_sets');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 묶음상병 관리 탭 — CRUD + 상병 마스터 선택 + 주/부 지정
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: DiagnosisSetsTab — 세트 CRUD UI 진입점', () => {
  expect(existsSync(join(ROOT, TAB))).toBe(true);
  const src = read(TAB);
  // CRUD 진입점
  expect(src).toContain('data-testid="dx-set-add-btn"');
  expect(src).toContain('data-testid="dx-set-name-input"');
  expect(src).toContain('data-testid="dx-set-save-btn"');
  expect(src).toContain('data-testid="dx-set-list"');
  expect(src).toContain('data-testid="dx-set-item"');
});

test('AC-1: 세트 item = 상병 마스터(services 상병정본)에서 선택, 주/부 지정', () => {
  const src = read(TAB);
  // 상병 마스터 소스 = services category_label='상병' (단일 SSOT, 두번째 마스터 신설 아님)
  expect(src).toContain("category_label', '상병'");
  // 마스터에서 선택 추가 — T-...-NEST-BUNDLE-FOLDER AC-4 로 select → 폴더트리 picker 교체.
  expect(src).toContain('data-testid="dx-set-open-picker"');
  expect(src).toContain('data-testid="dx-set-item-row"');
  expect(src).toContain('data-testid="dx-set-item-remove"');
  // 주/부 지정 — AC-6 로 수동토글 제거, 순서기반 자동 배지로 교체(읽기전용).
  expect(src).toContain('data-testid="dx-set-item-type-badge"');
  // 정규화 자식테이블 replace 저장(전체 삭제 후 재삽입)
  expect(src).toContain("from('diagnosis_set_items')");
  expect(src).toContain("from('diagnosis_sets')");
});

test('AC-1: 관리 권한 = director/manager/admin (상병명·처방세트와 동일)', () => {
  const src = read(TAB);
  expect(src).toContain("['director', 'manager', 'admin']");
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 진료관리 페이지 탭 배선
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: ClinicManagement 에 묶음상병 탭 등록', () => {
  const src = read(CLINIC);
  expect(src).toContain("import DiagnosisSetsTab from '@/components/admin/DiagnosisSetsTab'");
  expect(src).toContain('data-testid="tab-diagnosis-sets"');
  expect(src).toContain('value="diagnosis_sets"');
  expect(src).toContain('<DiagnosisSetsTab />');
  // ?tab= 라우트 허용 목록
  expect(src).toContain("'diagnosis_sets',");
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 진료차트 일괄 적용 — 세트 선택 시 상병 누적(기존 단건 입력경로 무변경)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: DiagnosisFolderPicker 묶음상병 섹션 + 일괄 적용 동선', () => {
  const src = read(PICKER);
  // 세트 목록 조회(deploy-tolerant)
  expect(src).toContain("from('diagnosis_sets')");
  // 묶음상병 섹션 + 세트 클릭 적용
  expect(src).toContain('data-testid="dx-picker-sets"');
  expect(src).toContain('data-testid="dx-picker-set-item"');
  expect(src).toContain('function applySet(');
  // 적용 = 기존 단건 누적기(addDxEntry) 재사용 → 기존 입력경로 무변경(additive)
  expect(src).toContain('addDxEntry(next, fmtDx(row))');
  // 주상병 먼저 정렬(차트 index 0 = 주상병 정합)
  expect(src).toMatch(/diagnosis_type === 'primary' \? 0 : 1/);
});

test('AC-2: 기존 단건 상병 입력경로(select/누적 헬퍼) 회귀 보존', () => {
  const src = read(PICKER);
  // 단건 select 동선 + 직렬화 정본은 그대로(무변경 가드)
  expect(src).toContain('function select(row: DxRow)');
  expect(src).toContain('onChange(serializeDxEntries(addDxEntry(entries, fmtDx(row))))');
  expect(src).toContain('export function addDxEntry');
});
