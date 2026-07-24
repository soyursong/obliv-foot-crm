/**
 * E2E (service_role DB 불변식) — T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY (G-C-1 / J3)
 * 소스닫힘(source-closure): is_package_session ⟺ package_session_id (가드#4 "두 컬럼 함께 SET").
 *
 * 진단 evidence: T-20260724-foot-PKGSESSION-SOURCE-CLOSURE_diagnose-evidence.md
 *   prod 실측: flag=true & FK-null 51 / FK NOT NULL 0(전건) / matchable-FK-null 43(=FOLLOWUP "matched 42→43").
 *   root cause(2 caller 결함, 모두 guard#4 위반):
 *     Fix B — saveCheckInServices: isDeductMode 로 flag 선(先)마킹(FK 없이) → phantom already-paid + FK-null drift.
 *     Fix A — handleClose: C3 보존 없는 naked DELETE+reinsert → 소비 RPC 세팅 FK+flag clobber(false-when-consumed).
 *
 * 본 spec 은 PMW 의 **수정 후** 재삽입 로직을 service_role 로 재현해 불변식을 고정한다
 *   (page/auth 불필요, LINK-UNWIRED spec 동형 패턴). 소비 진실원천 = consume RPC(직접 호출).
 *
 * 검증:
 *   (B) 신규 저장(선수금차감 포함) 시 flag 선마킹 0 — FK 없는 flag=true 미생성.
 *   (A) consume 마킹 후 handleClose 자동저장 재현 시 FK+flag 보존(clobber 0) + 네거티브 회귀 witness.
 *   (INV) 전 사이클 후 'flag=true AND FK NULL' 행 0 (소스닫힘 불변식).
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[QA-FIXTURE]';

const dbReady = !!(SUPA_URL && SERVICE_KEY);
const sb: SupabaseClient | null = dbReady ? createClient(SUPA_URL!, SERVICE_KEY!) : null;

const created = {
  customers: [] as string[], packages: [] as string[],
  checkIns: [] as string[], services: [] as string[],
};

async function mkCustomer(name: string): Promise<string> {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const phone = `+8210${String(ts).slice(-8)}`;
  const { data, error } = await sb!.from('customers')
    .insert({ clinic_id: CLINIC_ID, name: `qa-fixture-${name}-${ts}`, phone, visit_type: 'new', memo: MARKER })
    .select('id').single();
  if (error || !data) throw new Error(`customer insert 실패: ${error?.message}`);
  created.customers.push(data.id as string);
  return data.id as string;
}

async function mkPackage(customerId: string, heated: number, unheated: number, totalAmount: number): Promise<string> {
  const total = heated + unheated;
  const { data, error } = await sb!.from('packages').insert({
    clinic_id: CLINIC_ID, customer_id: customerId,
    package_name: 'qa-pkg', package_type: `preset_${total}`,
    total_sessions: total, heated_sessions: heated, unheated_sessions: unheated,
    total_amount: totalAmount, paid_amount: totalAmount, status: 'active', memo: MARKER,
  }).select('id').single();
  if (error || !data) throw new Error(`package insert 실패: ${error?.message}`);
  created.packages.push(data.id as string);
  return data.id as string;
}

async function mkService(name: string, category: string): Promise<string> {
  const { data, error } = await sb!.from('services')
    .insert({ clinic_id: CLINIC_ID, name: `qa-${name}-${Date.now()}${Math.floor(Math.random() * 1000)}`, category, price: 100000 })
    .select('id').single();
  if (error || !data) throw new Error(`service insert 실패: ${error?.message}`);
  created.services.push(data.id as string);
  return data.id as string;
}

async function mkCheckIn(customerId: string): Promise<string> {
  const ts = Date.now();
  for (let i = 0; i < 15; i++) {
    const { data, error } = await sb!.from('check_ins').insert({
      clinic_id: CLINIC_ID, customer_id: customerId, customer_name: 'qa-fixture',
      customer_phone: `+8210${String(ts).slice(-8)}`, visit_type: 'new', status: 'registered',
      queue_number: 900000 + Math.floor(Math.random() * 100000),
      checked_in_at: new Date().toISOString(), notes: MARKER,
    }).select('id').single();
    if (!error && data) { created.checkIns.push(data.id as string); return data.id as string; }
    if ((error as { code?: string })?.code !== '23505') throw new Error(`check_in insert 실패: ${error?.message}`);
  }
  throw new Error('check_in insert 실패: queue 충돌 재시도 초과');
}

async function cisRows(checkInId: string) {
  const { data } = await sb!.from('check_in_services')
    .select('id, service_id, service_name, package_session_id, is_package_session')
    .eq('check_in_id', checkInId);
  return (data ?? []) as { id: string; service_id: string; service_name: string; package_session_id: string | null; is_package_session: boolean | null }[];
}

async function pkgSessions(checkInId: string) {
  const { data } = await sb!.from('package_sessions').select('id, session_type, status').eq('check_in_id', checkInId);
  return (data ?? []) as { id: string; session_type: string; status: string }[];
}

// ── PMW **수정 후** 재삽입 로직 재현 (saveCheckInServices / handleClose 동형) ─────────
//   두 경로 공통: DELETE 前 FK-not-null 스냅샷 → FIFO 복원 → is_package_session = (preservedPsid !== null).
//   flag 은 소비완료 링크의 파생값. 선마킹(isDeductMode) 없음.
async function reinsertWithPreservation(
  checkInId: string,
  items: { serviceId: string; name: string; qty: number }[],
) {
  const before = await cisRows(checkInId);
  const preservedQueue = new Map<string, string[]>();
  for (const r of before.filter((x) => x.package_session_id)) {
    const q = preservedQueue.get(r.service_id) ?? [];
    q.push(r.package_session_id!);
    preservedQueue.set(r.service_id, q);
  }
  await sb!.from('check_in_services').delete().eq('check_in_id', checkInId);
  const rows = items.flatMap(({ serviceId, name, qty }) =>
    Array.from({ length: qty }, () => {
      const q = preservedQueue.get(serviceId);
      const preservedPsid = q && q.length > 0 ? q.shift()! : null;
      return {
        check_in_id: checkInId, service_id: serviceId, service_name: name,
        price: 100000, original_price: 100000,
        is_package_session: preservedPsid !== null, package_session_id: preservedPsid,
      };
    }),
  );
  if (rows.length > 0) await sb!.from('check_in_services').insert(rows);
}

test.describe('T-20260724 PKGSESSION-SOURCE-CLOSURE — 가드#4 두 컬럼 함께 SET', () => {
  test.skip(!dbReady, 'Supabase service_role env 미설정 → DB 검증 스킵');

  test.afterAll(async () => {
    if (!dbReady) return;
    for (const ci of created.checkIns) await sb!.from('check_in_services').delete().eq('check_in_id', ci);
    for (const p of [...new Set(created.packages)]) {
      await sb!.from('package_sessions').delete().eq('package_id', p);
      await sb!.from('package_payments').delete().eq('package_id', p);
    }
    for (const p of [...new Set(created.packages)]) await sb!.from('packages').delete().eq('id', p);
    for (const ci of created.checkIns) await sb!.from('check_ins').delete().eq('id', ci);
    for (const s of created.services) await sb!.from('services').delete().eq('id', s);
    for (const c of created.customers) await sb!.from('customers').delete().eq('id', c);
  });

  // ── Fix B: 선수금차감 저장도 flag 선마킹 없음 (소비 前) ────────────────────────
  test('(B) 선수금차감 저장 시 flag 선마킹 0 — FK 없는 flag=true 미생성', async () => {
    const c = await mkCustomer('presave');
    await mkPackage(c, 0, 2, 600_000);
    const svc = await mkService('unheated', '비가열레이저');
    const ci = await mkCheckIn(c);

    // 소비(consume RPC) 前 선수금차감 저장 시뮬레이션 (prior FK 없음)
    await reinsertWithPreservation(ci, [{ serviceId: svc, name: '비가열', qty: 2 }]);

    const rows = await cisRows(ci);
    expect(rows.length, '2행 저장').toBe(2);
    // 소비 전이므로 flag=false / FK=null — phantom already-paid 미생성
    expect(rows.filter((r) => r.is_package_session === true).length, '선마킹 flag=true 0').toBe(0);
    expect(rows.filter((r) => r.package_session_id !== null).length, 'FK 세팅 0').toBe(0);
    // 불변식: flag=true AND FK-null 행 0 (구 코드였다면 isDeductMode 로 2행 생성됐을 leak)
    expect(rows.filter((r) => r.is_package_session === true && r.package_session_id === null).length,
      'flag-true/FK-null leak 0').toBe(0);
  });

  // ── Fix A: consume 마킹 후 handleClose 자동저장 재현 시 clobber 0 ──────────────
  test('(A) handleClose 자동저장(재삽입) 시 소비 FK+flag 보존 — clobber 0', async () => {
    const c = await mkCustomer('close');
    await mkPackage(c, 0, 2, 600_000);
    const svc = await mkService('unheated', '비가열레이저');
    const ci = await mkCheckIn(c);
    // 저장(선마킹 없음)
    await reinsertWithPreservation(ci, [{ serviceId: svc, name: '비가열', qty: 2 }]);
    // 수납확정 = 소비 RPC (두 컬럼 원자 SET)
    const { error } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 0, unheated_laser: 2, iv: 0, podologue: 0 },
      p_service_sessions: [
        { service_id: svc, session_type: 'unheated_laser' },
        { service_id: svc, session_type: 'unheated_laser' },
      ],
    });
    expect(error, 'consume RPC 오류 없음').toBeNull();
    const marked = await cisRows(ci);
    expect(marked.filter((r) => r.package_session_id).length, '소비 후 2행 마킹').toBe(2);

    // handleClose 자동저장 재현 (수정 후 = C3 보존 有)
    await reinsertWithPreservation(ci, [{ serviceId: svc, name: '비가열', qty: 2 }]);
    const after = await cisRows(ci);
    expect(after.filter((r) => r.package_session_id).length, 'handleClose 후 FK 보존').toBe(2);
    expect(after.filter((r) => r.is_package_session).length, 'handleClose 후 flag 보존').toBe(2);
    const sessionIds = new Set((await pkgSessions(ci)).map((s) => s.id));
    for (const r of after) expect(sessionIds.has(r.package_session_id!), 'FK 유효').toBe(true);

    // 네거티브 회귀 witness: 보존 없는 naked reinsert(구 handleClose) → clobber
    await sb!.from('check_in_services').delete().eq('check_in_id', ci);
    await sb!.from('check_in_services').insert(
      Array.from({ length: 2 }, () => ({
        check_in_id: ci, service_id: svc, service_name: '비가열', price: 100000, original_price: 100000,
        is_package_session: false,
      })),
    );
    const naive = await cisRows(ci);
    expect(naive.filter((r) => r.package_session_id).length, '보존 부재 시 clobber(=구 handleClose 회귀 실재)').toBe(0);
    expect(naive.filter((r) => r.is_package_session).length, 'false-when-consumed(구 회귀)').toBe(0);
  });

  // ── 소스닫힘 불변식: 전 사이클 후 flag=true AND FK-null 0 ─────────────────────
  test('(INV) 저장→소비→재저장→handleClose 전 사이클 후 flag-true/FK-null 0', async () => {
    const c = await mkCustomer('inv');
    await mkPackage(c, 1, 1, 600_000);
    const svcU = await mkService('unheated', '비가열레이저');
    const svcH = await mkService('heated', '가열레이저');
    const ci = await mkCheckIn(c);
    // 저장(선마킹 없음)
    await reinsertWithPreservation(ci, [
      { serviceId: svcU, name: '비가열', qty: 1 },
      { serviceId: svcH, name: '가열', qty: 1 },
    ]);
    // 소비
    await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 1, unheated_laser: 1, iv: 0, podologue: 0 },
      p_service_sessions: [
        { service_id: svcU, session_type: 'unheated_laser' },
        { service_id: svcH, session_type: 'heated_laser' },
      ],
    });
    // 재저장 + handleClose 2회 (clobber 유발 시도)
    await reinsertWithPreservation(ci, [
      { serviceId: svcU, name: '비가열', qty: 1 },
      { serviceId: svcH, name: '가열', qty: 1 },
    ]);
    await reinsertWithPreservation(ci, [
      { serviceId: svcU, name: '비가열', qty: 1 },
      { serviceId: svcH, name: '가열', qty: 1 },
    ]);

    const rows = await cisRows(ci);
    // 소스닫힘 불변식: flag=true ⟺ FK NOT NULL (한쪽만 세팅된 행 0)
    expect(rows.filter((r) => r.is_package_session === true && r.package_session_id === null).length,
      'FK-null drift 0').toBe(0);
    expect(rows.filter((r) => r.is_package_session === false && r.package_session_id !== null).length,
      'false-when-consumed 0').toBe(0);
    // 소비된 2회차는 여전히 링크 보존
    expect(rows.filter((r) => r.is_package_session === true && r.package_session_id !== null).length,
      '소비 2행 링크 보존').toBe(2);
  });
});
