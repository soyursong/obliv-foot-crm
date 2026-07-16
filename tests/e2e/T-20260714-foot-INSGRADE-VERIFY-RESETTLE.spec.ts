/**
 * T-20260714-foot-INSGRADE-VERIFY-RESETTLE — 건보 등급 확정 재정산 (SSOT §2-2-5)
 *
 * 검증 대상: resettle_insurance_grade RPC (calc_copayment authority·병렬경로 금지·
 *   ★data_incomplete BLOCK·불변식 환불액≤기징수액≤실수납액). p_dry_run=true 미리보기.
 *
 * 시나리오1 (capped 환자 → refund): grade=null 30% 잠정징수 → 의료급여2종(15%) 확정 →
 *   확정 본인부담 < 기징수 30% → refund > 0.
 * 시나리오2 (general → 차액 0, 회귀 없음): general(30%) 확정 → 30%=확정 rate → 재정산 0.
 *
 * 인증: storageState(승인 사용자). RPC 는 is_approved_user()+current_user_clinic_id() 게이트라
 *   반드시 인증 세션 토큰으로 호출한다(service-role 로 호출 시 권한거부 — 게이트 정상).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const COVERED_SERVICE_ID = 'b98f6831-12a3-459b-b199-f543dd15cba1'; // 진찰료(초진) hira_score 153.36
const MARKER = 'RESETTLE-E2E';

type Seeded = { customerId: string; checkInId: string };

async function seedCoveredVisit(
  sb: ReturnType<typeof createClient>,
  grade: string,
  provisionalCopay: number,
): Promise<Seeded> {
  const phone = `0109999${Math.floor(1000 + (grade.length * 137) % 8999)}`;
  const { data: c } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name: `${MARKER}-${grade}`, phone, visit_type: 'new', insurance_grade: grade })
    .select().single();
  const customerId = (c as { id: string }).id;

  const { data: ci } = await sb
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID, customer_id: customerId, customer_name: `${MARKER}-${grade}`,
      customer_phone: phone, visit_type: 'new', status: 'payment_waiting', queue_number: 990,
    })
    .select().single();
  const checkInId = (ci as { id: string }).id;

  // 잠정 명세(급여) — customer_grade_at_charge = 잠정('unverified' 스냅샷; base 는 확정과 무관하게 수가)
  await sb.from('service_charges').insert({
    clinic_id: CLINIC_ID, check_in_id: checkInId, customer_id: customerId, service_id: COVERED_SERVICE_ID,
    is_insurance_covered: true, hira_score: 153.36, base_amount: 14661,
    insurance_covered_amount: 0, copayment_amount: provisionalCopay, exempt_amount: 0,
    customer_grade_at_charge: 'unverified', copayment_rate_at_charge: 0.30,
  });
  // 잠정 수납(30%) — resettle_reason NULL (원 결제)
  await sb.from('payments').insert({
    check_in_id: checkInId, clinic_id: CLINIC_ID, customer_id: customerId,
    amount: provisionalCopay, method: 'cash', payment_type: 'payment', tax_type: '급여',
  });
  return { customerId, checkInId };
}

async function cleanup(sb: ReturnType<typeof createClient>, s: Seeded) {
  await sb.from('payments').delete().eq('check_in_id', s.checkInId);
  await sb.from('service_charges').delete().eq('check_in_id', s.checkInId);
  await sb.from('check_ins').delete().eq('id', s.checkInId);
  await sb.from('customers').delete().eq('id', s.customerId);
}

// 인증 세션 토큰으로 RPC dry-run 호출 (브라우저 컨텍스트 localStorage 세션 재사용)
async function callResettleDryRun(page: import('@playwright/test').Page, checkInId: string) {
  return page.evaluate(
    async ({ url, anon, ci }) => {
      const key = Object.keys(localStorage).find((k) => k.includes('-auth-token'));
      if (!key) return { ok: false, error: 'no-session' };
      const sess = JSON.parse(localStorage.getItem(key) || '{}');
      const token = sess?.access_token ?? sess?.currentSession?.access_token;
      if (!token) return { ok: false, error: 'no-token' };
      const r = await fetch(`${url}/rest/v1/rpc/resettle_insurance_grade`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_check_in_id: ci, p_confirmed_grade: null, p_dry_run: true, p_method: 'cash' }),
      });
      return r.json();
    },
    { url: SUPA_URL, anon: ANON_KEY, ci: checkInId },
  );
}

test.describe('INSGRADE-VERIFY-RESETTLE (재정산 dry-run)', () => {
  test('시나리오1: 의료급여2종 확정 → 과청구 환수(refund > 0) + 불변식 환불액≤기징수액', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded (TEST_PASSWORD 부재 등)');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const provisional = 4400; // general 30% 잠정징수 (round100(14661×0.30))
    const s = await seedCoveredVisit(sb, 'medical_aid_2', provisional);
    try {
      const res = (await callResettleDryRun(page, s.checkInId)) as Record<string, unknown>;
      expect(res.ok, `RPC 응답: ${JSON.stringify(res)}`).toBe(true);
      expect(res.blocked).toBeFalsy();
      expect(res.confirmed_grade).toBe('medical_aid_2');
      // 15% 확정 < 30% 잠정 → refund
      expect(Number(res.refund)).toBeGreaterThan(0);
      expect(Number(res.additional)).toBe(0);
      // ★불변식: 환불액 ≤ 기징수액 AND ≤ 실수납액
      expect(Number(res.refund)).toBeLessThanOrEqual(Number(res.provisional_copay));
      expect(Number(res.refund)).toBeLessThanOrEqual(Number(res.paid_total));
    } finally {
      await cleanup(sb, s);
    }
  });

  test('시나리오2: general 확정 → 차액 0 (재정산 불필요, 회귀 없음)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const provisional = 4400;
    const s = await seedCoveredVisit(sb, 'general', provisional);
    try {
      const res = (await callResettleDryRun(page, s.checkInId)) as Record<string, unknown>;
      expect(res.ok, `RPC 응답: ${JSON.stringify(res)}`).toBe(true);
      expect(res.blocked).toBeFalsy();
      expect(res.confirmed_grade).toBe('general');
      // 30% 확정 = 30% 잠정 → 차액 0
      expect(Number(res.refund)).toBe(0);
      expect(Number(res.additional)).toBe(0);
    } finally {
      await cleanup(sb, s);
    }
  });
});
