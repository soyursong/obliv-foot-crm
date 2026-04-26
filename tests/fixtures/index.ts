/**
 * 시드 fixture (T-foot-qa-001)
 *
 * 사용:
 *   const { id, cleanup } = await seedCheckIn({ status: 'consultation', visit_type: 'new' });
 *   afterAll(cleanup);
 *
 * 모든 fixture는 service_role 사용 + `[QA-FIXTURE]` 마커.
 * cleanup은 본인이 만든 row만 삭제 — 다른 데이터 영향 없음.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[QA-FIXTURE]';

let _sb: SupabaseClient | null = null;
function svc(): SupabaseClient {
  if (!_sb) _sb = createClient(SUPA_URL, SERVICE_KEY);
  return _sb;
}

export interface FixtureHandle {
  id: string;
  cleanup: () => Promise<void>;
}

/** 신규 customer + check_in (지정 단계) */
export async function seedCheckIn(opts: {
  status?: string;
  visit_type?: 'new' | 'returning' | 'experience';
  name?: string;
  package_id?: string;
}): Promise<FixtureHandle & { customerId: string; phone: string }> {
  const sb = svc();
  const ts = Date.now();
  const phone = `010${String(ts).slice(-8)}`;
  const name = opts.name ?? `qa-fixture-${ts}`;

  const { data: c, error: cErr } = await sb
    .from('customers')
    .insert({
      clinic_id: CLINIC_ID,
      name,
      phone,
      visit_type: opts.visit_type ?? 'new',
      memo: MARKER,
    })
    .select('id')
    .single();
  if (cErr || !c) throw new Error(`seedCheckIn: customer insert failed: ${cErr?.message}`);
  const customerId = c.id as string;

  const { data: ci, error: ciErr } = await sb
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customerId,
      customer_name: name,
      customer_phone: phone,
      visit_type: opts.visit_type ?? 'new',
      status: opts.status ?? 'registered',
      queue_number: 990 + (ts % 10),
      package_id: opts.package_id,
      notes: MARKER,
    })
    .select('id')
    .single();
  if (ciErr || !ci) {
    await sb.from('customers').delete().eq('id', customerId);
    throw new Error(`seedCheckIn: check_in insert failed: ${ciErr?.message}`);
  }
  const checkInId = ci.id as string;

  return {
    id: checkInId,
    customerId,
    phone,
    cleanup: async () => {
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customerId);
    },
  };
}

/** 패키지 + package_payments */
export async function seedPackage(opts: {
  customerId: string;
  preset?: { label: string; total: number; suggestedPrice: number };
}): Promise<FixtureHandle> {
  const sb = svc();
  const preset = opts.preset ?? { label: '패키지1 (12회)', total: 12, suggestedPrice: 3600000 };
  const { data: pkg, error } = await sb
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: opts.customerId,
      package_name: preset.label,
      package_type: `preset_${preset.total}`,
      total_sessions: preset.total,
      total_amount: preset.suggestedPrice,
      paid_amount: preset.suggestedPrice,
      status: 'active',
    })
    .select('id')
    .single();
  if (error || !pkg) throw new Error(`seedPackage failed: ${error?.message}`);
  const packageId = pkg.id as string;
  return {
    id: packageId,
    cleanup: async () => {
      await sb.from('package_payments').delete().eq('package_id', packageId);
      await sb.from('packages').delete().eq('id', packageId);
    },
  };
}

/** 오늘 예약 1건 */
export async function seedReservation(opts: {
  date?: string;
  time?: string;
  customerName?: string;
  visit_type?: 'new' | 'returning' | 'experience';
}): Promise<FixtureHandle> {
  const sb = svc();
  const ts = Date.now();
  const date = opts.date ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('reservations')
    .insert({
      clinic_id: CLINIC_ID,
      customer_name: opts.customerName ?? `qa-res-${ts}`,
      reservation_date: date,
      reservation_time: opts.time ?? '14:00',
      visit_type: opts.visit_type ?? 'new',
      status: 'confirmed',
      memo: MARKER,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedReservation failed: ${error?.message}`);
  const id = data.id as string;
  return {
    id,
    cleanup: async () => {
      await sb.from('reservation_logs').delete().eq('reservation_id', id);
      await sb.from('reservations').delete().eq('id', id);
    },
  };
}

/** 활성 staff 1명 픽 (생성 X — 기존 row) */
export async function pickStaff(role?: string): Promise<{ id: string; name: string; role: string } | null> {
  const sb = svc();
  let q = sb.from('staff').select('id, name, role').eq('clinic_id', CLINIC_ID).eq('active', true).limit(1);
  if (role) q = q.eq('role', role);
  const { data } = await q;
  return data?.[0] ?? null;
}

/** 일괄 cleanup — 모든 [QA-FIXTURE] 마커 row */
export async function cleanupAll(): Promise<void> {
  const sb = svc();
  // 패키지 결제 → 패키지 → 체크인 → 고객 (FK 순서)
  const { data: ckRows } = await sb.from('check_ins').select('id, customer_id').eq('notes', MARKER);
  const checkInIds = (ckRows ?? []).map((r) => r.id as string);
  const customerIds = Array.from(new Set((ckRows ?? []).map((r) => r.customer_id as string).filter(Boolean)));
  if (checkInIds.length) {
    await sb.from('payments').delete().in('check_in_id', checkInIds);
    await sb.from('check_ins').delete().in('id', checkInIds);
  }
  if (customerIds.length) {
    const { data: pkgRows } = await sb.from('packages').select('id').in('customer_id', customerIds);
    const pkgIds = (pkgRows ?? []).map((r) => r.id as string);
    if (pkgIds.length) {
      await sb.from('package_payments').delete().in('package_id', pkgIds);
      await sb.from('packages').delete().in('id', pkgIds);
    }
    await sb.from('customers').delete().in('id', customerIds);
  }
  // reservations
  const { data: resRows } = await sb.from('reservations').select('id').eq('memo', MARKER);
  const resIds = (resRows ?? []).map((r) => r.id as string);
  if (resIds.length) {
    await sb.from('reservation_logs').delete().in('reservation_id', resIds);
    await sb.from('reservations').delete().in('id', resIds);
  }
}
