/**
 * E2E (service_role DB 불변식) — T-20260724-foot-PKGSESSION-SOURCE-CLOSURE-GUARD4
 * 소스닫힘(source-closure) 재저장-보존 lifecycle spec (부모 FM2 실선행 = G-C-1 배포).
 *
 * 가드#4 불변식: is_package_session=true ⟺ package_session_id NOT NULL (두 컬럼 항상 함께 이동).
 *   is_package_session 은 소비 RPC(consume_package_sessions_for_checkin)가 회차 insert 와
 *   원자적으로 함께 SET 하는 파생값(단일 진실원천). FE 저장은 flag 를 선(先)마킹하지 않고,
 *   재저장 시 소비완료 링크(package_session_id)만 C3 보존한다.
 *
 * 진단 evidence(READ-ONLY 실측): prod flag=true & FK-null 51 / FK NOT NULL 0 / matchable-FK-null 43.
 *   RPC 본문·서명·배포 정상(J2 GREEN) → 원인은 caller clobber/선마킹(guard#4 위반). J3(RPC 본문) 트랙 없음.
 *
 * 본 spec 은 PMW 의 **수정 후(fb12f668)** 재삽입 로직을 service_role 로 재현해 불변식을 DB-assert 로 고정한다
 *   (page/auth 불필요 — DB-assert 없이 UI 만으로 보존검증 불충분, db_change=false 지만 저장로직 변경이라 spec 필수).
 *
 * 시나리오(ticket 명세):
 *   시나리오1(핵심): 선수금 환자 체크인→회차소비 시술 저장(FK+flag SET)→닫기(handleClose)
 *                    →재오픈 재저장(saveCheckInServices)→package_session_id 유지(clobber 0) DB-assert.
 *   시나리오2(회귀): 비-패키지(소비 前) 재저장 시 is_package_session phantom 선마킹 0 (Fix B 가드).
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

// ── PMW **수정 후(fb12f668)** 재삽입 로직 재현 (saveCheckInServices / handleClose 동형) ─────
//   두 경로 공통: DELETE 前 FK-not-null 스냅샷 → service_id 별 FIFO 복원 →
//   is_package_session = (preservedPsid !== null). flag 은 소비완료 링크의 파생값(선마킹 없음).
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

test.describe('T-20260724 PKGSESSION-SOURCE-CLOSURE-GUARD4 — 재저장-보존 lifecycle', () => {
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

  // ── 시나리오1(핵심): 체크인→회차소비 저장(FK+flag SET)→닫기→재오픈 재저장→FK 유지(clobber 0) ──
  test('시나리오1(핵심): 소비 마킹 후 handleClose→saveCheckInServices 재저장 시 package_session_id 유지 — clobber 0', async () => {
    const c = await mkCustomer('scn1');
    await mkPackage(c, 1, 1, 600_000);
    const svcU = await mkService('unheated', '비가열레이저');
    const svcH = await mkService('heated', '가열레이저');
    const ci = await mkCheckIn(c);

    // 1) 체크인 후 시술 저장 (선마킹 없음 — 소비 前)
    await reinsertWithPreservation(ci, [
      { serviceId: svcU, name: '비가열', qty: 1 },
      { serviceId: svcH, name: '가열', qty: 1 },
    ]);

    // 2) 수납확정 = 회차소비 RPC (FK + flag 원자 SET)
    const { error: consumeErr } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 1, unheated_laser: 1, iv: 0, podologue: 0 },
      p_service_sessions: [
        { service_id: svcU, session_type: 'unheated_laser' },
        { service_id: svcH, session_type: 'heated_laser' },
      ],
    });
    expect(consumeErr, 'consume RPC 오류 없음').toBeNull();
    const consumed = await cisRows(ci);
    expect(consumed.filter((r) => r.package_session_id !== null).length, '소비 후 FK SET 2행').toBe(2);
    expect(consumed.filter((r) => r.is_package_session === true).length, '소비 후 flag SET 2행').toBe(2);

    // 3) X 닫기 자동저장(handleClose) 재현 — C3 보존 재삽입
    await reinsertWithPreservation(ci, [
      { serviceId: svcU, name: '비가열', qty: 1 },
      { serviceId: svcH, name: '가열', qty: 1 },
    ]);
    const afterClose = await cisRows(ci);
    expect(afterClose.filter((r) => r.package_session_id !== null).length, 'handleClose 후 FK 보존').toBe(2);

    // 4) 재오픈 재저장(saveCheckInServices) 재현 — 다시 C3 보존 재삽입
    await reinsertWithPreservation(ci, [
      { serviceId: svcU, name: '비가열', qty: 1 },
      { serviceId: svcH, name: '가열', qty: 1 },
    ]);
    const afterResave = await cisRows(ci);

    // DB-assert: package_session_id 유지 (clobber 0) + flag 동반 보존
    expect(afterResave.filter((r) => r.package_session_id !== null).length, '재저장 후 FK 유지(clobber 0)').toBe(2);
    expect(afterResave.filter((r) => r.is_package_session === true).length, '재저장 후 flag 유지').toBe(2);
    // FK 는 실제 package_sessions 를 가리켜야 함 (dangling 아님)
    const sessionIds = new Set((await pkgSessions(ci)).map((s) => s.id));
    for (const r of afterResave.filter((x) => x.package_session_id)) {
      expect(sessionIds.has(r.package_session_id!), 'FK 유효(package_sessions 참조)').toBe(true);
    }
    // 소스닫힘 불변식: 한쪽만 세팅된 행 0 (두 컬럼 함께 이동)
    expect(afterResave.filter((r) => r.is_package_session === true && r.package_session_id === null).length,
      'flag-true/FK-null drift 0').toBe(0);
    expect(afterResave.filter((r) => r.is_package_session === false && r.package_session_id !== null).length,
      'false-when-consumed 0').toBe(0);
  });

  // ── 시나리오2(회귀): 비-패키지(소비 前) 재저장 시 is_package_session phantom 선마킹 0 (Fix B 가드) ──
  test('시나리오2(회귀): 소비 前 재저장 시 is_package_session phantom 선마킹 0 — FK 없는 flag=true 미생성', async () => {
    const c = await mkCustomer('scn2');
    await mkPackage(c, 0, 2, 600_000); // 선수금 패키지 존재하나 아직 미소비
    const svc = await mkService('unheated', '비가열레이저');
    const ci = await mkCheckIn(c);

    // 소비(consume RPC) 前 저장 — 구 코드였다면 isDeductMode 로 flag 선마킹 leak 발생 지점
    await reinsertWithPreservation(ci, [{ serviceId: svc, name: '비가열', qty: 2 }]);
    const rows1 = await cisRows(ci);
    expect(rows1.length, '2행 저장').toBe(2);
    expect(rows1.filter((r) => r.is_package_session === true).length, '소비 前 phantom 선마킹 0').toBe(0);
    expect(rows1.filter((r) => r.package_session_id !== null).length, '소비 前 FK 0').toBe(0);

    // 재저장(handleClose/saveCheckInServices 반복)해도 여전히 선마킹 0 (phantom already-paid 미생성)
    await reinsertWithPreservation(ci, [{ serviceId: svc, name: '비가열', qty: 2 }]);
    const rows2 = await cisRows(ci);
    expect(rows2.filter((r) => r.is_package_session === true && r.package_session_id === null).length,
      '재저장 후에도 flag-true/FK-null leak 0').toBe(0);
  });
});
