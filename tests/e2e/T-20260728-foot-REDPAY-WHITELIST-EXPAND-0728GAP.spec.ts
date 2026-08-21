/**
 * Regression spec — T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP (0821 GAP superseded-remap)
 *
 * 목적: 0821 GAP superseded-remap 데이터-레인 마이그의 mechanic 무결성 소스검증.
 *   근거 = recon-autoroute A11 DRIFT GAP-REPORT MSG-20260821-081505-w3n0 (DA 자율·대표게이트 면제).
 *   window 2026-08-18~08-21 → 기등록 active foot merchant 2종 아래 미등록 신 TID 2종 표면화
 *   = NEW-TID DRIFT(§9/§11-class) → superseded-remap seed.
 *     285004(풋 VAN) : 구1047479261 → 신1047535839 (535xxx band)
 *     288005(풋 유선): 구1047479473 → 신1047538247 (538xxx band)
 *
 * 계약(I1~I7) — db_only artifact-class, 순수 data-lane no-DDL(§3.1 대표게이트 면제):
 *  I1. up.sql = 2행 UPDATE VALUES(285004/288005) — exact merchant_id(blanket 금지).
 *  I2. mechanic 2동작: tid=신TID + 구 479xxx superseded_tids DISTINCT append.
 *  I3. freeze 지문 가드: WHERE tid=구값 AND domain='foot' (중간변경 감지·멱등 no-op).
 *  I4. no-DDL: ALTER/CREATE/DROP/ADD COLUMN/INSERT/DELETE 문 부재(순수 UPDATE).
 *  I5. rollback = 역전 대칭(tid 구479xxx 복원 + superseded 제거→NULL 정규화 + tid=신값 freeze).
 *  I6. cross-tenant 격리: WHERE domain='foot' 스코핑 + 도수/피부/롱레 merchant 미포함.
 *  I7. dryrun.mjs = 무영속 sentinel 프로토콜 + view-accurate forecast.
 *
 * ⚠ superseded_tids 컬럼 + 소비뷰 UNION 은 Opt-B′(20260724170000)로 旣배포 → 본 마이그 신규 DDL 0.
 * ⚠ prod apply 검증(rows-affected=2 · 뷰 0→2/₩2,000,100)은 dryrun.mjs + apply 로그가 SSOT(런타임 증적).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';

const UP = 'supabase/migrations/20260821120000_redpay_foot_registry_0821gap_remap.sql';
const ROLLBACK = 'supabase/migrations/20260821120000_redpay_foot_registry_0821gap_remap.rollback.sql';
const DRYRUN = 'supabase/migrations/20260821120000_redpay_foot_registry_0821gap_remap.dryrun.mjs';

const M1 = '1777285004', OLD1 = '1047479261', NEW1 = '1047535839'; // 풋(VAN)
const M2 = '1777288005', OLD2 = '1047479473', NEW2 = '1047538247'; // 풋(유선)

test('I1. up.sql = 2행 UPDATE VALUES(285004/288005) — exact merchant(blanket 금지)', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  expect(sql).toMatch(/UPDATE\s+public\.redpay_terminal_registry/);
  expect(sql).toContain(M1);
  expect(sql).toContain(M2);
  expect(sql).toMatch(/VALUES\s*\n?\s*\(\s*'1777285004'/);
  expect(sql).toMatch(/\(\s*'1777288005'/);
  // blanket 아님 — WHERE 절이 merchant_id 조인에 매여 있음
  expect(sql).toMatch(/WHERE\s+t\.merchant_id\s*=\s*m\.merchant_id/);
});

test('I2. mechanic — tid=신TID + 구TID superseded_tids DISTINCT append', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  expect(sql).toMatch(/tid\s*=\s*m\.new_tid/);
  expect(sql).toMatch(/superseded_tids\s*=\s*ARRAY\(/);
  expect(sql).toMatch(/SELECT\s+DISTINCT\s+e/);
  expect(sql).toMatch(/e\s*<>\s*m\.new_tid/);        // 신TID 중복 방지 가드
  expect(sql).toContain(NEW1);
  expect(sql).toContain(NEW2);
  expect(sql).toContain(OLD1);
  expect(sql).toContain(OLD2);
});

test('I3. freeze 지문 가드 — WHERE tid=구값 AND domain=foot (멱등 no-op)', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  expect(sql).toMatch(/t\.tid\s*=\s*m\.old_tid/);
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

test('I5. rollback = 역전 대칭 (tid 구479xxx 복원 + NULL 정규화 + tid=신값 freeze)', () => {
  const rb = fs.readFileSync(ROLLBACK, 'utf8');
  expect(rb).toMatch(/tid\s*=\s*m\.old_tid/);
  expect(rb).toMatch(/NULLIF\(/);                     // superseded 제거 후 NULL 정규화
  expect(rb).toMatch(/t\.tid\s*=\s*m\.new_tid/);       // apply 후 상태에서만 역전
  expect(rb).toContain(M1);
  expect(rb).toContain(M2);
});

test('I6. cross-tenant 격리 — domain=foot 스코핑 + 도수/피부/롱레 merchant 미포함', () => {
  const sql = fs.readFileSync(UP, 'utf8');
  expect(sql).toMatch(/t\.domain\s*=\s*'foot'/);
  // 도수(274-276*)·피부(277/279-281*)·롱레(282/284*) band 미포함
  expect(sql).not.toMatch(/'177727[46]/);
  expect(sql).not.toMatch(/'177728[24]/);
});

test('I7. dryrun.mjs = 무영성 sentinel 프로토콜 + view-accurate forecast', () => {
  const dr = fs.readFileSync(DRYRUN, 'utf8');
  expect(dr).toMatch(/DRYRUN_ROLLBACK_SENTINEL/);      // 무영속 sentinel
  expect(dr).toMatch(/visible_after_remap/);           // view-accurate forecast
  expect(dr).toMatch(/still_old_tid/);                 // 무영속 확증
  expect(dr).toContain(NEW1);
  expect(dr).toContain(NEW2);
});
