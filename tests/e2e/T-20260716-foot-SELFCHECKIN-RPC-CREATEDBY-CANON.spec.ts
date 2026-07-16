/**
 * T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON
 * self-checkin upsert RPC 3종(base/v2/v3) INSERT created_by provenance stamp = 리터럴 'self_checkin'
 *
 * ─ 권위 결정 ──────────────────────────────────────────────────────
 *   부모 T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE Q5(created_by NULL) 분리 발주.
 *   planner mini-design: 값 = (b) service sentinel 리터럴 'self_checkin' (self_checkin_create 미러).
 *   근거: self_checkin_create(phone-only 경로)가 이미 created_by='self_checkin' stamp(정착) →
 *         같은 self-checkin origin 계열의 sentinel 미러. 신규 canon 신설 0 = convergence.
 *
 * ─ 확정 스코프 ─────────────────────────────────────────────────────
 *   (1) 3함수 INSERT INTO customers(...) 컬럼목록 + created_by / VALUES + 'self_checkin' (신규 write only).
 *   (2) UPDATE(linked 기존행) created_by 덮어쓰기 금지 = new-write-only (부모 Q4 철학).
 *   (3) post-normalize 본문(normalize_phone write) 클로버 금지 — additive delta only.
 *   (4) 롤백 = created_by 제거(post-normalize 본문 복원).
 *
 * 스펙: SQL 마이그레이션 정적 검증(codebase DB-migration spec 컨벤션). 무영속 dry-run 은
 *   scripts/T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON_dryrun.mjs (BEGIN…ROLLBACK, prod 무변경).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIG = path.resolve(
  __dirname,
  '../../supabase/migrations/20260717120000_foot_selfcheckin_upsert_created_by_canon.sql',
);
const ROLLBACK = path.resolve(
  __dirname,
  '../../supabase/migrations/20260717120000_foot_selfcheckin_upsert_created_by_canon.rollback.sql',
);

const readMig = (): string => fs.readFileSync(MIG, 'utf-8');
const readRollback = (): string => fs.readFileSync(ROLLBACK, 'utf-8');

const FN_SIGS = [
  'CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer(',
  'CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v2(',
  'CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v3(',
];

// 각 함수의 INSERT INTO customers( ... ) VALUES ( ... ) 블록만 추출(다음 함수 시그니처 또는 EOF 전까지).
function insertBlocks(src: string): string[] {
  const blocks: string[] = [];
  for (let i = 0; i < FN_SIGS.length; i++) {
    const start = src.indexOf(FN_SIGS[i]);
    expect(start, `함수 시그니처 존재: ${FN_SIGS[i]}`).toBeGreaterThan(-1);
    const nextStart = i + 1 < FN_SIGS.length ? src.indexOf(FN_SIGS[i + 1], start) : src.length;
    const fnBody = src.slice(start, nextStart < 0 ? src.length : nextStart);
    const insIdx = fnBody.indexOf('INSERT INTO customers');
    expect(insIdx, `INSERT INTO customers 존재: ${FN_SIGS[i]}`).toBeGreaterThan(-1);
    // INSERT ~ RETURNING id 까지가 하나의 INSERT 문
    const ret = fnBody.indexOf('RETURNING id', insIdx);
    blocks.push(fnBody.slice(insIdx, ret > -1 ? ret : fnBody.length));
  }
  return blocks;
}

// UPDATE customers SET ... WHERE id = v_id 블록 추출(있는 함수만).
function updateBlocks(src: string): string[] {
  const blocks: string[] = [];
  for (let i = 0; i < FN_SIGS.length; i++) {
    const start = src.indexOf(FN_SIGS[i]);
    const nextStart = i + 1 < FN_SIGS.length ? src.indexOf(FN_SIGS[i + 1], start) : src.length;
    const fnBody = src.slice(start, nextStart < 0 ? src.length : nextStart);
    let from = 0;
    for (;;) {
      const u = fnBody.indexOf('UPDATE customers SET', from);
      if (u < 0) break;
      const w = fnBody.indexOf('WHERE id = v_id', u);
      blocks.push(fnBody.slice(u, w > -1 ? w : fnBody.length));
      from = u + 1;
    }
  }
  return blocks;
}

// ── (1) 3함수 INSERT 모두 created_by 컬럼 + 'self_checkin' 리터럴 착지 ──────────
test('(1): 3함수 INSERT 컬럼목록에 created_by + VALUES 리터럴 self_checkin', () => {
  const blocks = insertBlocks(readMig());
  expect(blocks.length).toBe(3);
  for (const b of blocks) {
    expect(b, 'INSERT 컬럼목록에 created_by').toContain('created_by');
    expect(b, "VALUES 리터럴 'self_checkin'").toContain("'self_checkin'");
  }
});

// ── (2) new-write-only: UPDATE SET 절에 created_by 덮어쓰기 없음(부모 Q4) ───────
test('(2): UPDATE(linked) SET 절에 created_by 덮어쓰기 없음 — new-write-only', () => {
  const ups = updateBlocks(readMig());
  // base/v2/v3 각 1개 UPDATE = 3개
  expect(ups.length).toBe(3);
  for (const u of ups) {
    expect(u, 'UPDATE SET 절에 created_by = 없음').not.toMatch(/created_by\s*=/i);
  }
});

// ── (3) post-normalize 본문 클로버 금지: INSERT phone 은 normalize_phone write 유지 ──
test('(3): INSERT phone = normalize_phone(NULLIF(p_phone,\'\')) 보존(정규화 write 클로버 금지)', () => {
  const blocks = insertBlocks(readMig());
  for (const b of blocks) {
    expect(b, 'normalize_phone write 보존').toContain("public.normalize_phone(NULLIF(p_phone,''))");
    // RAW p_phone 직접저장 회귀 없음(정규화 없이 p_phone 을 phone 값으로 쓰지 않음)
    expect(b, 'RAW phone 회귀 없음').not.toMatch(/phone[^)]*VALUES[\s\S]*[(,]\s*p_phone\s*,/);
  }
});

// ── (4) 롤백: created_by 제거(post-normalize 복원) + normalize write 유지 ────────
test('(4): 롤백 파일은 created_by INSERT 미포함 + normalize write 유지', () => {
  const rb = readRollback();
  const blocks = insertBlocks(rb);
  expect(blocks.length).toBe(3);
  for (const b of blocks) {
    expect(b, "롤백 INSERT 에 self_checkin 리터럴 없음").not.toContain("'self_checkin'");
    expect(b, '롤백도 normalize write 유지').toContain("public.normalize_phone(NULLIF(p_phone,''))");
  }
});

// ── 회귀: 3함수 시그니처·마스킹 가드·dedup canonical·트랜잭션 경계 불변 ──────────
test('회귀: 3함수 정의 + 마스킹 가드 + canonical dedup + BEGIN/COMMIT 경계 불변', () => {
  const src = readMig();
  for (const sig of FN_SIGS) expect(src).toContain(sig);
  // 마스킹-reject 가드(fail-closed) 유지 — 3함수
  expect((src.match(/_fn_is_masked_pii/g) || []).length).toBeGreaterThanOrEqual(3);
  // canonical dedup 수렴(82…) 유지
  expect(src).toContain("'82' || substring");
  // 트랜잭션 경계
  expect(src.trim().startsWith('-- T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON')).toBeTruthy();
  expect(src).toContain('BEGIN;');
  expect(src).toContain('COMMIT;');
  // v3 민감정보 동의 컬럼 보존(no-downgrade)
  expect(src).toContain('consent_sensitive');
});
