/**
 * T-20260624-foot-CHART2-MEMO-EDIT-DELETE (P2)
 * 2번차트 — 저장된 메모 수정·삭제 가능하게 (이력형 메모 엔트리 edit/soft-delete)
 *
 * 갭(AC-3 선결조사 확정):
 *   치료/상담메모 이력 엔트리 UPDATE/DELETE가 RLS·FE 모두 '본인 작성분(created_by=email)'만 허용
 *   → 총괄(admin/manager)이 타인 작성·이전기록(created_by=null) 메모를 수정·삭제 불가 = "안된다"의 정체.
 *   추가로 삭제가 hard-delete → 의료법(치료메모=진료기록) 위반.
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   AC-1: 저장된 메모 엔트리 수정(edit) 동선 — saveTreatmentMemoEdit + updated_at 기록
 *   AC-2: 삭제 = soft-delete(deleted_at 마킹), hard-delete 금지(의료법) + 확인 모달
 *   AC-3: admin/manager/director 전체메모 관리권한(canManageMemo) — 타인/이전기록 메모도 수정·삭제
 *   AC-4: soft-delete 행은 조회에서 제외(.is('deleted_at', null))
 *   AC-5: DB 마이그레이션 — soft-delete 컬럼 + role-manage RLS + hard-delete RLS 제거
 *   AC-6: 빌드 성공 (dist/CustomerChartPage chunk 존재)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHART_PAGE_PATH = path.resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');
const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260624160000_memo_soft_delete_role_manage.sql',
);
const MIGRATION_DOWN_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260624160000_memo_soft_delete_role_manage.down.sql',
);
const DIST_PATH = path.resolve(__dirname, '../../dist');

// ── AC-1: 저장된 메모 수정(edit) 동선 ────────────────────────────
test('AC-1: 치료메모 수정 — saveTreatmentMemoEdit + updated_at 기록', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('const saveTreatmentMemoEdit');
  expect(src).toContain('.update({ content: editingMemoText.trim(), updated_at:');
  // 수정 진입 동선(편집 상태 전환)
  expect(src).toContain('setEditingMemoId(memo.id)');
  expect(src).toContain('수정 저장');
});

test('AC-1: 이력형(예약/상담) 메모 hook도 수정 동선 보유 — saveEdit + updated_at', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('const saveEdit = async');
  expect(src).toContain('.update({ content: editingText.trim(), updated_at: now })');
});

// ── AC-2: 삭제 = soft-delete (hard-delete 금지) ──────────────────
test('AC-2: deleteTreatmentMemo — soft-delete(deleted_at UPDATE), .delete() 미사용', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('const deleteTreatmentMemo');
  // soft-delete: deleted_at 마킹 + deleted_by 기록
  expect(src).toMatch(/deleteTreatmentMemo[\s\S]*?\.update\(\{ deleted_at:[\s\S]*?deleted_by: profile\?\.email/);
  // hard-delete 잔존 없음 (전역적으로 .delete()가 메모 삭제에 쓰이지 않음)
  expect(src).not.toContain("from('customer_treatment_memos')\n      .delete()");
});

test('AC-2: 삭제 확인 모달(window.confirm) 노출', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('이 치료메모를 삭제하시겠습니까?');
  // 이력형 hook 삭제도 confirm
  expect(src).toContain('이 메모를 삭제하시겠습니까?');
});

test('AC-2: 이력형 hook remove도 soft-delete(deleted_at UPDATE)', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toMatch(/const remove = async[\s\S]*?\.update\(\{ deleted_at:[\s\S]*?deleted_by: authorEmail/);
});

// ── AC-3: admin/manager/director 전체메모 관리권한 ────────────────
test('AC-3: canManageMemo — admin/manager/director 권한 플래그 정의', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('const canManageMemo =');
  expect(src).toContain("profile?.role === 'admin'");
  expect(src).toContain("profile?.role === 'manager'");
  expect(src).toContain("profile?.role === 'director'");
});

test('AC-3: 치료메모 수정·삭제 버튼 — canManageMemo OR 본인 작성분 표시', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('(canManageMemo || (memo.created_by && memo.created_by === profile?.email))');
});

test('AC-3: MemoHistoryPanel canManageAll prop — 본인 OR 전체관리', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('canManageAll = false');
  expect(src).toContain('(canManageAll || (memo.created_by && memo.created_by === profileEmail))');
  // 두 패널(예약/상담) 모두 canManageMemo 주입
  const occurrences = src.match(/canManageAll=\{canManageMemo\}/g) ?? [];
  expect(occurrences.length).toBeGreaterThanOrEqual(2);
});

// ── AC-4: soft-delete 행 조회 제외 ───────────────────────────────
test('AC-4: 메모 조회 시 deleted_at IS NULL 필터 적용', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  // 치료메모 목록 + 요약(eager) + 이력형 hook load/eager — 최소 3곳 이상
  const occurrences = src.match(/\.is\('deleted_at', null\)/g) ?? [];
  expect(occurrences.length).toBeGreaterThanOrEqual(3);
});

// ── AC-5: DB 마이그레이션 ────────────────────────────────────────
test('AC-5: 마이그레이션 SQL 존재 + soft-delete 컬럼(3 테이블)', () => {
  expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf-8');
  for (const t of ['customer_treatment_memos', 'customer_reservation_memos', 'customer_consult_memos']) {
    expect(sql).toContain(`ALTER TABLE ${t}`);
  }
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS deleted_by text');
});

test('AC-5: role-manage UPDATE RLS + hard-delete DELETE RLS 제거', () => {
  const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf-8');
  // UPDATE: 본인 OR admin/manager/director
  expect(sql).toContain("current_user_role() = ANY (ARRAY['admin','manager','director'])");
  expect(sql).toContain('CREATE POLICY "manage_update_ctm"');
  // hard-delete 금지 — own_delete 정책 DROP
  expect(sql).toContain('DROP POLICY IF EXISTS "own_delete_ctm"');
  expect(sql).toContain('DROP POLICY IF EXISTS "own_delete_crm"');
  expect(sql).toContain('DROP POLICY IF EXISTS "own_delete_ccm"');
});

test('AC-5: down 롤백 SQL 존재 (own-only 복원 + 컬럼 제거)', () => {
  expect(fs.existsSync(MIGRATION_DOWN_PATH)).toBe(true);
  const down = fs.readFileSync(MIGRATION_DOWN_PATH, 'utf-8');
  expect(down).toContain('CREATE POLICY "own_update_ctm"');
  expect(down).toContain('DROP COLUMN IF EXISTS deleted_at');
});

// ── AC-6: 빌드 성공 ──────────────────────────────────────────────
test('AC-6: dist/ 빌드 산출물 — CustomerChartPage chunk 존재', () => {
  expect(fs.existsSync(DIST_PATH)).toBe(true);
  const assets = fs.readdirSync(path.join(DIST_PATH, 'assets'));
  expect(assets.some((f) => f.startsWith('CustomerChartPage'))).toBe(true);
});
