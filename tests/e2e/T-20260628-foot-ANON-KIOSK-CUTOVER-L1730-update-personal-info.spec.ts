/**
 * E2E (정적 가드) spec — T-20260628-foot-ANON-KIOSK-CUTOVER L1730 disposition (DA-ow58)
 *   SSOT: da_decision_foot_kiosk_L1730_customers_revoke_routing_20260719.md
 *
 * L1730(검증예약 기존고객 contact/consent) 을 v3(name+phone 재해소)가 아니라 check_in_id-keyed
 * update-only RPC fn_selfcheckin_update_personal_info 로 라우팅한다. 그를 위해 update_personal_info
 * 를 ADDITIVE 확장(+p_sms_opt_in, +p_customer_email — consent 3파라미터는 20260629120000 旣존).
 *
 * 검증:
 *   G1: 마이그가 15-arg 시그니처(신규 p_sms_opt_in BOOLEAN / p_customer_email TEXT DEFAULT NULL)를 정의.
 *   G2: ADDITIVE only — customers 컬럼 ADD/DROP COLUMN 없음(기존 컬럼 재사용).
 *   G3: sms_opt_in/customer_email persist 규약이 v3 규약을 미러(COALESCE + sms_opt_in_at CASE + NULLIF btrim).
 *   G4: GRANT EXECUTE 15-arg → anon, authenticated.
 *   G5: check_in_id-keyed update-only(§25 INV-0) — customer_id NULL 시 no_customer_id, INSERT INTO customers 없음.
 *   G6: 롤백이 15-arg DROP → 13-arg 복원, DROP COLUMN 없음.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = 'supabase/migrations/20260719160000_selfcheckin_update_personal_info_contact_additive.sql';
const RB  = 'supabase/migrations/20260719160000_selfcheckin_update_personal_info_contact_additive.rollback.sql';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

test.describe('T-20260628 L1730 — update_personal_info ADDITIVE (+sms_opt_in/+customer_email)', () => {
  test('G1~G5: 마이그 15-arg ADDITIVE + INV-0 update-only + GRANT', () => {
    const sql = read(MIG);

    // G1: 15-arg 시그니처 — 신규 2파라미터 DEFAULT NULL
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_selfcheckin_update_personal_info/);
    expect(sql).toMatch(/p_sms_opt_in\s+BOOLEAN\s+DEFAULT NULL/);
    expect(sql).toMatch(/p_customer_email\s+TEXT\s+DEFAULT NULL/);
    // consent 3파라미터 재사용(旣존)
    expect(sql).toMatch(/p_consent_sensitive\s+BOOLEAN/);
    expect(sql).toMatch(/p_consent_agreed_at\s+TIMESTAMPTZ/);
    expect(sql).toMatch(/p_consent_version\s+TEXT/);
    // 반환형 불변
    expect(sql).toMatch(/RETURNS JSONB/);

    // G2: ADDITIVE only — customers 컬럼 ADD/DROP 없음
    expect(sql, 'ADD COLUMN 잔존(ADDITIVE 위반)').not.toMatch(/ADD COLUMN/i);
    expect(sql, 'DROP COLUMN 잔존(ADDITIVE 위반)').not.toMatch(/DROP COLUMN/i);

    // G3: v3 규약 미러 — persist 시맨틱
    expect(sql).toMatch(/sms_opt_in\s*=\s*COALESCE\(p_sms_opt_in, sms_opt_in\)/);
    expect(sql).toMatch(/WHEN p_sms_opt_in IS TRUE\s+THEN now\(\)/);
    expect(sql).toMatch(/WHEN p_sms_opt_in IS FALSE THEN NULL/);
    expect(sql).toMatch(/customer_email\s*=\s*COALESCE\(NULLIF\(btrim\(p_customer_email\), ''\), customer_email\)/);
    // consent no-downgrade 보존
    expect(sql).toMatch(/consent_sensitive\s*=\s*CASE\s+WHEN p_consent_sensitive = true THEN true/);

    // G4: GRANT 15-arg → anon, authenticated
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_selfcheckin_update_personal_info\([\s\S]*BOOLEAN, TEXT\s*\)\s*TO anon, authenticated/,
    );

    // G5: check_in_id-keyed update-only(§25 INV-0) — customer_id NULL 가드 + 신규 INSERT 없음
    expect(sql).toMatch(/no_customer_id/);
    expect(sql).toMatch(/UPDATE customers/);
    expect(sql, 'INSERT INTO customers 잔존(§25 INV-0 위반 — update-only 아님)').not.toMatch(/INSERT INTO customers/i);
    // check_in_id-bearer(§16-5): 30분 가드 + clinic 이중검증
    expect(sql).toMatch(/INTERVAL '30 minutes'/);
    expect(sql).toMatch(/clinic_id = p_clinic_id/);
  });

  test('G6: 롤백 — 15-arg DROP → 13-arg 복원, DROP COLUMN 없음', () => {
    const rb = read(RB);
    // 15-arg DROP
    expect(rb).toMatch(
      /DROP FUNCTION IF EXISTS public\.fn_selfcheckin_update_personal_info\([\s\S]*BOOLEAN, TEXT\s*\)/,
    );
    // 13-arg 복원(신규 2파라미터 미포함) — 복원 함수 정의부(CREATE 이후)로 스코프.
    const createIdx = rb.indexOf('CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info');
    expect(createIdx, '롤백에 CREATE 미발견').toBeGreaterThan(-1);
    const restored = rb.slice(createIdx);
    expect(restored, '복원 정의부에 신규 p_sms_opt_in 잔존(13-arg 복원 아님)').not.toMatch(/p_sms_opt_in/);
    expect(restored, '복원 정의부에 신규 p_customer_email 잔존').not.toMatch(/p_customer_email/);
    // 데이터/컬럼 무변경
    expect(rb, '롤백 DROP COLUMN(공유 컬럼 파괴)').not.toMatch(/DROP COLUMN/i);
  });
});
