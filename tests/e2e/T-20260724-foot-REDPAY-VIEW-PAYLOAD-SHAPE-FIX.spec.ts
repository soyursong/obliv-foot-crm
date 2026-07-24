/**
 * Regression spec — T-20260724-foot-REDPAY-VIEW-PAYLOAD-SHAPE-FIX
 * 레드페이 뷰/함수 payload-shape 이중대응(COALESCE fallback).
 *
 * e2e_spec_exempt_reason: db_only (CRM UI 무변경) — 아래는 정적 소스 불변식 회귀 가드.
 *   데이터층 검증 주체 = MIG-GATE dryrun(scripts/..._dryrun.mjs): 컬럼 시그니처 byte-동일 +
 *   무영속 + 회귀(dropped=0) + dedup(0) + 효능(웹훅shape 5행 표면화). 본 스펙은 배선이
 *   원복(정규화 shape 전용 회귀)되지 않도록 파일-레벨 불변식을 고정한다.
 *
 * 불변식(DA CONSULT-REPLY SSOT=da_decision_foot_redpay_view_payload_shape_coalesce_20260724.md verdict 3/3):
 *  I1. shape 읽는 소비처 4곳 모두 merchant/tid COALESCE fold (view A/B·freshness fn·receipt view·alarm view).
 *  I2. observe-guard 미포함 (뷰에 _mode 필터/isObserveRow 부재 — read-surfacing 축 ≠ payments-WRITE 축).
 *  I3. CREATE OR REPLACE (DROP+CREATE 금지) — 컬럼 시그니처 byte-동일 계약(ADDITIVE).
 *  I4. rollback 은 COALESCE 제거(정규화 shape 전용) 정의로 복원.
 *  I5. census + dryrun 아티팩트 존재(MIG-GATE 근거).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const MIG = 'supabase/migrations/20260724190000_redpay_view_payload_shape_coalesce.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260724190000_redpay_view_payload_shape_coalesce.rollback.sql';
const CENSUS = 'scripts/T-20260724-foot-REDPAY-VIEW-PAYLOAD-SHAPE-FIX_census.mjs';
const DRYRUN = 'scripts/T-20260724-foot-REDPAY-VIEW-PAYLOAD-SHAPE-FIX_dryrun.mjs';

const M_COALESCE = "COALESCE(r.raw_payload->'merchant'->>'id', r.raw_payload->'data'->>'merchant_id')";
// SQL 주석(-- ...) 제거본 — 부정(재유입 금지) 단정은 DDL 본문만 대상(헤더 주석은 변경사유 문서화).
const stripComments = (s: string) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

// ─── I1: shape 이중대응 COALESCE 4곳 fold ─────────────────────────────────────
test.describe('T-20260724 shape-fix — I1 COALESCE fallback fold', () => {
  const src = fs.readFileSync(MIG, 'utf-8');
  const ddl = stripComments(src);

  test('4 소비처 모두 CREATE OR REPLACE', () => {
    expect(src).toContain('CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily');
    expect(src).toContain('CREATE OR REPLACE FUNCTION public.get_redpay_feed_freshness()');
    expect(src).toContain('CREATE OR REPLACE VIEW public.v_receipt_settlement_daily');
    expect(src).toContain('CREATE OR REPLACE VIEW public.v_redpay_unclassified_merchants');
  });

  test('merchant = COALESCE(merchant.id, data.merchant_id) — 웹훅 중첩 envelope fallback', () => {
    // recon 뷰 Part A + Part B(r2) + freshness + receipt(r2/rp) + alarm 전반
    expect(src).toContain(M_COALESCE);
    expect(src).toContain("r2.raw_payload->'merchant'->>'id', r2.raw_payload->'data'->>'merchant_id'");
    expect(src).toContain("rp.raw_payload->'merchant'->>'id', rp.raw_payload->'data'->>'merchant_id'");
    // 구 경로 단독(fallback 없는 merchant IN) 재유입 금지 — 모든 merchant 읽기는 COALESCE 경유
    expect(ddl).not.toContain("WHERE (r.raw_payload->'merchant'->>'id') IN (");
  });

  test('tid = COALESCE(r.tid, data.tid) — 컬럼·필터 양쪽', () => {
    expect(src).toContain("COALESCE(r.tid, r.raw_payload->'data'->>'tid')");
    expect(src).toContain("COALESCE(r2.tid, r2.raw_payload->'data'->>'tid')");
    expect(src).toContain("COALESCE(rp.tid, rp.raw_payload->'data'->>'tid')");
    // 구 tid 컬럼 단독 출력(`r.tid  AS tid`) 재유입 금지 — DDL 본문만(헤더 주석 제외)
    expect(ddl).not.toMatch(/\br\.tid\s+AS tid\b/);
  });

  test('alarm 뷰 merchant_name 도 shape COALESCE (silent drop 방지)', () => {
    expect(src).toContain("r.raw_payload->'merchant'->>'name', r.raw_payload->'data'->>'merchant_name'");
  });

  test('COALESCE 후에도 registry IN 통과 필요 — cause(a)≠cause(b) 직교 유지', () => {
    expect(src).toContain("FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active");
  });
});

// ─── I2: observe-guard 미포함 (DA verdict (b) REJECT) ─────────────────────────
test.describe('T-20260724 shape-fix — I2 observe-guard 미포함', () => {
  // 헤더 주석은 guard 미포함 사유(observe/_mode)를 문서화하므로 DDL 본문만 검사 → SQL 주석(-- ...) 제거.
  const ddl = fs.readFileSync(MIG, 'utf-8').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  test('DDL 본문에 _mode observe 필터/isObserveRow 부재 (read-surfacing ≠ payments-WRITE)', () => {
    expect(ddl).not.toContain('_mode');
    expect(ddl).not.toContain('isObserveRow');
    expect(ddl).not.toContain('observe');
    // GROUP BY / HAVING 로 dedup guard 를 view Part A 에 끼워넣지 않음(UNIQUE제약+단일스캔이 강제).
    // (alarm 뷰의 GROUP BY 1,2,3,4 는 집계용 — HAVING count 중복제거 guard 아님.)
    expect(ddl).not.toMatch(/HAVING\s+count/i);
  });
});

// ─── I3: CREATE OR REPLACE (컬럼 시그니처 byte-동일 계약) ─────────────────────
test.describe('T-20260724 shape-fix — I3 ADDITIVE 시그니처 불변', () => {
  const src = fs.readFileSync(MIG, 'utf-8');

  test('DROP VIEW/FUNCTION 없음 (재정의만 — 시그니처 파괴 금지)', () => {
    expect(src).not.toMatch(/DROP\s+VIEW/i);
    expect(src).not.toMatch(/DROP\s+FUNCTION/i);
    // 신규 컬럼/테이블/enum 0 (ADDITIVE read-broadening)
    expect(src).not.toMatch(/ALTER\s+TABLE/i);
    expect(src).not.toMatch(/ADD\s+COLUMN/i);
    expect(src).not.toMatch(/CREATE\s+TABLE/i);
    expect(src).not.toMatch(/CREATE\s+TYPE/i);
  });

  test('schema_migrations 원장 기입 (멱등)', () => {
    expect(src).toContain("VALUES ('20260724190000', 'redpay_view_payload_shape_coalesce')");
    expect(src).toContain('ON CONFLICT (version) DO NOTHING');
  });
});

// ─── I4: rollback 은 COALESCE 제거 복원 ───────────────────────────────────────
test.describe('T-20260724 shape-fix — I4 rollback', () => {
  const rb = fs.readFileSync(MIG_ROLLBACK, 'utf-8');

  test('rollback 4 소비처 CREATE OR REPLACE 로 정규화 shape 전용 복원', () => {
    expect(rb).toContain('CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily');
    expect(rb).toContain('CREATE OR REPLACE FUNCTION public.get_redpay_feed_freshness()');
    expect(rb).toContain('CREATE OR REPLACE VIEW public.v_receipt_settlement_daily');
    expect(rb).toContain('CREATE OR REPLACE VIEW public.v_redpay_unclassified_merchants');
    // COALESCE data.merchant_id/data.tid fallback 제거됨
    expect(rb).not.toContain("data'->>'merchant_id'");
    expect(rb).not.toContain("data'->>'tid'");
    // 정규화 shape 단독 읽기 복원
    expect(rb).toContain("WHERE (r.raw_payload->'merchant'->>'id') IN (");
    expect(rb).toMatch(/\br\.tid\s+AS tid\b/);
  });
});

// ─── I5: MIG-GATE 아티팩트 (census + dryrun) ──────────────────────────────────
test.describe('T-20260724 shape-fix — I5 MIG-GATE 아티팩트', () => {
  test('census 스크립트 존재 (_mode 분포 실측 = guard REJECT 근거)', () => {
    const c = fs.readFileSync(CENSUS, 'utf-8');
    expect(c).toContain('_mode');
    expect(c).toContain('newly_surfaced');
  });

  test('dryrun 스크립트 존재 (시그니처 byte-동일 + 무영속 + 회귀 + 효능)', () => {
    const d = fs.readFileSync(DRYRUN, 'utf-8');
    expect(d).toContain('컬럼 시그니처 byte-동일');
    expect(d).toContain('ROLLBACK');
    expect(d).toContain('dropped');
    expect(d).toContain('webhook_5_surfaced');
  });
});
