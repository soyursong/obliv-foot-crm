/**
 * T-20260725-foot-INSURANCE-GRADE-SECDEF-RPC — 보험 자격등급 SECDEF RPC 수렴 (PERMISSION-PARITY STEP5)
 *
 * 검증 대상: update_insurance_grade RPC (INV-3 서버강제 = 권한·입력 allowlist·clinic 격리·0-row 방어).
 *
 * 시나리오1 (정상): 승인 운영직원 세션 → 등급 변경 저장 → ok:true + customers 반영 확인.
 * 시나리오2 (권한): anon(비인증) 호출 → 서버 차단(명시적 실패, 조용한 저장 성공 아님).
 * 시나리오3 (0-row 방어): 존재하지 않는 customer id → ok:false + '고객을 찾지 못했습니다'(silent 성공 금지).
 * 시나리오4 (입력 allowlist): 허용되지 않은 등급 문자열 → ok:false(governed-enum 강제).
 *
 * 인증: storageState(승인 사용자). RPC 는 is_approved_user()+운영role 게이트 → 인증 세션 토큰으로 호출.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = 'INSGRADE-SECDEF-E2E';

type Seeded = { customerId: string };

async function seedCustomer(
  sb: ReturnType<typeof createClient>,
  grade: string,
): Promise<Seeded> {
  const phone = `DUMMY-${grade}-${Date.now()}`;
  const { data: c } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name: `${MARKER}-${grade}`, phone, visit_type: 'new', insurance_grade: grade })
    .select()
    .single();
  return { customerId: (c as { id: string }).id };
}

async function cleanup(sb: ReturnType<typeof createClient>, s: Seeded) {
  await sb.from('customers').delete().eq('id', s.customerId);
}

// 인증 세션 토큰으로 RPC 호출 (브라우저 컨텍스트 localStorage 세션 재사용)
async function callRpc(
  page: import('@playwright/test').Page,
  body: Record<string, unknown>,
  useAuth = true,
) {
  return page.evaluate(
    async ({ url, anon, payload, auth }) => {
      let token: string | null = null;
      if (auth) {
        const key = Object.keys(localStorage).find((k) => k.includes('-auth-token'));
        const sess = key ? JSON.parse(localStorage.getItem(key) || '{}') : {};
        token = sess?.access_token ?? sess?.currentSession?.access_token ?? null;
      }
      const headers: Record<string, string> = {
        apikey: anon,
        'Content-Type': 'application/json',
      };
      // 인증 호출은 세션 토큰, 비인증(anon) 시나리오는 anon 키만.
      headers.Authorization = `Bearer ${auth && token ? token : anon}`;
      const r = await fetch(`${url}/rest/v1/rpc/update_insurance_grade`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const status = r.status;
      let json: unknown = null;
      try {
        json = await r.json();
      } catch {
        json = null;
      }
      return { status, json };
    },
    { url: SUPA_URL, anon: ANON_KEY, payload: body, auth: useAuth },
  );
}

test.describe('INSURANCE-GRADE-SECDEF-RPC (고위험 write 서버강제)', () => {
  test('시나리오1: 승인 직원 → 등급 변경 성공(ok:true) + customers 반영', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded (TEST_PASSWORD 부재 등)');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const s = await seedCustomer(sb, 'unverified');
    try {
      const { json } = (await callRpc(page, {
        p_customer_id: s.customerId,
        p_grade: 'medical_aid_2',
        p_source: 'manual_input',
        p_memo: 'e2e-test',
      })) as { json: Record<string, unknown> };
      expect(json?.ok, `RPC 응답: ${JSON.stringify(json)}`).toBe(true);
      expect(json?.grade).toBe('medical_aid_2');
      // DB 반영 확인
      const { data: row } = await sb
        .from('customers')
        .select('insurance_grade, insurance_grade_source, insurance_grade_memo')
        .eq('id', s.customerId)
        .single();
      expect((row as Record<string, unknown>)?.insurance_grade).toBe('medical_aid_2');
      expect((row as Record<string, unknown>)?.insurance_grade_source).toBe('manual_input');
    } finally {
      await cleanup(sb, s);
    }
  });

  test('시나리오2: anon(비인증) 호출 → 서버 차단(명시적 실패, 조용한 성공 아님)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const s = await seedCustomer(sb, 'unverified');
    try {
      const { status, json } = (await callRpc(
        page,
        { p_customer_id: s.customerId, p_grade: 'general', p_source: 'manual_input', p_memo: null },
        false, // anon
      )) as { status: number; json: Record<string, unknown> };
      // anon 은 EXECUTE 미부여 → 함수 실행 거부(HTTP 4xx) 또는 is_approved_user()=false → ok:false.
      // 어느 쪽이든 '성공'이 아니어야 한다(silent write 금지).
      const blocked = status >= 400 || json?.ok === false;
      expect(blocked, `status=${status} json=${JSON.stringify(json)}`).toBe(true);
      // 저장이 실제로 일어나지 않았는지 확인(등급 unverified 유지)
      const { data: row } = await sb
        .from('customers')
        .select('insurance_grade')
        .eq('id', s.customerId)
        .single();
      expect((row as Record<string, unknown>)?.insurance_grade).toBe('unverified');
    } finally {
      await cleanup(sb, s);
    }
  });

  test('시나리오3: 존재하지 않는 customer id → 0-row 방어(ok:false, silent 성공 금지)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    const { json } = (await callRpc(page, {
      p_customer_id: '00000000-0000-0000-0000-000000000000',
      p_grade: 'general',
      p_source: 'manual_input',
      p_memo: null,
    })) as { json: Record<string, unknown> };
    expect(json?.ok, `RPC 응답: ${JSON.stringify(json)}`).toBe(false);
    expect(String(json?.error ?? '')).toContain('찾지 못');
  });

  test('시나리오4: 허용되지 않은 등급 문자열 → allowlist 차단(ok:false)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const s = await seedCustomer(sb, 'unverified');
    try {
      const { json } = (await callRpc(page, {
        p_customer_id: s.customerId,
        p_grade: 'platinum_vip', // 비허용
        p_source: 'manual_input',
        p_memo: null,
      })) as { json: Record<string, unknown> };
      expect(json?.ok, `RPC 응답: ${JSON.stringify(json)}`).toBe(false);
      expect(String(json?.error ?? '')).toContain('허용되지 않은');
    } finally {
      await cleanup(sb, s);
    }
  });
});
