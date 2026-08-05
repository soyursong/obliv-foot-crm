/**
 * Regression spec — T-20260805-foot-REDPAY-WHITELIST-EXPAND-0805GAP-REACTIVATE
 *
 * 목적: 289002(풋 멀티) 재활성 + 0805 NEW-TID remap 데이터-레인 마이그의 mechanic 무결성 소스검증.
 *   근거 = DA CONSULT-REPLY MSG-20260805-083621-obfz / SSOT
 *          da_decision_foot_redpay_whitelist_expand_0805gap_reactivate_20260805.md.
 *   8/03 TRUE-ZERO 비활성(NOTXN-4TERM-RAWVERIFY-DEACTIVATE) → 8/04 TRUE-POSITIVE 재개
 *   (raw external_status=Y 4건/₩290,000, tid 1047538233, merchant.id=1777289002) → 재활성 필수.
 *
 * 계약(I1~I6) — db_only artifact-class, 순수 data-lane no-DDL(§3.1 대표게이트 면제):
 *  I1. up.sql = 단일행 UPDATE anchor merchant_id='1777289002' (blanket 금지, VALUES 1행).
 *  I2. mechanic 3동작: active=true + tid 신538233 + superseded_tids 에 구479476 DISTINCT append.
 *  I3. freeze 지문 가드: WHERE active=false AND tid=구479476 (중간변경 감지·멱등 no-op).
 *  I4. no-DDL: ALTER/CREATE/DROP/ADD COLUMN/INSERT/DELETE 문 부재(순수 UPDATE).
 *  I5. rollback = 역전 대칭(active=false + tid 구479476 복원 + superseded 제거→NULL 정규화).
 *  I6. source note = 재활성 provenance(external_status=Y·supersedes DEACTIVATE) 기재.
 *
 * ⚠ superseded_tids 컬럼 + 소비뷰 UNION 은 Opt-B′(20260724170000)로 旣배포 → 본 마이그 신규 DDL 0.
 * ⚠ prod apply 검증(rows-affected=1 · 뷰 0→4/₩290,000)은 dryrun.mjs + apply 로그가 SSOT(런타임 증적).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';

const UP = 'supabase/migrations/20260805120000_redpay_foot_registry_0805gap_reactivate.sql';
const ROLLBACK = 'supabase/migrations/20260805120000_redpay_foot_registry_0805gap_reactivate.rollback.sql';
const DRYRUN = 'supabase/migrations/20260805120000_redpay_foot_registry_0805gap_reactivate.dryrun.mjs';

const ANCHOR = '1777289002';
const OLD_TID = '1047479476';
const NEW_TID = '1047538233';

test('I1. up.sql = 단일행 UPDATE anchor 289002 (blanket 금지)', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  expect(sql).toContain(ANCHOR);
  expect(sql).toMatch(/UPDATE\s+public\.redpay_terminal_registry/);
  // VALUES 절에 단 하나의 merchant row (blanket 아님)
  const values = sql.match(/VALUES\s*\(\s*'1777289002'/);
  expect(values).not.toBeNull();
  // 다른 merchant_id 가 VALUES 에 섞이지 않음
  expect(sql).not.toMatch(/VALUES[\s\S]*?'1777289006'/);
});

test('I2. mechanic 3동작 — active flip + tid remap + superseded append', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  expect(sql).toMatch(/active\s*=\s*true/);                    // (1) 재활성
  expect(sql).toContain(NEW_TID);                              // (2) 신 live primary
  expect(sql).toMatch(/tid\s*=\s*r\.new_tid/);
  expect(sql).toMatch(/superseded_tids\s*=\s*ARRAY\(/);        // (3) DISTINCT append
  expect(sql).toMatch(/SELECT\s+DISTINCT\s+e/);
  expect(sql).toContain(OLD_TID);                             // 구 primary 보존
});

test('I3. freeze 지문 가드 — active=false AND tid=구479476 (중간변경 감지)', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  expect(sql).toMatch(/t\.active\s*=\s*false/);
  expect(sql).toMatch(/t\.tid\s*=\s*r\.old_tid/);
  expect(sql).toMatch(/t\.domain\s*=\s*'foot'/);
});

test('I4. no-DDL — 순수 data-lane UPDATE (ALTER/CREATE/DROP/INSERT/DELETE 부재)', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  expect(body).not.toMatch(/\bALTER\s+TABLE\b/i);
  expect(body).not.toMatch(/\bCREATE\s+(TABLE|OR\s+REPLACE|VIEW|INDEX)\b/i);
  expect(body).not.toMatch(/\bDROP\b/i);
  expect(body).not.toMatch(/\bADD\s+COLUMN\b/i);
  expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
  expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
});

test('I5. rollback = 역전 대칭 (active=false + tid 구479476 복원)', () => {
  const rb = fs.readFileSync(ROLLBACK, 'utf8');
  expect(rb).toMatch(/active\s*=\s*false/);
  expect(rb).toMatch(/tid\s*=\s*r\.old_tid/);
  expect(rb).toMatch(/NULLIF\(/);            // superseded 제거 후 NULL 정규화
  expect(rb).toContain(ANCHOR);
});

test('I6. source note provenance — external_status=Y·supersedes DEACTIVATE', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  expect(sql).toContain('external_status=Y');
  expect(sql).toMatch(/supersedes\s+T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE/);
  expect(sql).toContain('290,000');
});

test('I7. dryrun.mjs = 무영속 프로토콜 + rows-affected=1(G3) + AC-4 forecast', () => {
  const dr = fs.readFileSync(DRYRUN, 'utf8');
  expect(dr).toMatch(/DRYRUN_ROLLBACK_SENTINEL/);       // 무영속 sentinel
  expect(dr).toMatch(/DRYRUN_G3_FAIL/);                 // rows-affected=1 assert
  expect(dr).toMatch(/visible_after_reactivate/);       // AC-4 forecast
  expect(dr).toContain(NEW_TID);
});
