/**
 * T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN — cross-run 격리 불변식 가드 (P2)
 *
 * 배경(QA#2, MSG-20260721-011238-r36w): 본 티켓의 AC-3(≥10회 rerun 교대성 RED 미재현)은
 *   CI rerun 로그로만 증빙 가능해 "insufficient_verification" NO-GO 를 받았다. 그러나 flaky 의
 *   근인은 **cross-run cleanupAll() 전수 스윕이 동시 실행 중인 다른 run 의 in-flight 시드를 삭제**
 *   하는 데이터 레이스다. 이 스펙은 그 격리 불변식을 **결정론적으로(DB 직접, run 무관)** 검증해
 *   교대성 RED 의 구조적 부재를 CI rerun 없이 증명한다(unit 프로젝트, auth/server 불요).
 *
 * 검증(격리 스킴 = run-scoped 마커 `[QA-FIXTURE]|<token>|<tsMs>`):
 *  AC-2a cleanupAll() 은 **다른 run** 의 scoped 시드(customer, name=qa-fixture-*)를 삭제하지 않는다.
 *  AC-2b cleanupAll() 은 **다른 run** 의 scoped 예약(reservation, name=qa-res-*)을 삭제하지 않는다.
 *  AC-4a cleanupAll() 은 여전히 bare 마커 orphan(qa-fixture-*, memo=[QA-FIXTURE])을 스윕한다(회귀 부재).
 *  AC-4b cleanupAll() 은 여전히 memo=NULL 이름접두 orphan 을 스윕한다(마커 누락 방어 회귀 부재).
 *  AC-3a sweepScoped('run') 은 **이 run 토큰** 의 scoped 시드를 회수한다.
 *  AC-3b sweepScoped('stale') 은 TTL(2h) 초과 scoped leak 만 회수하고, fresh(동시 run) 시드는 보존한다.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { cleanupAll, sweepScoped, runToken, MARKER, CLINIC_ID } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbReady = !!(SUPA_URL && SERVICE_KEY);
const sb = dbReady ? createClient(SUPA_URL!, SERVICE_KEY!) : null;

// 이 run 과 절대 겹치지 않는 "다른 CI run" 토큰(동시 실행 시뮬레이션).
const OTHER_TOKEN = 'otherrun-99999999-1-crossgate';
const scoped = (token: string, tsMs: number) => `${MARKER}|${token}|${tsMs}`;
const uniqPhone = (salt: number) => `+8210${String(Date.now() + salt).slice(-8)}`;

async function insertCustomer(name: string, memo: string | null, salt: number): Promise<string> {
  const { data, error } = await sb!
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone: uniqPhone(salt), visit_type: 'new', memo })
    .select('id')
    .single();
  expect(error, `customer insert(${name})`).toBeNull();
  return data!.id as string;
}
async function customerExists(id: string): Promise<boolean> {
  const { data } = await sb!.from('customers').select('id').eq('id', id);
  return (data?.length ?? 0) > 0;
}
async function hardDelete(table: string, id: string) {
  await sb!.from(table).delete().eq('id', id);
}

test.describe('CHART-OPENGATE-SEED-ISOLATION-HARDEN — cross-run 격리 불변식', () => {
  test.skip(!dbReady, 'Supabase service_role env 미설정 → DB 검증 스킵');

  test.afterAll(async () => {
    if (dbReady) await cleanupAll();
  });

  test('AC-2a: cleanupAll 은 다른 run 의 scoped customer(qa-fixture-*) 를 삭제하지 않는다', async () => {
    const id = await insertCustomer(`qa-fixture-cross-${Date.now()}`, scoped(OTHER_TOKEN, Date.now()), 1);
    try {
      await cleanupAll();
      expect(await customerExists(id), '동시 run 의 in-flight scoped 시드는 cross-run 스윕에서 보존').toBe(true);
    } finally {
      await hardDelete('customers', id);
    }
  });

  test('AC-2b: cleanupAll 은 다른 run 의 scoped reservation(qa-res-*) 을 삭제하지 않는다', async () => {
    const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const { data, error } = await sb!
      .from('reservations')
      .insert({
        clinic_id: CLINIC_ID,
        customer_name: `qa-res-cross-${Date.now()}`,
        reservation_date: date,
        reservation_time: '14:00',
        visit_type: 'new',
        status: 'confirmed',
        memo: scoped(OTHER_TOKEN, Date.now()),
      })
      .select('id')
      .single();
    expect(error, 'reservation insert').toBeNull();
    const id = data!.id as string;
    try {
      await cleanupAll();
      const { data: after } = await sb!.from('reservations').select('id').eq('id', id);
      expect(after?.length ?? 0, '동시 run 의 scoped 예약은 cross-run 스윕에서 보존').toBe(1);
    } finally {
      await hardDelete('reservations', id);
    }
  });

  test('AC-4a: cleanupAll 은 bare 마커 orphan(qa-fixture-*, memo=MARKER) 을 여전히 스윕한다', async () => {
    const id = await insertCustomer(`qa-fixture-bare-${Date.now()}`, MARKER, 2);
    await cleanupAll();
    expect(await customerExists(id), 'bare orphan 은 스윕(회귀 부재)').toBe(false);
  });

  test('AC-4b: cleanupAll 은 memo=NULL 이름접두 orphan 을 여전히 스윕한다', async () => {
    const id = await insertCustomer(`qa-fixture-null-${Date.now()}`, null, 3);
    await cleanupAll();
    expect(await customerExists(id), 'memo=NULL 이름접두 orphan 은 스윕(마커누락 방어 회귀 부재)').toBe(false);
  });

  test('AC-3a: sweepScoped(run) 은 이 run 토큰의 scoped 시드를 회수한다', async () => {
    // 이름접두 없음(gate-*) → cleanupAll 이름스윕 무관, sweepScoped 가 memo 토큰으로만 회수함을 격리 검증.
    const id = await insertCustomer(`gate-own-${Date.now()}`, scoped(runToken(), Date.now()), 4);
    try {
      await sweepScoped({ mode: 'run' });
      expect(await customerExists(id), 'own-run scoped 시드는 teardown sweepScoped(run) 이 회수').toBe(false);
    } finally {
      if (await customerExists(id)) await hardDelete('customers', id);
    }
  });

  test('AC-3b: sweepScoped(stale) 은 TTL 초과 leak 만 회수하고 fresh 동시-run 시드는 보존한다', async () => {
    const THREE_H = 3 * 60 * 60 * 1000;
    const staleId = await insertCustomer(`gate-stale-${Date.now()}`, scoped(OTHER_TOKEN, Date.now() - THREE_H), 5);
    const freshId = await insertCustomer(`gate-fresh-${Date.now()}`, scoped(OTHER_TOKEN, Date.now()), 6);
    try {
      await sweepScoped({ mode: 'stale' });
      expect(await customerExists(staleId), 'TTL(2h) 초과 leak scoped 는 stale 스윕이 회수').toBe(false);
      expect(await customerExists(freshId), 'fresh(동시 run) scoped 는 stale 스윕이 보존(레이스 차단)').toBe(true);
    } finally {
      if (await customerExists(staleId)) await hardDelete('customers', staleId);
      await hardDelete('customers', freshId);
    }
  });
});
