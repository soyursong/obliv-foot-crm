/**
 * T-20260630-dopamine-FOOTRESV-MEMO-PUSH-DROP — 예약메모 SoT 재타겟(timeline-only) + 멱등 provenance E2E
 *   (service-role DB 통합)
 *
 * DA CONSULT #3 RULING(DA-20260701-FOOTRESV-MEMO-SOT-RETARGET) 검증. 본건 delta:
 *   - 도파민 push p_memo non-empty → reservation_memo_history 에 행 기록(created_by_name='도파민TM',
 *     source_system=p_source_system). ★ reservations.memo 매핑 제거(deprecated, FE 미read).
 *   - 멱등: (reservation_id, source_system) partial unique → 재push=in-place upsert(누적 0).
 *   - 편집 재push=동일행 content 갱신(신규행 0). 빈값 재push=no-op(timeline 불변·보존).
 *   - 사람 저작 행(source_system NULL)=멱등 인덱스 제외=append-only 보존.
 *   - clinic_id=v_clinic_id ★critical (RLS rmh_clinic_access 가시성).
 *
 * 왜 DB 통합 spec: 메모 인입 경로 = 도파민 push → upsert_reservation_from_source RPC(계약 표준 진입점).
 *   FE 표시부(ReservationDetailPopup <ReservationMemoTimeline>)는 reservation_memo_history read →
 *   결정론 검증 대상 = RPC 가 그 테이블에 멱등 기록하는가.
 *
 * 격리: source_system='e2e-memo-push' 마커(prod 'dopamine' 무영향, callback 미발화). before/after purge.
 * 사전조건(graceful skip): 본 마이그(20260701020000) 미적용(rmh.source_system 컬럼 부재) → 명시 skip(배포 前 GREEN-or-SKIP).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SRC = 'e2e-memo-push';                 // 외부 sync 모사 마커(prod 'dopamine' 격리)
const CLINIC_SLUG = 'jongno-foot';
const CUE = 'c3d4e5f6-0000-4000-8000-00000000ma01';
const EXT = `${CUE}-resv`;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}
async function purge() {
  if (!SERVICE_KEY) return;
  const sb = admin();
  // reservation FK ON DELETE CASCADE → memo history 동반 삭제
  await sb.from('reservations').delete().eq('source_system', SRC);
}
async function callUpsert(sb: SupabaseClient, memo: string | null) {
  return sb.rpc('upsert_reservation_from_source', {
    p_source_system: SRC, p_external_id: EXT, p_clinic_slug: CLINIC_SLUG,
    p_customer_phone: '01099990000', p_customer_name: '메모펑크',
    p_reservation_date: '2099-02-02', p_reservation_time: '10:00',
    p_memo: memo, p_status: 'confirmed', p_visit_type: 'new', p_created_via: 'dopamine',
  });
}
async function resvId(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.from('reservations').select('id,clinic_id')
    .eq('source_system', SRC).eq('external_id', EXT).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
async function memoRows(sb: SupabaseClient, rid: string, dopamineOnly = true) {
  let qb = sb.from('reservation_memo_history')
    .select('content,created_by_name,source_system,clinic_id').eq('reservation_id', rid);
  qb = dopamineOnly ? qb.eq('source_system', SRC) : qb.is('source_system', null);
  const { data } = await qb;
  return (data ?? []) as { content: string; created_by_name: string | null; source_system: string | null; clinic_id: string }[];
}

/** 본 마이그 적용 여부 — rmh.source_system 컬럼 + RPC timeline 기록. 미적용 → skip 사유. */
async function migrationReady(): Promise<string | null> {
  if (!SERVICE_KEY) return 'SERVICE_ROLE_KEY 부재 — DB 통합 검증 skip';
  const sb = admin();
  const { error } = await sb.from('reservation_memo_history').select('source_system').limit(1);
  if (error && /source_system|column/i.test(error.message)) {
    return `본 마이그(20260701020000) 미적용 — rmh.source_system 컬럼 부재: ${error.message}`;
  }
  return null;
}

test.describe('FOOTRESV-MEMO-PUSH-DROP — 예약메모 timeline 재타겟 + 멱등', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test('AC-1: push 메모 → reservation_memo_history 행(도파민TM) 노출 + clinic_id 결선', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();

    const { error } = await callUpsert(sb, '메모A');
    expect(error).toBeNull();
    const rid = await resvId(sb);
    expect(rid).not.toBeNull();

    const rows = await memoRows(sb, rid!);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('메모A');
    expect(rows[0].created_by_name).toBe('도파민TM');     // Q3a 표시 라벨
    expect(rows[0].source_system).toBe(SRC);              // 머신 provenance/멱등키

    // clinic_id ★critical: timeline 행 clinic_id == reservation clinic_id
    const { data: r } = await sb.from('reservations').select('clinic_id').eq('id', rid!).single();
    expect(rows[0].clinic_id).toBe((r as { clinic_id: string }).clinic_id);
  });

  test('AC-6 멱등: 동일 메모 재push x2 → 도파민 행 1개 유지(누적 0)', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    await callUpsert(sb, '메모A');               // 재push 1
    await callUpsert(sb, '메모A');               // 재push 2
    const rid = await resvId(sb);
    const rows = await memoRows(sb, rid!);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('메모A');
  });

  test('시나리오5 편집 재push: "메모B"로 편집 → 동일행 content 갱신(메모A 잔존 0·신규행 0)', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    await callUpsert(sb, '메모B');
    const rid = await resvId(sb);
    const rows = await memoRows(sb, rid!);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('메모B');
    expect(rows.some(r => r.content === '메모A')).toBe(false);
  });

  test('AC-2 빈값 재push = no-op(timeline 불변·기존 외부 memo 보존)', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    await callUpsert(sb, '');                    // 빈값
    await callUpsert(sb, '   ');                 // 공백 only(btrim → 빈)
    await callUpsert(sb, null);                  // NULL
    const rid = await resvId(sb);
    const rows = await memoRows(sb, rid!);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('메모B');       // 직전 외부 memo 보존(삭제 불가)
  });

  test('사람 저작 행(source_system NULL) append-only 보존 — 멱등 인덱스 미적용', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();
    const rid = await resvId(sb);
    const { data: r } = await sb.from('reservations').select('clinic_id').eq('id', rid!).single();
    const cid = (r as { clinic_id: string }).clinic_id;
    // 사람메모 2건 직접 insert (동일 reservation) — NULL source → partial unique 미발화 → 2행 공존
    await sb.from('reservation_memo_history').insert([
      { reservation_id: rid, clinic_id: cid, content: '사람메모1', created_by_name: '직원' },
      { reservation_id: rid, clinic_id: cid, content: '사람메모2', created_by_name: '직원' },
    ]);
    const human = await memoRows(sb, rid!, false);
    expect(human).toHaveLength(2);               // append-only 보존
    // 도파민 행은 여전히 1개(영향 0)
    const dop = await memoRows(sb, rid!);
    expect(dop).toHaveLength(1);
  });
});
