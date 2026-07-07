/**
 * T-20260629-dopamine-FOOTCAL-DIRECT-WRITE — foot lane GREEN 회귀 가드
 *
 * DEV-DIRECT 경로(supervisor infra_blocked → dev-foot prod 적용권) 2건의 결과를 잠근다:
 *   1) 마이그 190000+193000 (upsert_reservation_from_source 17-arg superset + lifecycle guard#5)
 *      = prod 실재(020000 memo-timeline superset 로 이미 착지). Migration Ledger Reconciliation:
 *        forward apply target=NONE (재적용=clobber). 본 spec = 파일 체인 무결성 static 가드.
 *   2) 도파민→풋 ingest EF gateway(verify_jwt=false) — reopen RC(401 'Missing authorization header'
 *      + 502) 해소. live no-write 가드(secret 불요): EF-code 401 JSON 이면 게이트웨이 open 증명.
 *
 * ⚠ 실 write(applied:true) positive 검증은 dopamine-side FOOT_CALLBACK_SECRET 필요 →
 *   본 lane 에서는 RPC 직접 service-role write 로 별도 실증(scripts/..._e2e_rpc_write.mjs, GREEN).
 *   여기선 회귀 가드(파일 체인 + gateway open)만 CI-safe 하게 고정.
 *
 * 스펙: foot_cal_write_enable_da_decision_20260629.md / cross_crm_data_contract §4-1,§5
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIG_DIR = path.resolve(__dirname, '../../supabase/migrations');
const EF_URL =
  'https://rxlomoozakkjesdqjtvd.supabase.co/functions/v1/reservation-ingest-from-dopamine';

test.describe('FOOTCAL-DIRECT-WRITE — foot lane GREEN 가드', () => {
  test('AC1: 마이그 190000 = upsert RPC 17-arg superset (external_id TEXT + customer_real_name)', () => {
    const src = fs.readFileSync(
      path.join(MIG_DIR, '20260630190000_foot_tm_edit_cancel_superset_rpc.sql'), 'utf8');
    expect(src).toContain('CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source');
    expect(src).toContain('p_is_companion');            // 17번째 인자
    expect(src).toContain('p_customer_real_name');
    expect(src).toMatch(/external_id\s+TYPE\s+text/i);  // UUID→TEXT widening
    // rollback 동봉 (mig_rollback evidence)
    expect(fs.existsSync(
      path.join(MIG_DIR, '20260630190000_foot_tm_edit_cancel_superset_rpc.rollback.sql'))).toBe(true);
  });

  test('AC2: 마이그 193000 = lifecycle guard#5 (in-flight/terminal stale edit·cancel reject)', () => {
    const src = fs.readFileSync(
      path.join(MIG_DIR, '20260630193000_foot_tm_edit_cancel_lifecycle_guard.sql'), 'utf8');
    expect(src).toContain('lifecycle-invalid cancel');
    expect(src).toContain('lifecycle-invalid edit');
    expect(src).toContain('LIFECYCLE_INVALID');
    expect(src).toMatch(/c_inflight_terminal.*ARRAY\['checked_in','done','no_show'\]/s);
    expect(fs.existsSync(
      path.join(MIG_DIR, '20260630193000_foot_tm_edit_cancel_lifecycle_guard.rollback.sql'))).toBe(true);
  });

  test('AC3(reopen RC 가드): 도파민 인입 EF — secret 없는 POST → EF-code 401 JSON (게이트웨이 401 아님·502 아님)', async ({ request }) => {
    const resp = await request.post(EF_URL, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        source_system: 'dopamine', external_id: 'ci-gate-probe', clinic_slug: 'jongno-foot',
        customer: { phone_e164: '+821000000000', name: 'ci-probe' },
        reservation: { scheduled_at: '2026-07-08T10:00:00+09:00' },
      },
    });
    // verify_jwt=false → 요청이 EF 코드까지 도달 → EF 코드가 JSON 401 반환.
    // (verify_jwt=true 였다면 게이트웨이가 plaintext 'Missing authorization header' 401 로 선거부.)
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body).toMatchObject({ ok: false, error: 'UNAUTHORIZED' });
  });
});
