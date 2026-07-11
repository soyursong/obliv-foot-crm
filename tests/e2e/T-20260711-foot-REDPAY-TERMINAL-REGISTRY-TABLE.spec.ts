/**
 * Regression spec — T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE
 * 레드페이 단말 화이트리스트 SSOT 테이블화 (drift 봉인).
 *
 * e2e_spec_exempt_reason: db_only (CRM UI 무변경) — 아래는 정적 소스 불변식 회귀 가드.
 *   MIG-GATE(dryrun 17-set 동일결과 대조)가 데이터층 검증 주체. 본 스펙은 배선 전환이
 *   원복(하드코딩 재유입)되지 않도록 파일-레벨 불변식을 고정한다.
 *
 * 불변식:
 *  I1. 마이그가 redpay_terminal_registry 테이블 + 17-set seed 를 신설(ADDITIVE).
 *  I2. 소비뷰/함수(recon/settlement/freshness)는 하드코딩 IN(17) 대신 registry 서브쿼리 파생.
 *  I3. 폴러는 DB registry 를 SSOT 로 조회(resolveWhitelists), 하드코딩은 fail-safe 폴백.
 *  I4. "미분류 merchant" 알람(뷰 + 폴러 로그) 존재.
 *  I5. 롤백/드라이런 아티팩트 존재.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const MIG = 'supabase/migrations/20260711140000_redpay_terminal_registry_ssot.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260711140000_redpay_terminal_registry_ssot.rollback.sql';
const MIG_DRYRUN = 'supabase/migrations/20260711140000_redpay_terminal_registry_ssot.dryrun.sql';
const POLLER = 'scripts/redpay_macstudio_poller.mjs';

const FOOT_MERCHANTS = [
  '1777285001','1777285004','1777288001','1777288004','1777289001',
  '1777289002','1777289003','1777289004','1777289005','1777289006',
  '1777289007','1777289008','1777289009','1777289010','1777289011',
  '1777289012','1777289013',
];

// ─── I1: 테이블 + 17-set seed 신설 ────────────────────────────────────────────
test.describe('T-20260711 registry — I1 테이블·seed 신설(ADDITIVE)', () => {
  const src = fs.readFileSync(MIG, 'utf-8');

  test('redpay_terminal_registry 테이블을 8컬럼(DA 확정)으로 신설', () => {
    expect(src).toContain('CREATE TABLE IF NOT EXISTS public.redpay_terminal_registry');
    for (const col of ['clinic_id', 'domain', 'merchant_id', 'tid', 'terminal_label', 'active', 'source', 'verified_at']) {
      expect(src).toContain(col);
    }
    // merchant 전역 유일 → 멱등 seed
    expect(src).toContain('UNIQUE (merchant_id)');
    // RLS read-all(security_invoker 뷰 소비)
    expect(src).toContain('ENABLE ROW LEVEL SECURITY');
    expect(src).toContain('GRANT SELECT ON public.redpay_terminal_registry TO authenticated');
  });

  test('풋 17-set 전량 seed + 멱등 ON CONFLICT', () => {
    for (const mid of FOOT_MERCHANTS) expect(src).toContain(`'${mid}'`);
    expect(src).toContain('ON CONFLICT (merchant_id) DO NOTHING');
    expect(src).toContain("'foot'");
  });
});

// ─── I2: 소비뷰/함수는 registry 파생(하드코딩 IN(17) 제거) ─────────────────────
test.describe('T-20260711 registry — I2 소비처 테이블 파생 전환', () => {
  const src = fs.readFileSync(MIG, 'utf-8');

  test('recon/settlement 뷰 + freshness 함수 CREATE OR REPLACE', () => {
    expect(src).toContain('CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily');
    expect(src).toContain('CREATE OR REPLACE VIEW public.v_receipt_settlement_daily');
    expect(src).toContain('CREATE OR REPLACE FUNCTION public.get_redpay_feed_freshness()');
  });

  test('화이트리스트는 registry 서브쿼리 파생 — 하드코딩 merchant IN-list 재유입 금지', () => {
    // registry 파생 서브쿼리 사용
    expect(src).toContain("FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active");
    // 하드코딩 17-merchant 연속 IN 블록이 본문(up)에 남아있지 않아야 함(파생으로 대체됨)
    const hardcodedBlock = "'1777285001','1777285004','1777288001','1777288004','1777289001'";
    expect(src).not.toContain(hardcodedBlock);
  });
});

// ─── I3: 폴러 DB SSOT 조회 + fail-safe 폴백 ───────────────────────────────────
test.describe('T-20260711 registry — I3 폴러 DB 파생', () => {
  const src = fs.readFileSync(POLLER, 'utf-8');

  test('registry 테이블 조회 함수 + resolveWhitelists 존재', () => {
    expect(src).toContain('async function loadRegistryFromDb()');
    expect(src).toContain('redpay_terminal_registry?domain=eq.foot&active=eq.true');
    expect(src).toContain('async function resolveWhitelists()');
    expect(src).toContain('await resolveWhitelists()');
  });

  test('하드코딩 DEFAULT 는 fail-safe 폴백으로 유지(정전/네트워크 생존)', () => {
    expect(src).toContain('FOOT_MERCHANT_WHITELIST_DEFAULT');
    expect(src).toContain('FOOT_TID_WHITELIST_DEFAULT');
  });
});

// ─── I4: "미분류 merchant" 알람 ───────────────────────────────────────────────
test.describe('T-20260711 registry — I4 미분류 merchant 알람', () => {
  test('DB 영속 알람 뷰 v_redpay_unclassified_merchants', () => {
    const src = fs.readFileSync(MIG, 'utf-8');
    expect(src).toContain('CREATE OR REPLACE VIEW public.v_redpay_unclassified_merchants');
    expect(src).toContain('NOT IN (');
    expect(src).toContain('SELECT merchant_id FROM public.redpay_terminal_registry WHERE active');
  });

  test('폴러 ingest-time 알람 로그(silent-drop 금지)', () => {
    const src = fs.readFileSync(POLLER, 'utf-8');
    expect(src).toContain('[UNCLASSIFIED-MERCHANT]');
  });
});

// ─── I5: 롤백/드라이런 아티팩트 (MIG-GATE) ────────────────────────────────────
test.describe('T-20260711 registry — I5 MIG-GATE 아티팩트', () => {
  test('rollback 은 뷰/함수 하드코딩 복원 + DROP TABLE', () => {
    const rb = fs.readFileSync(MIG_ROLLBACK, 'utf-8');
    expect(rb).toContain('DROP TABLE IF EXISTS public.redpay_terminal_registry');
    expect(rb).toContain('DROP VIEW IF EXISTS public.v_redpay_unclassified_merchants');
    // 뷰/함수를 하드코딩 정의로 복원
    expect(rb).toContain('CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily');
    expect(rb).toContain("'1777285001','1777285004'");
  });

  test('dryrun 은 17-set 동일결과(대칭차 0) 대조를 포함', () => {
    const dr = fs.readFileSync(MIG_DRYRUN, 'utf-8');
    expect(dr).toContain('merchant_symdiff');
    expect(dr).toContain('tid_symdiff');
    expect(dr).toContain('ROLLBACK;');
  });
});
