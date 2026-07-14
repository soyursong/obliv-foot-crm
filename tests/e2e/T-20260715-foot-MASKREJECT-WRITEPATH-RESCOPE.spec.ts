/**
 * E2E spec — T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE
 * 소스차단 RE-SCOPE: 旣GO 공유 helper _fn_is_masked_pii 의 fail-closed reject 를 INSERT-capable 미가드 2경로에 확장.
 *
 * 배경(WRITEPATH-FORENSIC 998a263f): REPRO 소스차단(4 upsert-family 가드)은 customers write-path 11경로 중 4개만
 *   커버 → apply 8h 후 신규 마스킹 row e3216e83("접****1"/"7887") 생성 = 소스 미차단.
 * e3216e83 실경로(본 티켓 forensic): created_by=NULL(self_checkin 아님) + reservations 0 + health_q_tokens
 *   general/+24h 지문 ⇒ fn_dashboard_reissue_health_q_token 산. hold 경로 아님.
 * DA CONSULT-REPLY(MSG-20260715-001514-b6jm): Q1 GO(helper 연장=ADDITIVE) / Q2 self_checkin 제외(soft-hold 가드)
 *   / Q3 UPDATE 4경로는 durable trigger 로 흡수(per-RPC 추가 금지) / write-path "closed" 선언 유보.
 *
 * behavioral surface = anon/service_role RPC 계약 → 라이브 DB 증거 참조(dry-run 무영속).
 *   가드 fire(22023)·회귀 0·carve-out(취소 hard-fail 무)·무영속: db-gate/…_dryrun.md (supervisor DDL-diff 입력).
 *
 * AC1 — 확장 대상 = 정확히 2경로(reissue_health_q_token + upsert_reservation_from_source). self_checkin 미포함.
 * AC2 — 각 경로 fail-closed 가드(helper 호출 + RAISE 22023). reissue=상단 / upsert=customers persist 경계.
 * AC3 — ADDITIVE: helper 재정의 0(旣GO 재사용) · 스키마 DDL 0 · 본문 verbatim · 롤백 가역.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MIG = 'supabase/migrations/20260715120000_maskreject_writepath_rescope_2paths.sql';
const ROLLBACK = 'supabase/migrations/20260715120000_maskreject_writepath_rescope_2paths.rollback.sql';
const DRYRUN = 'db-gate/T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE_dryrun.md';

const EXTENDED_RPCS: ReadonlyArray<string> = [
  'fn_dashboard_reissue_health_q_token',
  'upsert_reservation_from_source',
];

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');
const stripComments = (sql: string) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

test.describe('T-20260715-MASKREJECT-WRITEPATH-RESCOPE — 아티팩트·tx 구조', () => {
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
});

test.describe('AC1 — 확장 대상 = 정확히 2경로 (self_checkin 미포함)', () => {
  const sql = read(MIG);

  for (const fn of EXTENDED_RPCS) {
    test(`${fn}: CREATE OR REPLACE 존재`, () => {
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`));
    });
  }

  test('CREATE OR REPLACE FUNCTION 은 정확히 2개 (helper 재정의 0 · self_checkin 0)', () => {
    const creates = sql.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) ?? [];
    expect(creates.length).toBe(2);
    // 旣GO helper 는 재정의하지 않음(20260714120000 소관 · prod 실재 재사용)
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\._fn_is_masked_pii/);
    // self_checkin_with_reservation_link 는 carve-out(제외)
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.self_checkin_with_reservation_link/);
  });
});

test.describe('AC2 — 각 경로 fail-closed 가드 (helper 호출 + 22023)', () => {
  const sql = read(MIG);

  test('helper 호출 가드 정확히 2회 + RAISE 22023 정확히 2회', () => {
    const guardCalls = sql.match(/IF public\._fn_is_masked_pii\(p_customer_name, p_customer_phone\) THEN/g) ?? [];
    expect(guardCalls.length).toBe(2);
    const raise = sql.match(/RAISE EXCEPTION 'masked PII rejected/g) ?? [];
    expect(raise.length).toBe(2);
    const errcode = sql.match(/ERRCODE = '22023'/g) ?? [];
    // reissue(1) + upsert(1). upsert 본문 기존 22023(입력검증) 도 존재하므로 하한만 단언.
    expect(errcode.length).toBeGreaterThanOrEqual(2);
  });

  test('reissue: 가드가 BEGIN 직후 상단 (첫 business 로직보다 앞)', () => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_dashboard_reissue_health_q_token');
    const seg = sql.slice(start, start + 3000);
    const beginIdx = seg.indexOf('\nBEGIN\n');
    const guardIdx = seg.indexOf('_fn_is_masked_pii');
    expect(beginIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeGreaterThan(beginIdx);
    // BEGIN~가드 사이에 SELECT/INSERT/UPDATE 없음 (진짜 최상단) — 주석 제거 후 실행 SQL 만 검사
    const between = stripComments(seg.slice(beginIdx, guardIdx));
    expect(between).not.toMatch(/\b(INSERT|UPDATE)\b/i);
    expect(between).not.toMatch(/SELECT\s+id\s+INTO/i);
  });

  test('upsert: 가드가 customers persist 경계 (INSERT INTO customers 직전, cancel/companion 무write 경로 뒤)', () => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source');
    const seg = sql.slice(start);
    const guardIdx = seg.indexOf('_fn_is_masked_pii(p_customer_name, p_customer_phone)');
    const custInsertIdx = seg.indexOf('INSERT INTO public.customers');
    const cancelIdx = seg.indexOf("lower(btrim(COALESCE(p_status, ''))) = 'cancelled'");
    expect(guardIdx).toBeGreaterThan(0);
    expect(custInsertIdx).toBeGreaterThan(0);
    // 가드는 customers INSERT 직전
    expect(guardIdx).toBeLessThan(custInsertIdx);
    // 가드는 취소 fast-path 이후 (carve-out: 취소는 가드 미도달)
    expect(cancelIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeGreaterThan(cancelIdx);
    // companion 분기(v_customer_id := NULL)는 가드 없이 통과 — 가드는 ELSE 분기 내
    const elseIdx = seg.indexOf('ELSE\n    v_norm_phone := public.normalize_phone');
    expect(elseIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeGreaterThan(elseIdx);
  });
});

test.describe('AC3 — ADDITIVE (스키마 무변경 · 본문 verbatim · 롤백 가역)', () => {
  const sql = read(MIG);

  test('스키마 DDL 0 (ALTER/CREATE TABLE·TYPE·ADD COLUMN·DROP 없음)', () => {
    const stmts = stripComments(sql);
    expect(stmts).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(stmts).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(stmts).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(stmts).not.toMatch(/\bCREATE\s+TYPE\b/i);
    expect(stmts).not.toMatch(/\bADD\s+COLUMN\b/i);
    expect(stmts).not.toMatch(/\bALTER\s+TYPE\b/i);
  });

  test('본문 verbatim 보존 근거 — upsert lifecycle 가드·companion·memo timeline 유지', () => {
    // 가드 외 무변경: 프로드 정의의 핵심 블록이 그대로 존재
    expect(sql).toMatch(/lifecycle-invalid cancel/);
    expect(sql).toMatch(/lifecycle-invalid edit/);
    expect(sql).toMatch(/never-downgrade 가드/);
    expect(sql).toMatch(/reservation_memo_history/);
    // reissue: search_path=public,extensions + URL-safe token 보존
    expect(sql).toMatch(/SET search_path TO 'public', 'extensions'/);
    expect(sql).toMatch(/translate\(encode\(gen_random_bytes\(24\), 'base64'\), '\+\/=', '-_'\)/);
  });

  test('롤백 = 가드-前 정의 복원 (helper DROP 안 함 · 가드 IF 미포함)', () => {
    const rb = read(ROLLBACK);
    for (const fn of EXTENDED_RPCS) {
      expect(rb).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`));
    }
    // 롤백엔 helper 호출 가드 없음
    expect(rb).not.toMatch(/_fn_is_masked_pii\(p_customer_name, p_customer_phone\)/);
    // 공유 helper 는 DROP 하지 않음(20260714120000 소관)
    expect(rb).not.toMatch(/DROP FUNCTION.*_fn_is_masked_pii/i);
  });

  test('dry-run 증거 = 가드 fire 22023 + 회귀 0 + carve-out + 무영속 기재', () => {
    const doc = read(DRYRUN);
    expect(doc).toMatch(/rejected 22023/);
    expect(doc).toMatch(/false-reject 0/);
    expect(doc).toMatch(/carve-out/);
    expect(doc).toMatch(/무영속|no-persistence|has_guard=false/);
    // self_checkin 제외 + UPDATE 4경로 durable trigger 흡수 명시
    expect(doc).toMatch(/self_checkin.*제외|제외.*self_checkin/);
    expect(doc).toMatch(/durable table-level trigger/);
    // write-path closed 선언 유보 명시
    expect(doc).toMatch(/"closed" 선언 유보/);
  });
});
