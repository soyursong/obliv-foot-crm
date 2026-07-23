/**
 * E2E (service_role DB 불변식) — T-20260723-foot-PKGSESSION-LINK-UNWIRED (P1)
 * design-codex: design_codex_reconfirm_foot_pkgsession_widened_20260723.md (GREEN, GO_WARN)
 * DA CONSULT: consult_reply_foot_pkgsession_consume_authority_20260723.md
 *
 * widened(소비-파생 SET) 불변식을 consume_package_sessions_for_checkin RPC 직접 호출로 검증.
 * page/auth 불필요 → service_role DB 검증. RPC 미배포(구 4-arg)면 실패(=supervisor DDL apply 후 PASS).
 *
 * 검증 바인딩:
 *   C1  — 클라 deterministic (service_id, session_type) 집합만 마킹 (서버 fuzzy 재매칭 금지).
 *   C2  — 실 insert 회차수만 마킹 · 1세션↔1행 FIFO · idempotent(WHERE package_session_id IS NULL) ·
 *          package_session_id + is_package_session 동시 SET · shortfall 행 미마킹(phantom 방지).
 *   C3  — saveCheckInServices 재저장 clobber 회귀: 스냅샷 재적용 하드닝으로 마킹 보존.
 *   호환 — p_service_sessions=NULL(구 번들 폴백)이면 회차 소진만·마킹 skip.
 *   멱등 3케이스 — 완납 / 부분납(shortfall) / RPC 재호출.
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

/** check_in_services 행 1건 직접 insert (초기 마킹 없음 = 신규 저장 시뮬레이션) */
async function mkCIS(checkInId: string, serviceId: string, name: string): Promise<string> {
  const { data, error } = await sb!.from('check_in_services')
    .insert({ check_in_id: checkInId, service_id: serviceId, service_name: name, price: 100000, original_price: 100000, is_package_session: false })
    .select('id').single();
  if (error || !data) throw new Error(`check_in_services insert 실패: ${error?.message}`);
  return data.id as string;
}

async function cisRows(checkInId: string) {
  const { data } = await sb!.from('check_in_services')
    .select('id, service_id, package_session_id, is_package_session')
    .eq('check_in_id', checkInId);
  return (data ?? []) as { id: string; service_id: string; package_session_id: string | null; is_package_session: boolean | null }[];
}

async function pkgSessions(checkInId: string) {
  const { data } = await sb!.from('package_sessions').select('id, session_type, status').eq('check_in_id', checkInId);
  return (data ?? []) as { id: string; session_type: string; status: string }[];
}

test.describe('T-20260723 PKGSESSION-LINK-UNWIRED — is_package_session 소비-파생 SET', () => {
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

  // ── 멱등케이스① 완납 + C1/C2 마킹 (1:1 FIFO, 동시 SET) ────────────────────────
  test('(완납) 실 insert 회차수만큼 check_in_services 1:1 마킹 + FK/flag 동시 SET', async () => {
    const c = await mkCustomer('full');
    const pkg = await mkPackage(c, 0, 3, 900_000); // 비가열 3회 잔여
    const svc = await mkService('unheated', '비가열레이저');
    const ci = await mkCheckIn(c);
    const r1 = await mkCIS(ci, svc, 'unheated#1');
    const r2 = await mkCIS(ci, svc, 'unheated#2');

    const { data, error } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 0, unheated_laser: 2, iv: 0, podologue: 0 },
      p_service_sessions: [
        { service_id: svc, session_type: 'unheated_laser' },
        { service_id: svc, session_type: 'unheated_laser' },
      ],
    });
    expect(error, 'RPC 오류 없음').toBeNull();
    expect((data as { inserted: number }).inserted, '2회 소진').toBe(2);
    expect((data as { marked: number }).marked, '2행 마킹').toBe(2);

    const sessions = await pkgSessions(ci);
    expect(sessions.length, 'package_sessions 2건').toBe(2);
    const sessionIds = new Set(sessions.map((s) => s.id));

    const rows = await cisRows(ci);
    // C2: package_session_id + is_package_session 동시 SET
    for (const row of rows) {
      expect(row.is_package_session, `${row.id} is_package_session=true`).toBe(true);
      expect(row.package_session_id, `${row.id} FK 전방배선`).toBeTruthy();
      expect(sessionIds.has(row.package_session_id!), 'FK가 실제 insert된 session 참조').toBe(true);
    }
    // C2: 1세션↔1행 (distinct pairing, 중복 없음)
    const psids = rows.map((r) => r.package_session_id);
    expect(new Set(psids).size, '2행 서로 다른 session (1:1 FIFO)').toBe(2);
    expect([r1, r2].sort()).toEqual(rows.map((r) => r.id).sort());
  });

  // ── C1 결정성: p_service_sessions service_id 집합 밖 행은 미마킹 (서버 fuzzy 금지) ──
  test('(C1) p_service_sessions 밖 service_id 행은 마킹되지 않음', async () => {
    const c = await mkCustomer('c1');
    const pkg = await mkPackage(c, 0, 3, 900_000);
    const svcIn = await mkService('unheated-in', '비가열레이저');
    const svcOut = await mkService('unheated-out', '비가열레이저'); // 개념상 동일 type이지만 미전달
    const ci = await mkCheckIn(c);
    const rIn = await mkCIS(ci, svcIn, 'in');
    const rOut = await mkCIS(ci, svcOut, 'out');

    const { data } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 0, unheated_laser: 1, iv: 0, podologue: 0 },
      p_service_sessions: [{ service_id: svcIn, session_type: 'unheated_laser' }],
    });
    expect((data as { marked: number }).marked, '전달된 1행만 마킹').toBe(1);

    const rows = await cisRows(ci);
    const inRow = rows.find((r) => r.id === rIn)!;
    const outRow = rows.find((r) => r.id === rOut)!;
    expect(inRow.package_session_id, '전달 service_id 마킹됨').toBeTruthy();
    expect(outRow.package_session_id, '미전달 service_id 미마킹 (fuzzy 금지)').toBeNull();
    expect(outRow.is_package_session, '미전달 행 flag false 유지').toBe(false);
  });

  // ── 멱등케이스② 부분납(shortfall) — phantom 방지 ───────────────────────────────
  test('(부분납) 잔여 부족 shortfall 행은 미마킹 (phantom already_paid 방지)', async () => {
    const c = await mkCustomer('short');
    const pkg = await mkPackage(c, 0, 1, 300_000); // 비가열 1회만 잔여
    const svc = await mkService('unheated', '비가열레이저');
    const ci = await mkCheckIn(c);
    await mkCIS(ci, svc, 'u#1');
    await mkCIS(ci, svc, 'u#2');

    const { data } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 0, unheated_laser: 2, iv: 0, podologue: 0 },
      p_service_sessions: [
        { service_id: svc, session_type: 'unheated_laser' },
        { service_id: svc, session_type: 'unheated_laser' },
      ],
    });
    expect((data as { inserted: number }).inserted, '잔여 1까지만 소진').toBe(1);
    expect((data as { marked: number }).marked, '소진분 1행만 마킹').toBe(1);

    const rows = await cisRows(ci);
    const marked = rows.filter((r) => r.package_session_id !== null);
    const unmarked = rows.filter((r) => r.package_session_id === null);
    expect(marked.length, '1행 마킹').toBe(1);
    expect(unmarked.length, 'shortfall 1행 미마킹 → 실매출/미납 귀속').toBe(1);
    expect(unmarked[0].is_package_session, 'shortfall 행 phantom 아님').toBe(false);
  });

  // ── 멱등케이스③ RPC 재호출 — 이중마킹 없음 ─────────────────────────────────────
  test('(멱등) 동일 params 재호출 시 재소진·재마킹 0건', async () => {
    const c = await mkCustomer('idem');
    const pkg = await mkPackage(c, 0, 2, 600_000);
    const svc = await mkService('unheated', '비가열레이저');
    const ci = await mkCheckIn(c);
    await mkCIS(ci, svc, 'u#1');
    const params = {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 0, unheated_laser: 1, iv: 0, podologue: 0 },
      p_service_sessions: [{ service_id: svc, session_type: 'unheated_laser' }],
    };
    const { data: d1 } = await sb!.rpc('consume_package_sessions_for_checkin', params);
    expect((d1 as { inserted: number; marked: number }).inserted).toBe(1);
    expect((d1 as { marked: number }).marked).toBe(1);
    const psidAfter1 = (await cisRows(ci))[0].package_session_id;

    const { data: d2 } = await sb!.rpc('consume_package_sessions_for_checkin', params);
    expect((d2 as { inserted: number }).inserted, '재호출 재소진 0').toBe(0);
    expect((d2 as { marked: number }).marked, '재호출 재마킹 0 (WHERE package_session_id IS NULL)').toBe(0);
    const rows = await cisRows(ci);
    expect(rows[0].package_session_id, '기존 마킹 불변').toBe(psidAfter1);
    expect((await pkgSessions(ci)).length, 'package_sessions 불변 1건').toBe(1);
  });

  // ── C3 재저장 회귀: saveCheckInServices 스냅샷 재적용 하드닝 ────────────────────
  test('(C3) consume 후 재저장(DELETE+reinsert) 시 마킹 보존 — 하드닝', async () => {
    const c = await mkCustomer('resave');
    const pkg = await mkPackage(c, 0, 2, 600_000);
    const svc = await mkService('unheated', '비가열레이저');
    const ci = await mkCheckIn(c);
    await mkCIS(ci, svc, 'u#1');
    await mkCIS(ci, svc, 'u#2');
    await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 0, unheated_laser: 2, iv: 0, podologue: 0 },
      p_service_sessions: [
        { service_id: svc, session_type: 'unheated_laser' },
        { service_id: svc, session_type: 'unheated_laser' },
      ],
    });
    const before = await cisRows(ci);
    expect(before.filter((r) => r.package_session_id).length, '소비 후 2행 마킹').toBe(2);

    // ── saveCheckInServices 하드닝 로직 재현 (PMW): 스냅샷 → DELETE → 보존 reinsert ──
    const preservedQueue = new Map<string, string[]>();
    for (const r of before.filter((x) => x.package_session_id)) {
      const q = preservedQueue.get(r.service_id) ?? [];
      q.push(r.package_session_id!);
      preservedQueue.set(r.service_id, q);
    }
    await sb!.from('check_in_services').delete().eq('check_in_id', ci);
    // qty=2 재저장 (isDeductMode=false 여도 보존분은 복원)
    const reinsert = Array.from({ length: 2 }, () => {
      const q = preservedQueue.get(svc);
      const psid = q && q.length > 0 ? q.shift()! : null;
      return {
        check_in_id: ci, service_id: svc, service_name: 'unheated', price: 100000, original_price: 100000,
        is_package_session: psid !== null, package_session_id: psid,
      };
    });
    await sb!.from('check_in_services').insert(reinsert);

    const after = await cisRows(ci);
    expect(after.filter((r) => r.package_session_id).length, '재저장 후에도 2행 마킹 보존').toBe(2);
    expect(after.filter((r) => r.is_package_session).length, 'is_package_session 보존').toBe(2);
    // 보존된 FK가 여전히 실제 package_session 참조 (⑨/Closing 정합 유지)
    const sessionIds = new Set((await pkgSessions(ci)).map((s) => s.id));
    for (const r of after) expect(sessionIds.has(r.package_session_id!), 'FK 유효').toBe(true);

    // 네거티브 대조: 하드닝 없이 naive reinsert 였다면 clobber (회귀 실재 증명)
    await sb!.from('check_in_services').delete().eq('check_in_id', ci);
    await sb!.from('check_in_services').insert(
      Array.from({ length: 2 }, () => ({ check_in_id: ci, service_id: svc, service_name: 'unheated', price: 100000, original_price: 100000, is_package_session: false })),
    );
    const naive = await cisRows(ci);
    expect(naive.filter((r) => r.package_session_id).length, '하드닝 부재 시 clobber(=회귀 실재)').toBe(0);
  });

  // ── 호환: p_service_sessions=NULL(구 번들 폴백) → 소진만·마킹 skip ──────────────
  test('(호환) p_service_sessions 미전달 시 회차 소진만·check_in_services 미마킹', async () => {
    const c = await mkCustomer('compat');
    const pkg = await mkPackage(c, 0, 2, 600_000);
    const svc = await mkService('unheated', '비가열레이저');
    const ci = await mkCheckIn(c);
    await mkCIS(ci, svc, 'u#1');

    const { data, error } = await sb!.rpc('consume_package_sessions_for_checkin', {
      p_check_in_id: ci, p_customer_id: c, p_clinic_id: CLINIC_ID,
      p_counts: { heated_laser: 0, unheated_laser: 1, iv: 0, podologue: 0 },
      // p_service_sessions 생략 → DEFAULT NULL
    });
    expect(error, '구 4-arg 시그니처 호환 (오버로드 아님)').toBeNull();
    expect((data as { inserted: number }).inserted, '회차 소진은 유지').toBe(1);
    expect((data as { marked: number }).marked, 'NULL 폴백 → 마킹 skip').toBe(0);
    const rows = await cisRows(ci);
    expect(rows[0].package_session_id, '마킹 안 됨 (구 동작)').toBeNull();
  });
});
