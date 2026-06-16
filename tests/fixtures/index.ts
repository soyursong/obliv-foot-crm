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
export const MARKER = '[QA-FIXTURE]';
// 픽스처 customer/reservation 이름 접두 — orphan(마커 누락/생성중단) 스윕용 2차 키.
//   seedCheckIn → `qa-fixture-{ts}`, seedReservation → `qa-res-{ts}`.
export const FIXTURE_NAME_PREFIXES = ['qa-fixture-', 'qa-res-'] as const;

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

  // queue_number 충돌 회피:
  //   유니크 제약 idx_checkins_clinic_date_queue = (clinic_id, kst_date(checked_in_at), queue_number).
  //   기존 `990 + ts%10` 은 동일 일자에 단 10버킷뿐 → 다회 시딩/잔존 row 와 duplicate key.
  //   QA 픽스처는 고대역(900000~999999) 랜덤으로 실데이터(1..N 순차 발번)와 분리하고,
  //   그래도 충돌 시 23505(unique_violation) 만 새 번호로 재시도.
  const checkedInAt = new Date().toISOString();
  const qaQueue = () => 900000 + Math.floor(Math.random() * 100000);
  let ci: { id: string } | null = null;
  let ciErr: { message?: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customerId,
        customer_name: name,
        customer_phone: phone,
        visit_type: opts.visit_type ?? 'new',
        status: opts.status ?? 'registered',
        queue_number: qaQueue(),
        package_id: opts.package_id,
        // 실제 체크인은 항상 checked_in_at 보유. 대시보드 카드 쿼리가
        // checked_in_at 오늘범위(gte/lte)로 필터하므로 미설정 시 카드가 안 뜬다.
        checked_in_at: checkedInAt,
        notes: MARKER,
      })
      .select('id')
      .single();
    ci = (res.data as { id: string } | null) ?? null;
    ciErr = (res.error as { message?: string; code?: string } | null) ?? null;
    if (!ciErr) break;
    if (ciErr.code === '23505') continue; // queue_number 충돌 → 새 번호 재시도
    break; // 그 외 오류는 즉시 중단
  }
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

export interface CleanupSummary {
  customers: number;
  checkIns: number;
  packages: number;
  reservations: number;
  /** FK 등으로 삭제 보류된 customer 수 (legacy 잔존 — 별도 PROD 정리 트랙 소관) */
  skippedCustomers: number;
}

// PostgREST .in() 은 id 들을 URL query 로 직렬화한다. 수천 건이면 URL 길이 초과로 statement
// 전체가 실패(414 등)하거나, 한 행의 FK 위반이 statement 전체를 롤백한다.
// → 청크 분할로 한 번에 보내는 양을 제한하고, 청크 실패 시 per-id 폴백으로 격리한다.
const DELETE_CHUNK = 50;
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Supabase/PostgREST 의 기본 select 상한은 1000 row. QA 잔존이 1000건을 넘으면
// 단일 select 가 truncate 되어 신규 픽스처가 페이지 밖으로 밀려 누락된다(RC#0 재현).
// → .range() 페이지네이션으로 전수 수집한다.
const PAGE = 1000;
type RangeQB = {
  range: (from: number, to: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
};
/** build() 가 만든 select 쿼리를 .range() 로 전수 페이지네이션해 지정 컬럼 값을 모은다. */
async function selectAllValues(build: () => RangeQB, column: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data) {
      const v = r[column];
      if (v) out.push(v as string);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * id 집합을 청크+per-id 폴백으로 안전 삭제한다.
 *   - 청크 .in() delete 가 성공하면 그 청크는 일괄 삭제.
 *   - 한 행의 FK 위반 등으로 청크가 원자적으로 실패하면 per-id 로 격리 삭제 →
 *     삭제 가능한 행(신규 픽스처)은 전부 지우고, FK 막힌 legacy 행만 skip.
 * 이로써 "legacy 한 행이 배치 전체를 오염시켜 신규 픽스처까지 잔존" 하는 RC 를 차단한다.
 */
async function deleteByIds(
  sb: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<{ deleted: number; skipped: number }> {
  let deleted = 0;
  let skipped = 0;
  for (const c of chunk(ids, DELETE_CHUNK)) {
    const res = await sb.from(table).delete().in(column, c).select(column);
    if (!res.error) {
      deleted += res.data?.length ?? 0;
      continue;
    }
    for (const id of c) {
      const r = await sb.from(table).delete().eq(column, id);
      if (r.error) skipped += 1;
      else deleted += 1;
    }
  }
  return { deleted, skipped };
}

/**
 * 일괄 cleanup — 모든 QA 픽스처 row 를 전수 스윕한다 (RC#0 PROD 픽스처 누적 차단).
 *
 * 안전 불변식: **삭제 대상은 오직 QA 마커(notes/memo=MARKER) 또는 QA 이름 접두(qa-fixture-/qa-res-)
 * 를 가진 row 로만 도출**한다. 실데이터를 절대 삭제하지 않는다.
 *
 * 강화 포인트 (기존 대비):
 *  - orphan customer 스윕: seedCheckIn 이 customer INSERT 후 check_in INSERT 전 중단되면
 *    check_ins 경유로는 안 잡히는 고아 고객(memo=MARKER, name=qa-fixture-*)이 PROD 에 잔존했음.
 *    이제 customers 를 memo·name 두 키로 직접 스윕하고, 해당 고객에 매달린 종속 row 전부 정리.
 *  - 마커 누락 방어: 이름 접두 패턴(qa-fixture-/qa-res-)을 2차 키로 병행.
 */
export async function cleanupAll(): Promise<CleanupSummary> {
  const sb = svc();
  const summary: CleanupSummary = { customers: 0, checkIns: 0, packages: 0, reservations: 0, skippedCustomers: 0 };

  // ── 1) 삭제 대상 customer id 집합 도출 (마커 + 이름 접두 + check_ins 역참조) ──
  //   모든 select 는 페이지네이션 — 1000건 상한 truncate 로 신규 픽스처 누락되는 것 방지.
  const customerIds = new Set<string>();

  // 1a) check_ins(notes=MARKER) → 연결 customer
  (
    await selectAllValues(
      () => sb.from('check_ins').select('customer_id').eq('notes', MARKER) as unknown as RangeQB,
      'customer_id',
    )
  ).forEach((id) => customerIds.add(id));

  // 1b) customers(memo=MARKER) — orphan 포함
  (
    await selectAllValues(() => sb.from('customers').select('id').eq('memo', MARKER) as unknown as RangeQB, 'id')
  ).forEach((id) => customerIds.add(id));

  // 1c) customers(name ilike 'qa-fixture-%' / 'qa-res-%') — 마커 누락 방어
  for (const prefix of FIXTURE_NAME_PREFIXES) {
    (
      await selectAllValues(
        () => sb.from('customers').select('id').ilike('name', `${prefix}%`) as unknown as RangeQB,
        'id',
      )
    ).forEach((id) => customerIds.add(id));
  }

  const customerIdArr = Array.from(customerIds);

  // ── 2) customer 종속 row 삭제 (FK 역순: payments → check_ins → package_payments → packages) ──
  //   각 delete 는 deleteByIds(청크+per-id 폴백) — legacy 한 행이 배치 전체를 오염시켜
  //   신규 픽스처의 종속 row 까지 잔존하는 것을 막는다.
  for (const ids of chunk(customerIdArr, DELETE_CHUNK)) {
    const ckIds = await selectAllValues(
      () => sb.from('check_ins').select('id').in('customer_id', ids) as unknown as RangeQB,
      'id',
    );
    if (ckIds.length) {
      await deleteByIds(sb, 'payments', 'check_in_id', ckIds);
      const r = await deleteByIds(sb, 'check_ins', 'id', ckIds);
      summary.checkIns += r.deleted;
    }
    const pkgIds = await selectAllValues(
      () => sb.from('packages').select('id').in('customer_id', ids) as unknown as RangeQB,
      'id',
    );
    if (pkgIds.length) {
      await deleteByIds(sb, 'package_payments', 'package_id', pkgIds);
      const r = await deleteByIds(sb, 'packages', 'id', pkgIds);
      summary.packages += r.deleted;
    }
  }

  // ── 3) customers 삭제 — 청크 + per-id 폴백 (legacy FK 잔존행은 격리·skip, 신규 픽스처는 전수 삭제) ──
  {
    const r = await deleteByIds(sb, 'customers', 'id', customerIdArr);
    summary.customers += r.deleted;
    summary.skippedCustomers += r.skipped;
  }

  // ── 4) reservations (memo=MARKER 또는 이름 접두 qa-res-/qa-fixture-) ──
  const resIds = new Set<string>();
  (
    await selectAllValues(() => sb.from('reservations').select('id').eq('memo', MARKER) as unknown as RangeQB, 'id')
  ).forEach((id) => resIds.add(id));
  for (const prefix of FIXTURE_NAME_PREFIXES) {
    (
      await selectAllValues(
        () => sb.from('reservations').select('id').ilike('customer_name', `${prefix}%`) as unknown as RangeQB,
        'id',
      )
    ).forEach((id) => resIds.add(id));
  }
  const resIdArr = Array.from(resIds);
  if (resIdArr.length) {
    await deleteByIds(sb, 'reservation_logs', 'reservation_id', resIdArr);
    const r = await deleteByIds(sb, 'reservations', 'id', resIdArr);
    summary.reservations += r.deleted;
  }

  return summary;
}
