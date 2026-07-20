/**
 * E2E spec — T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN
 * self_checkin_create phone E.164 계약 CONFORMANCE 정정 (raw p_phone → normalize_phone(p_phone)=v_phone 일관 적용).
 *
 * RC: self_checkin_create(20260714120000)가 raw p_phone 을 조회 WHERE + customers/check_ins INSERT 에 직접 사용
 *   → cross_crm_data_contract §Phone(GLOBAL JOIN KEY = phone E.164, UNIQUE(clinic_id, phone), normalize_phone) 위반.
 *   형제 RPC upsert_reservation_from_source(20260715120000)는 이미 normalize_phone 적용 = house pattern. 셀프접수만 이탈.
 * DA CONSULT-REPLY(MSG-20260721-030943-9hj0 / DA-20260721-FOOT-SELFCHECKIN-NORMALIZE):
 *   판정 GO · ADDITIVE-equivalent YES(no DDL, normalize_phone 재사용, 되돌림 가능) ·
 *   필수조건: 조회 WHERE 와 INSERT 에 동일 v_phone 일관 적용(하나만 정규화 시 조회 miss → 중복 customers row) ·
 *   masked-PII guard + length(digits)>=9 는 raw p_phone 에 pre-normalize 로 유지.
 *
 * 본건 = SECURITY DEFINER RPC 본문 마이그(CREATE OR REPLACE, 스키마 무변경). behavioral surface = 저장 phone E.164 정합.
 * 결정론 소스-단언(마이그/롤백 구조 + v_phone 도출·일관성 + 가드 raw 보존 + ADDITIVE).
 *
 * AC1 — v_phone := public.normalize_phone(p_phone) 를 가드 통과 후 도출(선언 + 대입 존재).
 * AC2 — 일관성: customers 조회 WHERE phone = v_phone · customers INSERT · check_ins INSERT 모두 v_phone 사용.
 *        (find/create 페어 정규화 불일치 → 중복 row 방지.)
 * AC3 — 가드 보존: masked-PII _fn_is_masked_pii(p_name, p_phone) + length(digits)>=9 는 raw p_phone 기준 유지.
 * AC4 — ADDITIVE: 단일 tx · 스키마 DDL 0 · 롤백은 raw p_phone 정의로 가역.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MIG = 'supabase/migrations/20260721100000_foot_selfcheckin_create_phone_e164_conformance.sql';
const ROLLBACK = 'supabase/migrations/20260721100000_foot_selfcheckin_create_phone_e164_conformance.rollback.sql';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf-8');
// 주석 제거 후 SQL 본문만 (라인 주석 -- 제거).
const code = (p: string) => read(p).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

test.describe('T-20260721-SELFCHECKIN-PHONE-NORMALIZE — 아티팩트·tx 구조', () => {
  test('마이그·롤백 아티팩트 존재', () => {
    expect(fs.existsSync(path.resolve(MIG))).toBe(true);
    expect(fs.existsSync(path.resolve(ROLLBACK))).toBe(true);
  });

  test('마이그·롤백 단일 tx (BEGIN..COMMIT 정확히 1쌍)', () => {
    for (const f of [MIG, ROLLBACK]) {
      const sql = read(f);
      expect((sql.match(/^BEGIN;/gm) ?? []).length).toBe(1);
      expect((sql.match(/^COMMIT;/gm) ?? []).length).toBe(1);
    }
  });

  test('AC4 — ADDITIVE: 스키마 DDL 0 (컬럼/테이블/enum 무변경)', () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+TYPE\b/i);
    expect(sql).not.toMatch(/\bADD\s+COLUMN\b/i);
    // 함수 재정의만 (CREATE OR REPLACE FUNCTION self_checkin_create 정확히 1회).
    expect((sql.match(/CREATE OR REPLACE FUNCTION public\.self_checkin_create/g) ?? []).length).toBe(1);
  });
});

test.describe('T-20260721-SELFCHECKIN-PHONE-NORMALIZE — 정규화 도출·일관성', () => {
  const sql = code(MIG);

  test('AC1 — v_phone 선언 + normalize_phone(p_phone) 대입', () => {
    expect(sql).toMatch(/v_phone\s+text\s*;/i);
    expect(sql).toMatch(/v_phone\s*:=\s*public\.normalize_phone\(\s*p_phone\s*\)/i);
  });

  test('AC1 — 정규화는 가드(masked-PII / length) 통과 후 도출 (pre-normalize 순서 보존)', () => {
    const idxMask = sql.search(/_fn_is_masked_pii/);
    const idxLen = sql.search(/length\(regexp_replace\(p_phone/);
    const idxNorm = sql.search(/v_phone\s*:=\s*public\.normalize_phone/);
    expect(idxMask).toBeGreaterThan(-1);
    expect(idxLen).toBeGreaterThan(-1);
    expect(idxNorm).toBeGreaterThan(-1);
    // normalize 는 masked-PII 가드·length 가드 이후.
    expect(idxNorm).toBeGreaterThan(idxMask);
    expect(idxNorm).toBeGreaterThan(idxLen);
  });

  test('AC2 — customers 조회 WHERE 는 v_phone 사용 (raw p_phone 조회키 잔존 0)', () => {
    expect(sql).toMatch(/WHERE\s+clinic_id\s*=\s*v_clinic_id\s+AND\s+phone\s*=\s*v_phone/i);
    expect(sql).not.toMatch(/phone\s*=\s*p_phone/i);
  });

  test('AC2 — customers/check_ins INSERT 는 v_phone 저장 (raw p_phone 저장 잔존 0)', () => {
    // customers INSERT VALUES 에 v_phone, check_ins INSERT VALUES 에 v_phone.
    expect(sql).toMatch(/VALUES\s*\(\s*v_clinic_id\s*,\s*trim\(p_name\)\s*,\s*v_phone\s*,/i);
    expect(sql).toMatch(/v_clinic_id\s*,\s*v_customer_id\s*,\s*trim\(p_name\)\s*,\s*v_phone\s*,/i);
    // 저장 경로에 raw p_phone 이 값으로 남지 않음(trim(p_name) 뒤 p_phone 패턴 부재).
    expect(sql).not.toMatch(/trim\(p_name\)\s*,\s*p_phone\s*,/i);
  });

  test('AC3 — 가드는 raw p_phone 기준 유지 (masked-PII 양축 + length digits>=9)', () => {
    expect(sql).toMatch(/_fn_is_masked_pii\(\s*p_name\s*,\s*p_phone\s*\)/i);
    expect(sql).toMatch(/length\(regexp_replace\(p_phone,\s*'\[\^0-9\]',\s*'',\s*'g'\)\)\s*<\s*9/i);
  });
});

test.describe('T-20260721-SELFCHECKIN-PHONE-NORMALIZE — 롤백 가역', () => {
  const sql = code(ROLLBACK);

  test('롤백은 raw p_phone 정의로 원복 (v_phone 부재 + p_phone 조회/저장)', () => {
    expect(sql).not.toMatch(/v_phone\s*:=\s*public\.normalize_phone/i);
    expect(sql).toMatch(/AND\s+phone\s*=\s*p_phone/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.self_checkin_create/);
  });
});
