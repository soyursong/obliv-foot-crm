/**
 * E2E spec — T-20260629-foot-RXSET-BUNDLERX-TAB-UNIFY
 *
 * 현장(문지은 대표원장, C0ATE5P6JTH / thread 1782668133.401579):
 *   "묶음처방을 처방세트 관리 화면 안으로 통합해줘. 묶음처방 탭 = 좌측 전체 약 목록 + 약 선택→묶음처방 추가."
 *
 * 스펙 확정(planner approved):
 *   - 처방세트 화면(=DrugFoldersTab, 서브탭 [폴더 선택]/[전체보기]) 상단 탭바에 '묶음처방' 서브탭 적층.
 *     기존 탭 보존(삭제·치환 금지). 기본 진입 = '폴더 선택'(기존 동작 유지).
 *   - 묶음처방 탭 content = PrescriptionSetsTab(CREATE-FLOW-OVERHAUL 2-pane: 좌측 전체 약 목록+검색 → 묶음처방 추가) 재사용.
 *     신규 묶음처방 로직 작성 금지 — 컴포넌트 재배치(재사용)만.
 *   - top-level 묶음처방 탭(value=prescriptions)도 보존 — 본 작업은 적층(통합)이며 기존 surface 제거 아님.
 *   - DB 무변경(prescription_sets 그대로, 묶음처방=tag_label/icon 유무 구분). 마이그·DDL 0. 신규 npm 0.
 *
 * Surface(코드그라운딩): src/components/admin/DrugFoldersTab.tsx (서브탭 적층 + PrescriptionSetsTab 재사용)
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식을 인코딩(데이터/로그인 비의존) — 형제 RXSET spec 동형.
 * 티켓 §현장 클릭 시나리오 3종 1:1 매핑.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DrugFoldersTab.tsx';
const SETS = 'src/components/admin/PrescriptionSetsTab.tsx';
const PAGE = 'src/pages/ClinicManagement.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 묶음처방 탭 진입 + 약 추가 (정상 동선)
//   3) 상단 탭바에 '묶음처방' 탭 + 기존 '폴더 선택' 탭 함께 노출
//   4) 기본 진입 시 '폴더 선택' 활성(기존 동작 유지)
//   5) '묶음처방' 탭 클릭 → 활성 전환
//   6) 좌측 전체 약 목록(검색창+약 행) 노출
//   7~9) 약 선택 → 묶음처방으로 추가 → 반영
// ─────────────────────────────────────────────────────────────────────────────
test('S1-1: 처방세트 화면 서브탭에 묶음처방 적층 — 기존 [폴더 선택]/[전체보기] 보존(삭제·치환 금지)', () => {
  const src = read(TAB);
  // 기존 서브탭 보존
  expect(src).toContain('drug-folder-subtabs');
  expect(src).toContain('drug-folder-subtab-folder');
  expect(src).toContain('drug-folder-subtab-all');
  expect(src).toContain('폴더 선택');
  expect(src).toContain('전체보기');
  // 신규 묶음처방 서브탭 적층
  expect(src).toContain('drug-folder-subtab-bundle');
  expect(src).toContain('묶음처방');
});

test('S1-2: 기본 진입 = 폴더 선택 활성(기존 동작 유지) — subTab 기본값 folder', () => {
  const src = read(TAB);
  // 'bundle' 추가했어도 초기값은 'folder' 그대로(회귀 0)
  expect(src).toContain("useState<'folder' | 'all' | 'bundle'>('folder')");
});

test('S1-3: 묶음처방 탭 클릭 → 활성 전환(setSubTab(bundle))', () => {
  const src = read(TAB);
  expect(src).toContain("onClick={() => setSubTab('bundle')}");
  // 활성 스타일 게이트
  expect(src).toContain("subTab === 'bundle'");
});

test('S1-4: 묶음처방 탭 content = PrescriptionSetsTab 재사용(좌측 전체 약 목록+추가) — bundle 서브탭에서만 마운트', () => {
  const tab = read(TAB);
  // 재사용 import + 렌더
  expect(tab).toContain("import PrescriptionSetsTab from '@/components/admin/PrescriptionSetsTab'");
  expect(tab).toContain("{subTab === 'bundle' && (");
  expect(tab).toContain('<PrescriptionSetsTab />');
  expect(tab).toContain('drug-folder-bundle');
});

test('S1-5: 좌측 전체 약 목록(검색)+약 선택→묶음처방 추가 동선은 PrescriptionSetsTab에 이미 존재(신규 로직 0)', () => {
  const sets = read(SETS);
  // CREATE-FLOW-OVERHAUL 2-pane: 좌측 약 테이블(검색·체크) → 묶음처방 생성/추가
  expect(sets).toContain('drugSearch');           // 좌측 검색 상태
  expect(sets).toContain('checkedDrugs');          // 약 선택(체크)
  expect(sets).toContain('묶음처방 생성');         // 추가 동선
  // 약 소스 = prescribableDrugs.ts 단일 캡슐 경유
  expect(sets).toMatch(/prescribableDrugs|services/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 탭 전환 시 기존 동작 보존 (회귀 가드)
//   폴더 선택 ↔ 묶음처방 전환 시 폴더 트리/동작 무회귀
// ─────────────────────────────────────────────────────────────────────────────
test('S2-1: 폴더 선택 content는 folder 서브탭에서만 렌더(전환 시 깨짐 없음 — 화면 분리 유지)', () => {
  const src = read(TAB);
  expect(src).toContain("{subTab === 'folder' && (");
  // 기존 폴더 트리/약품 목록 testid 보존(회귀 0)
  expect(src).toContain('drug-folder-admin-tree');
  expect(src).toContain('drug-folder-assigned-table');
});

test('S2-2: 전체보기 content도 보존 — bundle 적층이 기존 all 서브탭을 치환하지 않음', () => {
  const src = read(TAB);
  expect(src).toContain("{subTab === 'all' && (");
  expect(src).toContain('drug-folder-viewall');
});

test('S2-3: top-level 묶음처방 탭(value=prescriptions) 보존 — 적층이며 기존 surface 제거 아님', () => {
  const page = read(PAGE);
  expect(page).toContain('value="prescriptions"');
  expect(page).toContain('data-testid="tab-prescription-sets-legacy"');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 약 검색 (엣지) — 검색은 PrescriptionSetsTab 내 좌측 검색 재사용,
//   없는 약명 → 빈 결과(에러 아님), 검색 비우면 전체 복원. (재사용 컴포넌트 책임)
// ─────────────────────────────────────────────────────────────────────────────
test('S3-1: 좌측 약 검색 = PrescriptionSetsTab 재사용(drugSearch) — 별도 검색 로직 신규 작성 안 함', () => {
  const sets = read(SETS);
  expect(sets).toContain('drugSearch');
  expect(sets).toContain('setDrugSearch');
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD: DB 무변경 + additive FE — 마이그/DDL/신규 npm 0
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD: 스키마 변경(ALTER TABLE)·신규 테이블 없음 — 순수 additive FE IA', () => {
  expect(read(TAB)).not.toMatch(/alter\s+table|create\s+table/i);
});

test('GUARD: prescription_sets 직접 write DML 신규 추가 없음(DrugFoldersTab은 IA만 — 묶음처방 저장은 PrescriptionSetsTab 기존 경로)', () => {
  const tab = read(TAB);
  expect(tab).not.toMatch(/from\(['"]prescription_sets['"]\)[\s\S]{0,80}\.(insert|update|delete)\(/);
});
