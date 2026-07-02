/**
 * E2E (service_role DB 불변식) — T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT (P0-3)
 * parent: T-20260703-ops-JONGNO-OPEN-READINESS-GATE / SSOT: audit_jongno_open_readiness_20260703.md #3
 *
 * 종로 오픈 게이트 — 풋 패키지 현금 손실 3중 결함의 '금액/회차 정합' 불변식을 RPC 직접 호출로 검증한다.
 * page/auth 불필요 → `unit` 프로젝트. RPC 미배포 환경에선 실패(=supervisor DDL apply 후 PASS 확인).
 *
 * (a) 양도 이중환불: transfer_package_atomic 후 원본 status='transferred' → refund_package_atomic 거부(환불 1회만).
 * (b) 양도 잔여 리셋: 수령 패키지 잔여 회차 = 원본 '잔여'(전체 아님) + 금액 = 단가×잔여(과환불 없음).
 * (c) 선수금 미차감: consume_package_sessions_for_checkin 로 package_sessions 실차감 + 멱등(재호출 0건) + 초과차감 방지.
 *
 * 불변식(금액 정합 회귀):
 *   원본잔여가치 == 수령total_amount == 수령환불견적  (환불·매출·잔여 3경로 합계 불변)
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[QA-FIXTURE]';

const dbReady = !!(SUPA_URL && SERVICE_KEY);
const sb: SupabaseClient | null = dbReady ? createClient(SUPA_URL!, SERVICE_KEY!) : null;

// 생성 자원 추적(RPC가 만든 수령 패키지·세션 포함 전수 청소)
const created = { customers: [] as string[], packages: [] as string[], checkIns: [] as string[] };

async function mkCustomer(name: string): Promise<string> {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = `010${String(ts).slice(-8)}`;
  const { data, error } = await sb!.from('customers')
    .insert({ clinic_id: CLINIC_ID, name: `qa-fixture-${name}-${ts}`, phone, visit_type: 'new', memo: MARKER })
    .select('id').single();
  if (error || !data) throw new Error(`customer insert 실패: ${error?.message}`);
  created.customers.push(data.id as string);
  return data.id as string;
}

/** 패키지 생성 (heated/unheated 회차 지정). total_sessions = heated+unheated. */
async function mkPackage(customerId: string, heated: number, unheated: number, totalAmount: number): Promise<string> {
  const total = heated + unheated;
  const { data, error } = await sb!.from('packages').insert({
    clinic_id: CLINIC_ID, customer_id: customerId,
    package_name: 'qa-pkg', package_type: `preset_${total}`,
    total_sessions: total, heated_sessions: heated, unheated_sessions: unheated,
    total_amount: totalAmount, paid_amount: totalAmount, status: 'active',
    memo: MARKER,
  }).select('id').single();
  if (error || !data) throw new Error(`package insert 실패: ${error?.message}`);
  created.packages.push(data.id as string);
  return data.id as string;
}

/** 회차 소진(used) 1건 직접 insert */
async function useSession(packageId: string, type: string, n: number): Promise<void> {
  const { error } = await sb!.from('package_sessions')
    .insert({ package_id: packageId, session_number: n, session_type: type, status: 'used' });
  if (error) throw new Error(`session insert 실패: ${error.message}`);
}

async function mkCheckIn(customerId: string): Promise<string> {
  const ts = Date.now();
  for (let i = 0; i < 15; i++) {
    const { data, error } = await sb!.from('check_ins').insert({
      clinic_id: CLINIC_ID, customer_id: customerId, customer_name: 'qa-fixture', customer_phone: `010${String(ts).slice(-8)}`,
      visit_type: 'new', status: 'registered', queue_number: 900000 + Math.floor(Math.random() * 100000),
      checked_in_at: new Date().toISOString(), notes: MARKER,
    }).select('id').single();
    if (!error && data) { created.checkIns.push(data.id as string); return data.id as string; }
    if ((error as { code?: string })?.code !== '23505') throw new Error(`check_in insert 실패: ${error?.message}`);
  }
  throw new Error('check_in insert 실패: queue 충돌 재시도 초과');
}

async function remaining(packageId: string): Promise<Record<string, number>> {
  const { data } = await sb!.rpc('get_package_remaining', { p_package_id: packageId });
  return (data ?? {}) as Record<string, number>;
}

test.describe('T-20260703 PACKAGE-TRIPLE-DEFECT — 양도·선수금 금액/회차 정합', () => {
  test.skip(!dbReady, 'Supabase service_role env 미설정 → DB 검증 스킵');

  test.afterAll(async () => {
    if (!dbReady) return;
    // RPC가 만든 수령 패키지까지: transferred_from IN 원본, 또는 marker 로 스윕
    for (const c of created.customers) {
      const { data: pkgs } = await sb!.from('packages').select('id').eq('customer_id', c);
      for (const p of (pkgs ?? [])) created.packages.push((p as { id: string }).id);
    }
    const uniqPkgs = [...new Set(created.packages)];
    for (const p of uniqPkgs) {
      await sb!.from('package_sessions').delete().eq('package_id', p);
      await sb!.from('package_payments').delete().eq('package_id', p);
    }
    for (const p of uniqPkgs) await sb!.from('packages').delete().eq('id', p);
    for (const ci of created.checkIns) await sb!.from('check_ins').delete().eq('id', ci);
    for (const c of created.customers) await sb!.from('customers').delete().eq('id', c);
  });

  // ── 시나리오 1+3: 양도 (이중환불 차단 · 잔여 리셋 방지 · 금액 정합 · 0잔여 엣지) ──────────
  test('(a)(b) 양도: 원본 환불차단 + 수령 잔여=원본잔여(리셋X) + 금액 정합', async () => {
    // 10회권(가열4·비가열6), 400만원. 가열2·비가열2 소진 → 잔여 가열2·비가열4 = 6회.
    const a = await mkCustomer('A');
    const b = await mkCustomer('B');
    const pkg = await mkPackage(a, 4, 6, 4_000_000);
    await useSession(pkg, 'heated_laser', 1);
    await useSession(pkg, 'heated_laser', 2);
    await useSession(pkg, 'unheated_laser', 3);
    await useSession(pkg, 'unheated_laser', 4);

    const remBefore = await remaining(pkg);
    expect(remBefore.total_remaining, '원본 잔여 6회').toBe(6);

    const unit = 4_000_000 / 10;
    const expectedCarry = Math.round(unit * 6); // 2,400,000

    const { data: tData, error: tErr } = await sb!.rpc('transfer_package_atomic', {
      p_package_id: pkg, p_target_customer_id: b,
    });
    expect(tErr, '양도 RPC 오류 없음').toBeNull();
    const tRes = tData as { ok?: boolean; new_package_id?: string; carried_sessions?: number; carried_amount?: number };
    expect(tRes?.ok, '양도 성공').toBe(true);
    expect(tRes.carried_sessions, '승계 회차 = 잔여 6').toBe(6);
    expect(tRes.carried_amount, '승계 금액 = 단가×잔여').toBe(expectedCarry);

    const newPkgId = tRes.new_package_id!;
    created.packages.push(newPkgId);

    // 원본 → transferred
    const { data: orig } = await sb!.from('packages').select('status, transferred_to').eq('id', pkg).single();
    expect((orig as { status: string }).status, "원본 status='transferred'").toBe('transferred');

    // (a) 이중환불 차단: 원본은 active 아님 → 환불 거부
    const { data: rfData } = await sb!.rpc('refund_package_atomic', {
      p_package_id: pkg, p_clinic_id: CLINIC_ID, p_customer_id: a, p_method: 'card',
    });
    expect((rfData as { error?: string; ok?: boolean })?.ok, '양도된 원본 환불 불가').not.toBe(true);
    expect((rfData as { error?: string }).error, '환불 거부 사유 존재').toBeTruthy();

    // (b) 잔여 리셋 방지: 수령 패키지 잔여 = 원본 잔여 (전체 10 아님)
    const { data: np } = await sb!.from('packages')
      .select('status, transferred_from, total_sessions, heated_sessions, unheated_sessions, total_amount, paid_amount')
      .eq('id', newPkgId).single();
    const npv = np as Record<string, number | string>;
    expect(npv.status, '수령 active').toBe('active');
    expect(npv.transferred_from, 'transferred_from = 원본 package_id(FK 정합)').toBe(pkg);
    expect(npv.total_sessions, '수령 total = 잔여 6 (리셋 아님)').toBe(6);
    expect(npv.heated_sessions, '수령 가열 = 잔여 2').toBe(2);
    expect(npv.unheated_sessions, '수령 비가열 = 잔여 4').toBe(4);
    expect(npv.total_amount, '수령 금액 = 승계 가치').toBe(expectedCarry);

    const remNew = await remaining(newPkgId);
    expect(remNew.total_remaining, '수령 잔여 6회 (소진 0)').toBe(6);

    // 금액 정합 불변식: 수령 환불견적 == 승계가치 (과환불/이중환불 없음, 잔여가치 1회)
    const { data: q } = await sb!.rpc('calc_refund_amount', { p_package_id: newPkgId });
    expect((q as { refund_amount: number }).refund_amount, '수령 환불견적 = 승계가치').toBe(expectedCarry);
  });

  test('(엣지) 잔여 0 패키지 양도 → 거부', async () => {
    const a = await mkCustomer('Z');
    const b = await mkCustomer('Zt');
    const pkg = await mkPackage(a, 1, 1, 800_000); // 2회
    await useSession(pkg, 'heated_laser', 1);
    await useSession(pkg, 'unheated_laser', 2); // 잔여 0
    const { data } = await sb!.rpc('transfer_package_atomic', { p_package_id: pkg, p_target_customer_id: b });
    expect((data as { ok?: boolean }).ok, '잔여 0 양도 불가').not.toBe(true);
    expect((data as { error?: string }).error, '거부 사유 존재').toBeTruthy();
  });

  // ── 시나리오 2+3: 선수금 차감 회차 소진 (멱등 · 초과차감 방지) ─────────────────────────
  test('(c) 선수금차감: package_sessions 실차감 + 멱등 재호출 0건', async () => {
    const c = await mkCustomer('C');
    const pkg = await mkPackage(c, 3, 3, 1_800_000); // 가열3·비가열3
    const ci = await mkCheckIn(c);

    // 비가열 2회 차감 요청
    const counts = { heated_laser: 0, unheated_laser: 2, iv: 0, podologue: 0 };
    const { data: d1, error: e1 } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID, p_counts: counts,
    });
    expect(e1, 'consume 오류 없음').toBeNull();
    expect((d1 as { inserted: number }).inserted, '2건 차감').toBe(2);

    const r1 = await remaining(pkg);
    expect(r1.unheated, '비가열 잔여 3-2=1').toBe(1);

    // 멱등: 동일 체크인·동일 counts 재호출 → 0건 (이중차감 없음)
    const { data: d2 } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID, p_counts: counts,
    });
    expect((d2 as { inserted: number }).inserted, '멱등 재호출 0건').toBe(0);
    const r2 = await remaining(pkg);
    expect(r2.unheated, '멱등 후 잔여 불변 1').toBe(1);
  });

  test('(c 엣지) 초과차감 방지: 잔여 초과 요청 시 잔여까지만 차감', async () => {
    const c = await mkCustomer('D');
    const pkg = await mkPackage(c, 1, 1, 600_000); // 가열1·비가열1
    const ci = await mkCheckIn(c);
    // 가열 5회 요청(잔여 1) → 1건만 차감
    const { data } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 5, unheated_laser: 0, iv: 0, podologue: 0 },
    });
    expect((data as { inserted: number }).inserted, '잔여 1까지만 차감').toBe(1);
    const r = await remaining(pkg);
    expect(r.heated, '가열 잔여 0 (음수 아님)').toBe(0);
  });
});
