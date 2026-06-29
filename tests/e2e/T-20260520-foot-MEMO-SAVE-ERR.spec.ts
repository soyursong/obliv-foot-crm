/**
 * T-20260520-foot-MEMO-SAVE-ERR (P0 hotfix)
 * customer_treatment_memos 테이블 존재 + AC-3 graceful fallback 검증
 *
 * ─ 검증 범위 ──────────────────────────────────────────────────────
 *   AC-1: customer_treatment_memos 테이블 마이그레이션 SQL 존재 확인
 *   AC-2: REST API로 테이블 접근 가능 (PGRST205 에러 없음)
 *   AC-3: saveNewTreatmentMemo — 테이블 미존재 시 graceful fallback 코드 존재
 *   AC-4: 기존 customers 테이블 컬럼(treatment_note, memo) 손상 없음
 *   AC-5: 빌드 성공 (dist/ 존재 확인)
 *
 * 근본원인: commit cf88118 MEMO-HISTORY 코드 포함됐으나 DB migration 미적용
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATION_SQL_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260520000100_customer_treatment_memos.sql',
);
const MIGRATION_DOWN_PATH = path.resolve(
  __dirname,
  '../../supabase/migrations/20260520000100_customer_treatment_memos.down.sql',
);
const CHART_PAGE_PATH = path.resolve(
  __dirname,
  '../../src/pages/CustomerChartPage.tsx',
);
const DIST_PATH = path.resolve(__dirname, '../../dist');

// ── AC-1: migration 파일 존재 확인 ──────────────────────────────────

test('AC-1: customer_treatment_memos migration SQL 존재', () => {
  expect(fs.existsSync(MIGRATION_SQL_PATH)).toBe(true);
  const sql = fs.readFileSync(MIGRATION_SQL_PATH, 'utf-8');
  // 핵심 DDL 포함 검증
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS customer_treatment_memos');
  expect(sql).toContain('customer_id');
  expect(sql).toContain('clinic_id');
  expect(sql).toContain('content');
  expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  expect(sql).toContain('clinic_isolation_ctm_select');
  expect(sql).toContain('clinic_isolation_ctm_insert');
});

test('AC-1: 롤백 SQL 존재', () => {
  expect(fs.existsSync(MIGRATION_DOWN_PATH)).toBe(true);
  const sql = fs.readFileSync(MIGRATION_DOWN_PATH, 'utf-8');
  expect(sql).toContain('DROP TABLE IF EXISTS customer_treatment_memos');
});

// ── AC-2: REST API 접근 가능 (테이블 존재 확인) ─────────────────────

test('AC-2: customer_treatment_memos REST API 접근 성공 (PGRST205 없음)', async () => {
  const url = process.env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })();

  const res = await fetch(`${url}/rest/v1/customer_treatment_memos?select=id&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  // 200 OK (빈 배열) 또는 206 — PGRST205 (테이블 미존재) 아니어야 함
  expect(res.status).not.toBe(404);
  const body = await res.text();
  expect(body).not.toContain('PGRST205');
  expect(body).not.toContain('schema cache');
});

// ── AC-3: graceful fallback 코드 존재 확인 ──────────────────────────

test('AC-3: loadTreatmentMemos 에러 시 graceful fallback 코드 존재', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  // PGRST205 감지 코드
  expect(src).toContain("PGRST205");
  // "준비 중" 사용자 친화 메시지
  expect(src).toContain('치료메모 기능 준비 중입니다');
  // treatmentMemoUnavailable 상태 플래그
  expect(src).toContain('treatmentMemoUnavailable');
  expect(src).toContain('setTreatmentMemoUnavailable');
});

test('AC-3: saveNewTreatmentMemo — raw 에러 대신 친절한 메시지 분기', () => {
  const src = fs.readFileSync(CHART_PAGE_PATH, 'utf-8');
  // isTableMissing 분기
  expect(src).toContain('isTableMissing');
  // 저장 실패 raw 에러는 table-missing 외 경우만 노출
  const saveBlock = src.match(/const saveNewTreatmentMemo[\s\S]*?^  \};/m)?.[0] ?? src;
  // "준비 중" 안내 포함
  expect(saveBlock).toContain('준비 중');
});

// ── AC-4: customers 테이블 기존 컬럼 손상 없음 ──────────────────────

test('AC-4: customers 테이블 treatment_note, memo 컬럼 손상 없음 (REST 확인)', async () => {
  const url = process.env.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })();

  const res = await fetch(`${url}/rest/v1/customers?select=id,treatment_note,memo&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  // 컬럼이 존재하면 200 OK
  expect(res.status).toBe(200);
  const body = await res.text();
  // "column not found" 에러 없음
  expect(body).not.toContain('column');
});

// ── AC-5: 빌드 성공 확인 ────────────────────────────────────────────

test('AC-5: dist/ 빌드 산출물 존재', () => {
  expect(fs.existsSync(DIST_PATH)).toBe(true);
  const indexHtml = path.join(DIST_PATH, 'index.html');
  expect(fs.existsSync(indexHtml)).toBe(true);
  // CustomerChartPage chunk 존재
  const assets = fs.readdirSync(path.join(DIST_PATH, 'assets'));
  const chartChunk = assets.some((f) => f.startsWith('CustomerChartPage'));
  expect(chartChunk).toBe(true);
});
