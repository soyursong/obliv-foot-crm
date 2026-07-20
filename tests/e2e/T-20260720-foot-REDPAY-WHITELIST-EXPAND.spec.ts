/**
 * Regression spec — T-20260720-foot-REDPAY-TID-288003-005-WHITELIST-EXPAND
 *
 * 목적: 풋 RedPay 단말 화이트리스트 17→26 ADDITIVE 확장이 모든 소비처에 drift 없이 반영됐는지 소스검증.
 *   SSOT = redpay_foot_terminal_registry.md §2 26-set (FOOT-CONFIRMED, DA MSG-20260720-162717-xzkq).
 *   신규 9종 = VAN5(285003/005/006/007/008) + 유선4(288003/005/006/008).
 *
 * 계약(I1~I4):
 *  I1. seed 마이그(20260720170000)가 신규 9 merchant:tid 를 domain='foot' ADDITIVE 로 편입(멱등).
 *  I2. 폴러 DEFAULT const(FOOT_MERCHANT/TID_WHITELIST_DEFAULT) = 26-set.
 *  I3. EF center 분류 FOOT_MERCHANT_SET = 26-set.
 *  I4. rollback 이 신규 9 merchant 만 DELETE(17 복원).
 *
 * ⚠ DB 소비뷰/함수는 이미 registry 서브쿼리 파생(T-20260711) → seed 만으로 26 자동 반영(하드코딩 재유입 없음).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';

const SEED = 'supabase/migrations/20260720170000_redpay_foot_registry_expand_26.sql';
const SEED_ROLLBACK = 'supabase/migrations/20260720170000_redpay_foot_registry_expand_26.rollback.sql';
const POLLER = 'scripts/redpay_macstudio_poller.mjs';
const EF = 'supabase/functions/redpay-reconcile/index.ts';

// 신규 9종 (merchant → tid)
const NEW9: Array<[string, string]> = [
  ['1777285003', '1047479254'],
  ['1777285005', '1047479268'],
  ['1777285006', '1047479262'],
  ['1777285007', '1047479263'],
  ['1777285008', '1047479264'],
  ['1777288003', '1047479471'],
  ['1777288005', '1047479473'],
  ['1777288006', '1047479474'],
  ['1777288008', '1047479475'],
];

// 26-set merchant 전량 (기존 17 + 신규 9)
const MERCHANT_26 = [
  '1777285001', '1777285003', '1777285004', '1777285005', '1777285006', '1777285007', '1777285008',
  '1777288001', '1777288003', '1777288004', '1777288005', '1777288006', '1777288008',
  '1777289001', '1777289002', '1777289003', '1777289004', '1777289005', '1777289006', '1777289007', '1777289008',
  '1777289009', '1777289010', '1777289011', '1777289012', '1777289013',
];

// ─── I1: seed 마이그 신규 9종 ADDITIVE 편입 ──────────────────────────────────
test.describe('T-20260720 whitelist-expand — I1 seed 마이그(ADDITIVE 9)', () => {
  const src = fs.readFileSync(SEED, 'utf-8');
  test('신규 9 merchant:tid 전량 seed + domain foot + 멱등', () => {
    for (const [mid, tid] of NEW9) {
      expect(src).toContain(`'${mid}'`);
      expect(src).toContain(`'${tid}'`);
    }
    expect(src).toContain("'foot'");
    expect(src).toContain('ON CONFLICT (merchant_id) DO NOTHING');
    // 링크키 slug 정본 (business_no 드리프트 회피)
    expect(src).toContain("slug = 'jongno-foot'");
    // 원장 기록
    expect(src).toContain("VALUES ('20260720170000', 'redpay_foot_registry_expand_26')");
  });
  test('스키마 무변경 — CREATE TABLE/ALTER/DROP DDL 없음(데이터 seed only)', () => {
    // SQL 본문(주석 제거) 기준으로 DDL 키워드 부재 검증 (주석 내 'silent-drop' 등 오탐 방지)
    const body = src.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(body).not.toMatch(/CREATE\s+TABLE/i);
    expect(body).not.toMatch(/ALTER\s+TABLE/i);
    expect(body).not.toMatch(/DROP\s+(TABLE|VIEW|FUNCTION|COLUMN|INDEX|POLICY|CONSTRAINT)/i);
  });
});

// ─── I2: 폴러 DEFAULT const = 26-set ─────────────────────────────────────────
test.describe('T-20260720 whitelist-expand — I2 폴러 fail-safe DEFAULT 26', () => {
  const src = fs.readFileSync(POLLER, 'utf-8');
  test('FOOT_MERCHANT_WHITELIST_DEFAULT = 26 merchant 전량', () => {
    for (const mid of MERCHANT_26) expect(src).toContain(`"${mid}"`);
  });
  test('FOOT_TID_WHITELIST_DEFAULT = 신규 4 유선 TID + 신규 5 VAN TID 포함', () => {
    for (const [, tid] of NEW9) expect(src).toContain(`"${tid}"`);
  });
});

// ─── I3: EF center 분류 FOOT_MERCHANT_SET = 26-set ───────────────────────────
test.describe('T-20260720 whitelist-expand — I3 EF center 분류 26', () => {
  const src = fs.readFileSync(EF, 'utf-8');
  test('FOOT_MERCHANT_SET 이 26 merchant 전량 포함(신규 9종 center=foot 정확분류)', () => {
    for (const mid of MERCHANT_26) expect(src).toContain(`"${mid}"`);
  });
});

// ─── I4: rollback 이 신규 9 만 DELETE ────────────────────────────────────────
test.describe('T-20260720 whitelist-expand — I4 rollback 17 복원', () => {
  const src = fs.readFileSync(SEED_ROLLBACK, 'utf-8');
  test('rollback 이 신규 9 merchant DELETE + 원장 제거', () => {
    expect(src).toMatch(/DELETE\s+FROM\s+public\.redpay_terminal_registry/i);
    for (const [mid] of NEW9) expect(src).toContain(`'${mid}'`);
    // 기존 17 은 건드리지 않음(신규 9 만 명시)
    expect(src).not.toContain("'1777285001'");
    expect(src).toContain("version = '20260720170000'");
  });
});
