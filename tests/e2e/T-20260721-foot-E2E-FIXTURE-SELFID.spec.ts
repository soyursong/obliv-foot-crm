/**
 * T-20260721-foot-E2E-FIXTURE-SELFID (P2) — 야간 E2E 픽스처 자기식별 (재발 근절)
 *
 * 부모 TEST-DUMMY-CLEANUP AC-2 C2 fail-closed 의 **구조적 근본원인** 가드.
 * RC: 야간 Daily Build E2E 픽스처가 실 chart_no(F-####)·실포맷 phone·is_simulation=false 로
 *     생성돼 test-data 로 자기식별하지 않음 → cleanup 이 결정적 술어 없이 현장확인 강제 +
 *     실 chart 시퀀스 소모.
 *
 * page/auth 불필요 — service_role 로 DB 직접 검증(SIM-HARNESS-TEARDOWN-HYGIENE 동형).
 *
 * 검증:
 *  AC-1: seedCheckIn 생성행이 단일 술어 is_simulation=true 만으로 비실환자 확증 +
 *        phone DUMMY-% + phone_dummy=true(트리거 파생).
 *  AC-2 (a): chart_number 가 QA-FIX-* (test 네임스페이스, non-F) → 실 F-#### 발번 시퀀스 무소모
 *        (시딩 전후 MAX(F-####) 불변).
 *  AC-3: is_simulation + chart 지문 결정적 스윕 — memo/이름을 덮어써도 cleanupAll 이 전수 삭제.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { cleanupAll, seedCheckIn, CLINIC_ID, TEST_CHART_PREFIX } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = !!(SUPA_URL && SERVICE_KEY);
const sb = dbReady ? createClient(SUPA_URL!, SERVICE_KEY!) : null;

/** 현재 clinic 의 실 발번 MAX(F-#### 숫자부). 없으면 0. */
async function maxFootChartNo(): Promise<number> {
  const { data } = await sb!
    .from('customers')
    .select('chart_number')
    .like('chart_number', 'F-%')
    .order('chart_number', { ascending: false })
    .limit(1000);
  let mx = 0;
  for (const r of (data ?? []) as { chart_number: string | null }[]) {
    const m = /^F-(\d+)$/.exec(r.chart_number ?? '');
    if (m) mx = Math.max(mx, Number(m[1]));
  }
  return mx;
}

test.describe('T-20260721-foot-E2E-FIXTURE-SELFID — 픽스처 자기식별', () => {
  test.skip(!dbReady, 'Supabase service_role env 미설정 → DB 검증 스킵');

  test.afterAll(async () => {
    if (dbReady) await cleanupAll();
  });

  test('AC-1: 생성행이 is_simulation=true + phone DUMMY-% + phone_dummy=true', async () => {
    const h = await seedCheckIn({ visit_type: 'new' });
    try {
      const { data } = await sb!
        .from('customers')
        .select('is_simulation, phone, phone_dummy')
        .eq('id', h.customerId)
        .single();
      const c = data as { is_simulation: boolean; phone: string; phone_dummy: boolean } | null;
      // 단일 술어 불변식: is_simulation=true 만으로 100% 비실환자 확증
      expect(c?.is_simulation, 'is_simulation=true(단일 비실환자 술어)').toBe(true);
      expect(c?.phone, 'phone DUMMY-% 접두').toMatch(/^DUMMY-/);
      expect(c?.phone_dummy, 'phone_dummy=true(DUMMY-% → 트리거 자동 파생)').toBe(true);
      // 반환 handle 도 DUMMY-%
      expect(h.phone).toMatch(/^DUMMY-/);
    } finally {
      await h.cleanup();
    }
  });

  test('AC-2 (a): chart_number 가 QA-FIX-*(non-F) → 실 F-#### 시퀀스 무소모', async () => {
    const before = await maxFootChartNo();
    const h1 = await seedCheckIn({ visit_type: 'new' });
    const h2 = await seedCheckIn({ visit_type: 'returning' });
    try {
      const { data } = await sb!
        .from('customers')
        .select('chart_number')
        .in('id', [h1.customerId, h2.customerId]);
      for (const r of (data ?? []) as { chart_number: string | null }[]) {
        expect(r.chart_number, 'test 네임스페이스 chart').toContain(TEST_CHART_PREFIX);
        expect(r.chart_number, '실 F-#### 발번 아님').not.toMatch(/^F-\d+$/);
      }
      // 핵심: 픽스처 2건을 심어도 실 F-#### MAX 는 그대로 (시퀀스 소모 0)
      const after = await maxFootChartNo();
      expect(after, '실 F-#### 시퀀스 무소모(발번 트리거 우회)').toBe(before);
    } finally {
      await h1.cleanup();
      await h2.cleanup();
    }
  });

  test('AC-3: is_simulation+chart 지문 결정적 스윕 — memo/이름 덮어써도 cleanupAll 전수 삭제', async () => {
    const h = await seedCheckIn({ visit_type: 'new' });
    // 마커/이름접두 스윕 무력화 모사: memo(scoped 마커) 제거 + 이름을 non-fixture 로 덮어씀
    await sb!.from('customers').update({ memo: null, name: '홍길동_실환자모사' }).eq('id', h.customerId);
    await sb!.from('check_ins').update({ notes: null, customer_name: '홍길동_실환자모사' }).eq('id', h.id);

    await cleanupAll();

    const { data: cAfter } = await sb!.from('customers').select('id').eq('id', h.customerId);
    const { data: ckAfter } = await sb!.from('check_ins').select('id').eq('id', h.id);
    expect(cAfter?.length ?? 0, 'is_simulation+QA-FIX 지문으로 회수(현장확인 불요)').toBe(0);
    expect(ckAfter?.length ?? 0, '종속 check_in 도 전수 삭제').toBe(0);
  });

  test('AC-3(안전): 실환자(is_simulation=false)·QA-FIX 아닌 sim(legacy) 은 미삭제', async () => {
    // 명시 chart(non-F, non-QA-FIX) → 실 F-#### 시퀀스 무소모 + 발번 트리거 우회.
    const suffix = `${Date.now()}`.slice(-6);
    const phone = `+8210${suffix}00`; // 유효 E.164 (13자, 가입자 8자리)
    // ① 실환자 모사: is_simulation=false
    const { data: real } = await sb!
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `실환자가드_${suffix}`, phone, chart_number: `GUARD-REAL-${suffix}`, is_simulation: false })
      .select('id')
      .single();
    // ② legacy sim 모사: is_simulation=true 이지만 QA-FIX 아닌 chart (토마토·617 bulk 더미 계열)
    const { data: legacy } = await sb!
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: `legacy_sim_${suffix}`, phone: `+8210${suffix}11`, chart_number: `LEGACY-${suffix}`, is_simulation: true })
      .select('id')
      .single();
    const realId = (real as { id: string } | null)?.id;
    const legacyId = (legacy as { id: string } | null)?.id;
    try {
      await cleanupAll();
      const { data: realLeft } = await sb!.from('customers').select('id').eq('id', realId!);
      const { data: legacyLeft } = await sb!.from('customers').select('id').eq('id', legacyId!);
      expect(realLeft?.length ?? 0, '실환자(is_simulation=false)는 스윕 대상 아님').toBe(1);
      expect(legacyLeft?.length ?? 0, 'QA-FIX 아닌 sim(legacy·토마토 계열)은 chart 지문 불일치로 미삭제').toBe(1);
    } finally {
      if (realId) await sb!.from('customers').delete().eq('id', realId);
      if (legacyId) await sb!.from('customers').delete().eq('id', legacyId);
    }
  });
});
