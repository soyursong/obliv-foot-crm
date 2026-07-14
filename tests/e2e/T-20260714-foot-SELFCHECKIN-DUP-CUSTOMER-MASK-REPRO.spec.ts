/**
 * E2E spec — T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO (Phase 2)
 * 셀프체크인 마스킹-reject 가드 = 공유 helper 승격(predicate-only) + 4 미가드 anon upsert RPC 에 fail-closed 가드.
 *
 * RC(phase1_findings 9f1a267c): WS-A 가드가 self_checkin 1경로만 방어 → 미가드 upsert RPC 4종이 masked
 *   customers row 를 INSERT → self_checkin 이 그 masked row 에 link → 대시보드 마스킹 + 통합시간표 중복차트.
 * DA CONSULT-REPLY(MSG-20260714-095358-vdna): 공유 helper YES / 개별 copy-paste NO / full core 통합 NO(별도 P2)
 *   / name+phone 양축 / 임계 <8 v_canon 공유 / masked fuzzy resolve 금지.
 *
 * 본건 = anon RPC 계약(write-path) 마이그 → behavioral surface = 마스킹 payload reject + raw 통과.
 * 결정론 소스-단언(마이그/롤백 구조 + 가드 4경로 + predicate 양축) + 라이브 DB 증거 참조(dry-run 무영속).
 *   라이브 predicate 정오탐·가드 22023 발화·무영속: db-gate/…_phase2_dryrun.md (supervisor DDL-diff 입력).
 *
 * AC1 — 공유 helper _fn_is_masked_pii(text,text) predicate-only(STABLE, SECURITY DEFINER 아님, name AND phone 양축).
 * AC2 — 4 미가드 RPC(upsert_customer/_resolve_v2/_resolve_v3/self_checkin_create) 최상단 fail-closed 가드(22023).
 * AC3 — 회귀 0: 가드 외 본문 무변경(v_canon 복합키 resolve verbatim) · masked fuzzy 매칭 미추가 · 롤백 가역.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MIG = 'supabase/migrations/20260714120000_selfcheckin_upsert_masked_pii_reject_guard.sql';
const ROLLBACK = 'supabase/migrations/20260714120000_selfcheckin_upsert_masked_pii_reject_guard.rollback.sql';
const DRYRUN = 'db-gate/T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO_phase2_dryrun.md';

// DA 명명 SSOT — 가드 대상 4 RPC.
const GUARDED_RPCS: ReadonlyArray<string> = [
  'fn_selfcheckin_upsert_customer',
  'fn_selfcheckin_upsert_customer_resolve_v2',
  'fn_selfcheckin_upsert_customer_resolve_v3',
  'self_checkin_create',
];

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');

test.describe('T-20260714-SELFCHECKIN-MASK-REPRO — 아티팩트·tx 구조', () => {
  test('마이그·롤백·dry-run 증거 존재', () => {
    expect(fs.existsSync(path.resolve(MIG))).toBe(true);
    expect(fs.existsSync(path.resolve(ROLLBACK))).toBe(true);
    expect(fs.existsSync(path.resolve(DRYRUN))).toBe(true);
  });

  test('마이그·롤백 단일 tx (BEGIN..COMMIT 정확히 1쌍)', () => {
    for (const f of [MIG, ROLLBACK]) {
      const sql = read(f);
      expect((sql.match(/^BEGIN;/gm) ?? []).length).toBe(1);
      expect((sql.match(/^COMMIT;/gm) ?? []).length).toBe(1);
    }
  });

  test('스키마 무변경 (ADDITIVE) — 컬럼/테이블/enum DDL 0', () => {
    const stmts = read(MIG).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(stmts).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(stmts).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(stmts).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(stmts).not.toMatch(/\bCREATE\s+TYPE\b/i);
    expect(stmts).not.toMatch(/\bADD\s+COLUMN\b/i);
  });
});

test.describe('AC1 — 공유 helper _fn_is_masked_pii (predicate-only)', () => {
  const sql = read(MIG);

  test('helper CREATE OR REPLACE 정확히 1회 (single-source)', () => {
    const m = sql.match(/CREATE OR REPLACE FUNCTION public\._fn_is_masked_pii\s*\(\s*p_name text\s*,\s*p_phone text\s*\)/gi) ?? [];
    expect(m.length).toBe(1);
  });

  test('predicate-only = STABLE · SECURITY DEFINER 아님', () => {
    // 실행 SQL 만(주석 제거) — 헤더 주석의 "SECURITY DEFINER 불요" 오탐 방지.
    const stmts = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    const createIdx = stmts.indexOf('CREATE OR REPLACE FUNCTION public._fn_is_masked_pii');
    const helperDef = stmts.slice(createIdx, stmts.indexOf('$$;', createIdx) + 3);
    expect(helperDef).toMatch(/\bSTABLE\b/);
    expect(helperDef).not.toMatch(/SECURITY DEFINER/i);
  });

  test('name AND phone 양축 검사 (name * / phone * / phone digits 1~7)', () => {
    const helperDef = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public._fn_is_masked_pii'), sql.indexOf('COMMENT ON FUNCTION public._fn_is_masked_pii'));
    // name '*' 지문
    expect(helperDef).toMatch(/position\('\*' in COALESCE\(btrim\(p_name\)/);
    // phone '*' 지문
    expect(helperDef).toMatch(/position\('\*' in COALESCE\(p_phone/);
    // phone 유효자릿수 1~7 (임계 <8 = v_canon 공유, DUMMY/빈=0 은 제외)
    expect(helperDef).toMatch(/BETWEEN 1 AND 7/);
  });
});

test.describe('AC2 — 4 RPC 최상단 fail-closed 가드', () => {
  const sql = read(MIG);

  for (const fn of GUARDED_RPCS) {
    test(`${fn}: CREATE OR REPLACE 존재`, () => {
      const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`);
      expect(sql).toMatch(re);
    });
  }

  test('가드 블록 = helper 호출 + RAISE 22023, 정확히 4회 (4경로)', () => {
    const guardCalls = sql.match(/IF public\._fn_is_masked_pii\(p_name, p_phone\) THEN/g) ?? [];
    expect(guardCalls.length).toBe(GUARDED_RPCS.length);
    const raise22023 = sql.match(/RAISE EXCEPTION 'masked PII rejected \(self-checkin ingress\)'/g) ?? [];
    expect(raise22023.length).toBe(GUARDED_RPCS.length);
    const errcode = sql.match(/ERRCODE = '22023'/g) ?? [];
    expect(errcode.length).toBe(GUARDED_RPCS.length);
  });

  test('4 RPC 각각 가드가 BEGIN 직후 최상단 (다른 로직보다 앞)', () => {
    for (const fn of GUARDED_RPCS) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`);
      const seg = sql.slice(start, start + 3000);
      const beginIdx = seg.indexOf('\nBEGIN\n');
      const guardIdx = seg.indexOf('_fn_is_masked_pii');
      expect(beginIdx).toBeGreaterThan(0);
      expect(guardIdx).toBeGreaterThan(beginIdx);
      // 가드가 first business logic(invalid input / clinic 조회 등)보다 앞: BEGIN~가드 사이에 다른 RAISE 없음
      const between = seg.slice(beginIdx, guardIdx);
      expect(between).not.toMatch(/RAISE EXCEPTION 'invalid/);
      expect(between).not.toMatch(/INSERT INTO/i);
      expect(between).not.toMatch(/SELECT .* INTO/i);
    }
  });
});

test.describe('AC3 — 회귀 0 (본문 무변경 · fuzzy 금지 · 가역)', () => {
  const sql = read(MIG);

  test('v_canon 임계(<8) 보존 = resolve 복합키 로직 무변경 (v2/v3)', () => {
    // reject-at-ingress 후 raw 만 진입 → 기존 [name AND phone-canonical] resolve 그대로.
    const canonRules = sql.match(/WHEN length\(v_digits\) < 8 THEN NULL/g) ?? [];
    expect(canonRules.length).toBe(2); // v2, v3
  });

  test('masked 값 fuzzy/부분매칭 미추가 (DA false-merge 금지) — LIKE %…% 유입 0', () => {
    const stmts = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    // 기존 canonical LIKE '0%'/'82%' 접두 정규화만 허용, 양측 wildcard(%…%) fuzzy 매칭 신규유입 금지
    expect(stmts).not.toMatch(/LIKE\s+'%[^']*%'/);
    expect(stmts).not.toMatch(/similarity\(|pg_trgm|ILIKE/i);
  });

  test('롤백 = 4함수 가드-前 복원 + helper DROP', () => {
    const rb = read(ROLLBACK);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\._fn_is_masked_pii\(text, text\);/);
    for (const fn of GUARDED_RPCS) {
      expect(rb).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`));
    }
    // 롤백엔 가드(helper 호출) 없음
    expect(rb).not.toMatch(/_fn_is_masked_pii\(p_name, p_phone\)/);
  });

  test('dry-run 증거 = predicate 정오탐 + 22023 fail-closed + 무영속 기재', () => {
    const doc = read(DRYRUN);
    expect(doc).toMatch(/false-reject 0/);
    expect(doc).toMatch(/22023/);
    expect(doc).toMatch(/무영속|no-persistence|n=0/);
    // DA 3종 회귀검증 매핑 기재
    expect(doc).toMatch(/masked ingress 4경로/);
    expect(doc).toMatch(/fuzzy\/부분매칭 미추가|false-merge 금지/);
  });
});
