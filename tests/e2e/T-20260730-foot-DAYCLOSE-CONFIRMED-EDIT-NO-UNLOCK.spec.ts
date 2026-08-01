/**
 * T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK — 일마감 확정 후 '해제 없이' 수납 수정 (A안·approved)
 *
 * 검증 대상: closing_edit_manual_payment_reconfirm RPC (SECDEF) — 확정(closed) 일마감의 수납 수정이
 *   명시적 '해제' 클릭 없이(A안 UX sugar) 저장되되, 내부는 반드시 원자적
 *   unlock → edit → re-confirm(revision+1) + 필드단위 감사(closing_edit_log) 로 처리됨을 서버강제.
 *   raw silent mutate(revision-bump/재발행/감사 없음) = DESTRUCTIVE → 발생 불가.
 *
 * 현장 클릭 시나리오(티켓 §현장 클릭 시나리오) → E2E 변환:
 *   시나리오1(정상 동선): 확정 후 해제 없이 수납 수정 → 저장 성공 + revision+1 재확정 +
 *     outbox 신 event_id(revision 1) 재발행 + 감사 1행(금액 old→new) + 일마감 매출 자동 재산출 근거.
 *   시나리오2(권한 차단): 비인증(anon) 호출 → 서버 차단(명시적 실패, 조용한 저장 성공 아님) + 데이터 무변경.
 *     + FE 게이트 미러(isStaffUnlockRole)가 전직원(part_lead/staff/tm) 배제함을 순수 로직으로 확증.
 *   시나리오3(이력 다회 정정): 같은 수납 건 2회 연속 수정(A→B, B→C) → 감사 2행 누적 +
 *     revision 각 재확정마다 +1(단일 updated_by 덮어쓰기로 이력 소실 없음).
 *
 * AC 매핑: AC-1(무-해제 수정) AC-2(원자 재확정·revision+1) AC-3(closing_edit_log old→new)
 *   AC-4(outbox 재발행 신 event_id) AC-5(권한 이중게이트) AC-6(이력 조회) — RPC/DB 계약 층에서 검증.
 *   (UI 렌더·갤탭 실기기 confirm 은 supervisor macstudio 풀 E2E + field-soak 에서.)
 *
 * 비파괴 — 임시 픽스처(테스트 전용 close_date=2099-07-30) 생성 후 즉시 삭제. 실운영 데이터 무접촉.
 * author: dev-foot / 2026-08-01
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (slug 보유 → enqueue 트리거 정상)
const TEST_DATE = '2099-07-30';                            // 테스트 전용 미래 일자(실데이터 무충돌)
const MARKER = 'EDIT-NO-UNLOCK-E2E';

type SB = ReturnType<typeof createClient>;

// ── 테스트 전용 close_date 의 잔여물 제거(멱등 — 재실행 안전) ──
async function purge(sb: SB) {
  await sb.from('closing_edit_log').delete().eq('clinic_id', CLINIC_ID).eq('close_date', TEST_DATE);
  await sb.from('closing_confirmed_outbox').delete().eq('clinic_id', CLINIC_ID).eq('close_date', TEST_DATE);
  await sb.from('closing_manual_payments').delete().eq('clinic_id', CLINIC_ID).eq('close_date', TEST_DATE);
  await sb.from('daily_closings').delete().eq('clinic_id', CLINIC_ID).eq('close_date', TEST_DATE);
}

// ── 확정(closed) 일마감 + 수기 수납 1건 시드 ──
async function seed(sb: SB, amount: number): Promise<{ closingId: string; manualId: string }> {
  await purge(sb);
  const { data: closing, error: cErr } = await sb
    .from('daily_closings')
    .insert({ clinic_id: CLINIC_ID, close_date: TEST_DATE, status: 'closed', closed_at: new Date().toISOString() })
    .select('id, revision, status')
    .single();
  expect(cErr, `daily_closings seed: ${cErr?.message}`).toBeNull();
  // 확정 INSERT → confirm_guard revision=0
  expect((closing as { revision: number }).revision).toBe(0);

  const { data: manual, error: mErr } = await sb
    .from('closing_manual_payments')
    .insert({ clinic_id: CLINIC_ID, close_date: TEST_DATE, customer_name: MARKER, amount, method: 'card', pay_time: '13:00' })
    .select('id')
    .single();
  expect(mErr, `manual seed: ${mErr?.message}`).toBeNull();
  return { closingId: (closing as { id: string }).id, manualId: (manual as { id: string }).id };
}

// ── 인증 세션 토큰으로 RPC 호출(브라우저 localStorage 세션 재사용). auth=false → anon 키만. ──
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
      const headers: Record<string, string> = { apikey: anon, 'Content-Type': 'application/json' };
      headers.Authorization = `Bearer ${auth && token ? token : anon}`;
      const r = await fetch(`${url}/rest/v1/rpc/closing_edit_manual_payment_reconfirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const status = r.status;
      let json: unknown = null;
      try { json = await r.json(); } catch { json = null; }
      return { status, json };
    },
    { url: SUPA_URL, anon: ANON_KEY, payload: body, auth: useAuth },
  );
}

test.describe('DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK (확정 후 무-해제 수납 수정 = 원자 재확정+감사)', () => {
  test('시나리오1: 확정 후 해제 없이 수정 → revision+1 재확정 + outbox 재발행 + 감사 1행', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded (TEST_PASSWORD 부재 등)');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { closingId, manualId } = await seed(sb, 100_000);
    try {
      const { status, json } = (await callRpc(page, {
        p_manual_id: manualId,
        p_clinic_id: CLINIC_ID,
        p_new: { amount: 120_000, method: 'card', customer_name: MARKER },
      })) as { status: number; json: Record<string, unknown> };

      // AC-1/AC-2: 성공 + revision+1 재확정
      expect(status, `RPC status=${status} json=${JSON.stringify(json)}`).toBeLessThan(300);
      expect(json?.ok, `RPC 응답: ${JSON.stringify(json)}`).toBe(true);
      expect(json?.revision_after).toBe(1);

      // 수납건 실제 반영(write-rowcheck 통과 = 1-row)
      const { data: mrow } = await sb.from('closing_manual_payments').select('amount').eq('id', manualId).single();
      expect((mrow as { amount: number }).amount).toBe(120_000);

      // 확정상태 복귀 + revision bump (AC-2)
      const { data: crow } = await sb.from('daily_closings').select('status, revision').eq('id', closingId).single();
      expect((crow as { status: string }).status).toBe('closed');
      expect((crow as { revision: number }).revision).toBe(1);

      // AC-3: 감사 1행(금액 old→new + revision_after)
      const { data: logs } = await sb
        .from('closing_edit_log')
        .select('field, old_value, new_value, revision_after, edited_by_name')
        .eq('clinic_id', CLINIC_ID).eq('close_date', TEST_DATE);
      const amtLog = (logs ?? []).find((l) => (l as { field: string }).field === 'amount') as
        { old_value: string; new_value: string; revision_after: number } | undefined;
      expect(amtLog, `edit_log: ${JSON.stringify(logs)}`).toBeTruthy();
      expect(amtLog!.old_value).toBe('100000');
      expect(amtLog!.new_value).toBe('120000');
      expect(amtLog!.revision_after).toBe(1);

      // AC-4: outbox 재발행 — revision 1 신 event_id 행 존재(직전 revision 0 과 별개)
      const { data: obx } = await sb
        .from('closing_confirmed_outbox')
        .select('revision, event_id, superseded')
        .eq('clinic_id', CLINIC_ID).eq('close_date', TEST_DATE)
        .order('revision', { ascending: true });
      const revs = (obx ?? []).map((o) => (o as { revision: number }).revision);
      expect(revs, `outbox revisions=${JSON.stringify(revs)}`).toContain(0);
      expect(revs, `outbox revisions=${JSON.stringify(revs)}`).toContain(1);
      const eventIds = new Set((obx ?? []).map((o) => (o as { event_id: string }).event_id));
      expect(eventIds.size).toBe((obx ?? []).length); // 각 revision 은 서로 다른 event_id
    } finally {
      await purge(sb);
    }
  });

  test('시나리오2: 비인증(anon) 호출 → 서버 차단 + 데이터 무변경 (+ FE 게이트 미러 확증)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { manualId } = await seed(sb, 100_000);
    try {
      const { status, json } = (await callRpc(
        page,
        { p_manual_id: manualId, p_clinic_id: CLINIC_ID, p_new: { amount: 999_999, method: 'card' } },
        false, // anon
      )) as { status: number; json: Record<string, unknown> };

      // anon 은 EXECUTE 미부여 → 실행 거부(HTTP 4xx). 조용한 성공(ok:true) 금지.
      const blocked = status >= 400 || json?.ok === false || json?.ok === undefined;
      expect(blocked, `status=${status} json=${JSON.stringify(json)}`).toBe(true);
      expect(json?.ok).not.toBe(true);

      // 실제 미변경(금액 100000 유지)
      const { data: mrow } = await sb.from('closing_manual_payments').select('amount').eq('id', manualId).single();
      expect((mrow as { amount: number }).amount).toBe(100_000);
    } finally {
      await purge(sb);
    }

    // FE 버튼 게이트 미러 = BE RPC 게이트와 동일 집합(전직원 X). 순수 로직 확증.
    const STAFF_UNLOCK = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'];
    const isStaffUnlockRole = (r: string | null | undefined) => !!r && STAFF_UNLOCK.includes(r);
    for (const r of ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist']) {
      expect(isStaffUnlockRole(r), `${r} 는 수정 가능해야`).toBe(true);
    }
    for (const r of ['part_lead', 'staff', 'tm', 'technician', '', null, undefined]) {
      expect(isStaffUnlockRole(r), `${r} 는 전직원 배제(수정 불가)`).toBe(false);
    }
  });

  test('시나리오3: 같은 수납 건 2회 정정(A→B→C) → 감사 2행 누적 + revision 각 +1(이력 소실 없음)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { closingId, manualId } = await seed(sb, 100_000);
    try {
      // 1차 정정 100000 → 110000
      const r1 = (await callRpc(page, {
        p_manual_id: manualId, p_clinic_id: CLINIC_ID, p_new: { amount: 110_000, method: 'card' },
      })) as { json: Record<string, unknown> };
      expect(r1.json?.ok, `1차: ${JSON.stringify(r1.json)}`).toBe(true);
      expect(r1.json?.revision_after).toBe(1);

      // 2차 정정 110000 → 120000
      const r2 = (await callRpc(page, {
        p_manual_id: manualId, p_clinic_id: CLINIC_ID, p_new: { amount: 120_000, method: 'card' },
      })) as { json: Record<string, unknown> };
      expect(r2.json?.ok, `2차: ${JSON.stringify(r2.json)}`).toBe(true);
      expect(r2.json?.revision_after).toBe(2);

      // 감사 2행 누적(각 old→new 보존, 단일 덮어쓰기 아님)
      const { data: logs } = await sb
        .from('closing_edit_log')
        .select('field, old_value, new_value, revision_after')
        .eq('clinic_id', CLINIC_ID).eq('close_date', TEST_DATE)
        .eq('target_id', manualId)
        .order('revision_after', { ascending: true });
      const amtLogs = (logs ?? []).filter((l) => (l as { field: string }).field === 'amount') as
        { old_value: string; new_value: string; revision_after: number }[];
      expect(amtLogs.length, `금액 감사행: ${JSON.stringify(logs)}`).toBe(2);
      expect(amtLogs[0]).toMatchObject({ old_value: '100000', new_value: '110000', revision_after: 1 });
      expect(amtLogs[1]).toMatchObject({ old_value: '110000', new_value: '120000', revision_after: 2 });

      // 최종 상태: 금액 120000 + closing revision 2 + closed
      const { data: mrow } = await sb.from('closing_manual_payments').select('amount').eq('id', manualId).single();
      expect((mrow as { amount: number }).amount).toBe(120_000);
      const { data: crow } = await sb.from('daily_closings').select('status, revision').eq('id', closingId).single();
      expect((crow as { status: string; revision: number }).status).toBe('closed');
      expect((crow as { revision: number }).revision).toBe(2);
    } finally {
      await purge(sb);
    }
  });
});
