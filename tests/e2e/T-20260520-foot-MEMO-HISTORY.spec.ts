/**
 * T-20260520-foot-MEMO-HISTORY (P1)
 * 상세 치료메모 히스토리 누적 방식 변경 — E2E 검증
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   AC-1: 새 메모 저장 시 기존 메모 보존(누적) — append 방식 코드 검증
 *   AC-2: 최신순(DESC) 표시 + 작성자·작성일시 표시 코드 검증
 *   AC-3: 기존 treatment_note → 히스토리 첫 항목 lazy migration 코드 검증
 *   AC-4: 본인 작성분만 수정·삭제 (RBAC — created_by = profile.email 비교)
 *   AC-5: DB 마이그레이션 SQL 존재 + RLS 4종 포함
 *   AC-6: 빌드 성공 (dist/CustomerChartPage chunk 존재)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHART_PAGE_PATH = path.resolve(
  __dirname,
  '../../src/pages/CustomerChartPage.tsx',
);
const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260520000100_customer_treatment_memos.sql',
);
const DIST_PATH = path.resolve(__dirname, '../../dist');

// ── AC-1: 누적 방식 (append, 덮어쓰기 아님) ─────────────────────────

test('AC-1: saveNewTreatmentMemo — INSERT + prepend to list (덮어쓰기 없음)', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');

  // INSERT (append) 사용
  expect(src).toContain("from('customer_treatment_memos')");
  // 새 메모를 기존 목록 앞에 붙임 (덮어쓰기 아님)
  expect(src).toContain('[data as TreatmentMemoEntry, ...prev]');
  // UPDATE 단건 (전체 교체 아님)
  expect(src).toContain(".update({ content: editingMemoText.trim()");
  // customers.treatment_note 직접 덮어쓰기 없음
  const hasDirectOverwrite = src.includes("update({ treatment_note") ||
    src.includes("update({treatment_note");
  expect(hasDirectOverwrite).toBe(false);
});

test('AC-1: 치료메모 탭 UI — 새 메모 추가 입력창 존재', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('새 메모 추가');
  expect(src).toContain('메모 추가');
  expect(src).toContain('saveNewTreatmentMemo');
});

// ── AC-2: 최신순(DESC) + 작성자·일시 표시 ─────────────────────────

test('AC-2: ORDER BY created_at DESC (최신순 정렬)', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  // Supabase .order('created_at', { ascending: false })
  expect(src).toContain(".order('created_at', { ascending: false })");
});

test('AC-2: 작성자 이름 + 작성일시 포맷 표시', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  // created_by_name 표시
  expect(src).toContain('created_by_name');
  // date-fns format + ko locale
  expect(src).toContain("format(new Date(memo.created_at)");
  expect(src).toContain("{ locale: ko }");
  // 알 수 없음 fallback
  expect(src).toContain("'알 수 없음'");
});

test('AC-2: TreatmentMemoEntry 인터페이스 — 필수 필드 포함', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  // 인터페이스 정의
  expect(src).toContain('interface TreatmentMemoEntry');
  expect(src).toContain('created_by: string | null');
  expect(src).toContain('created_by_name: string | null');
  expect(src).toContain('created_at: string');
  expect(src).toContain('updated_at: string');
});

// ── AC-3: 기존 데이터 lazy migration ─────────────────────────────

test('AC-3: lazy migration — treatment_note → 히스토리 첫 항목', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  // 빈 목록 시 기존 treatment_note 확인
  expect(src).toContain('customer.treatment_note ?? customer.memo');
  // 이전 기록 표기
  expect(src).toContain("'(이전 기록)'");
  // INSERT로 마이그레이션
  expect(src).toMatch(/items\.length === 0[\s\S]*?existingNote[\s\S]*?insert\(/);
});

// ── AC-4: 본인 작성분만 수정·삭제 (RBAC) ─────────────────────────

test('AC-4: 수정·삭제 버튼 — created_by === profile.email 조건부 표시', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  // created_by와 profile.email 비교
  expect(src).toContain("memo.created_by && memo.created_by === profile?.email");
  // 수정 버튼
  expect(src).toContain('수정');
  // 삭제 버튼
  expect(src).toContain('삭제');
});

test('AC-4: saveTreatmentMemoEdit — eq(id) 본인 건만 UPDATE', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('const saveTreatmentMemoEdit');
  expect(src).toContain('.eq(\'id\', editingMemoId)');
});

// NOTE: T-20260624-foot-CHART2-MEMO-EDIT-DELETE 에서 hard-delete → soft-delete(deleted_at) 전환(의료법 §22-3/§40 진료기록 보존).
//       삭제 권한도 본인 한정 → admin/manager/director 전체관리로 확대. 아래는 갱신된 동작 검증.
test('AC-4: deleteTreatmentMemo — soft-delete(deleted_at) + eq(id)', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  expect(src).toContain('const deleteTreatmentMemo');
  expect(src).toContain('deleted_at:');
  expect(src).toContain(".eq('id', id)");
});

// ── AC-5: DB 마이그레이션 + RLS 4종 ──────────────────────────────

test('AC-5: customer_treatment_memos 마이그레이션 SQL 존재', () => {
  expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf-8');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS customer_treatment_memos');
  expect(sql).toContain('customer_id');
  expect(sql).toContain('clinic_id');
  expect(sql).toContain('content');
  expect(sql).toContain('created_by');
  expect(sql).toContain('created_by_name');
});

test('AC-5: RLS — clinic_isolation SELECT/INSERT + own UPDATE/DELETE', () => {
  const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf-8');
  expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  expect(sql).toContain('clinic_isolation_ctm_select');
  expect(sql).toContain('clinic_isolation_ctm_insert');
  expect(sql).toContain('own_update_ctm');
  expect(sql).toContain('own_delete_ctm');
  // 본인 이메일 기준 업데이트/삭제
  expect(sql).toContain("auth.jwt()->>'email'");
});

// ── AC-6: 빌드 성공 ──────────────────────────────────────────────

test('AC-6: dist/ 빌드 산출물 — CustomerChartPage chunk 존재', () => {
  expect(fs.existsSync(DIST_PATH)).toBe(true);
  const indexHtml = path.join(DIST_PATH, 'index.html');
  expect(fs.existsSync(indexHtml)).toBe(true);
  const assets = fs.readdirSync(path.join(DIST_PATH, 'assets'));
  const chartChunk = assets.some((f) => f.startsWith('CustomerChartPage'));
  expect(chartChunk).toBe(true);
});
