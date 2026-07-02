/**
 * T-20260702-dopamine-FOOTRESV-MEMO-REPROBE — 도파민 예약메모 SoT 정렬 E2E (ingest EF 실경로 통합)
 *
 * ── 근본원인(런타임 규명) ─────────────────────────────────────────────────────
 *   도파민→풋 예약 실 push 경로 = Edge Function `reservation-ingest-from-dopamine`
 *   (직접 .from('reservations').insert). 이 EF 가 memo 를 reservations.memo(deprecated, FE 미read)
 *   에만 착지시켜, 풋 예약상세 팝업>예약메모 · 달력 hover(CustomerHoverCard) — 둘 다 rmh
 *   (reservation_memo_history=예약메모 SoT)를 read — 에서 공란이었다.
 *   재타겟 RPC(upsert_reservation_from_source, 55f3f62d)는 rmh 에 쓰지만 이 실 push 경로에서
 *   미호출(직접 insert) → 7/1 02:00 RPC 재타겟이 실 push 에 무효과.
 *
 * ── 본건 delta(EF 에 DA-20260701-FOOTRESV-MEMO-SOT-RETARGET ruling 동일 적용) ──
 *   - memo → reservations.memo 매핑 제거(timeline-only, deprecated 미write).
 *   - memo non-empty → rmh 착지(created_by_name='도파민TM', source_system=payload.source_system,
 *     clinic_id=v_clinic_id ★RLS rmh_clinic_access 가시성).
 *   - 멱등: (reservation_id, source_system) partial unique(uq_rmh_resv_source) → select→update|insert
 *     로 재push=in-place 갱신(누적 0). supabase-js .upsert 는 partial index 술어 미표현→미사용.
 *   - 빈메모 재push=no-op(timeline 불변). 사람 저작 행(source_system NULL)=append-only 보존.
 *   - 스키마 무변경(source_system 컬럼·uq_rmh_resv_source = 마이그 20260701020000 旣존).
 *
 * ── 왜 EF HTTP 통합 spec ─────────────────────────────────────────────────────
 *   결정론 검증 대상 = "실 push 경로(EF)가 rmh 에 기록하는가 / reservations.memo 를 비우는가".
 *   FE 표시부(ReservationMemoTimeline · CustomerHoverCard resvMemoMap)는 rmh read 확정(旣존).
 *
 * 격리: source_system='e2e-memo-reprobe' 마커(prod 'dopamine' 무영향). before/after purge.
 * 사전조건(GREEN-or-SKIP): DOPAMINE_CALLBACK_SECRET / SERVICE_ROLE_KEY 미주입 → 명시 skip.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CALLBACK_SECRET = process.env.DOPAMINE_CALLBACK_SECRET ?? '';
const EF_URL = `${SUPABASE_URL}/functions/v1/reservation-ingest-from-dopamine`;

const SRC = 'e2e-memo-reprobe';              // 외부 sync 모사 마커(prod 'dopamine' 격리)
const CLINIC_SLUG = 'jongno-foot';
const CUE = 'c3d4e5f6-0000-4000-8000-0000000repr1';
const EXT = `${CUE}-resv`;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}
async function purge() {
  if (!SERVICE_KEY) return;
  // reservations FK ON DELETE CASCADE → rmh 동반 삭제
  await admin().from('reservations').delete().eq('source_system', SRC);
}
/** 실 push = 배포된 ingest EF 를 HTTP 로 호출(도파민 계약 진입점). */
async function pushViaEF(memo: string | null) {
  const res = await fetch(EF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Callback-Secret': CALLBACK_SECRET },
    body: JSON.stringify({
      source_system: SRC,
      external_id: EXT,
      clinic_slug: CLINIC_SLUG,
      customer: { phone_e164: '+821099990001', name: '메모리프로브' },
      reservation: {
        scheduled_at: '2099-03-03T10:00:00+09:00',
        slot_type: 'new_consult',
        ...(memo !== null ? { memo } : {}),
        registrar_name: '진운선',
      },
    }),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
async function resvRow(sb: SupabaseClient) {
  const { data } = await sb.from('reservations').select('id,clinic_id,memo')
    .eq('source_system', SRC).eq('external_id', EXT).maybeSingle();
  return data as { id: string; clinic_id: string; memo: string | null } | null;
}
async function memoRows(sb: SupabaseClient, rid: string, dopamineOnly = true) {
  let qb = sb.from('reservation_memo_history')
    .select('content,created_by_name,source_system,clinic_id').eq('reservation_id', rid);
  qb = dopamineOnly ? qb.eq('source_system', SRC) : qb.is('source_system', null);
  const { data } = await qb;
  return (data ?? []) as { content: string; created_by_name: string | null; source_system: string | null; clinic_id: string }[];
}

const CAN_RUN = !!SERVICE_KEY && !!CALLBACK_SECRET;

test.describe('T-20260702 FOOTRESV-MEMO-REPROBE — ingest EF 예약메모 SoT 정렬', () => {
  test.skip(!CAN_RUN, 'SERVICE_ROLE_KEY / DOPAMINE_CALLBACK_SECRET 미주입 → GREEN-or-SKIP');
  test.beforeEach(purge);
  test.afterEach(purge);

  test('S1 표시복구: memo push → rmh 착지(도파민TM/marker/clinic_id) + reservations.memo 공란', async () => {
    const r = await pushViaEF('도파민 상담메모 A');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const sb = admin();
    const resv = await resvRow(sb);
    expect(resv).not.toBeNull();
    // ★ timeline-only: reservations.memo 미write(deprecated). FE 는 rmh read.
    expect(resv!.memo == null || resv!.memo === '').toBeTruthy();
    const rows = await memoRows(sb, resv!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('도파민 상담메모 A');
    expect(rows[0].created_by_name).toBe('도파민TM');
    expect(rows[0].source_system).toBe(SRC);
    expect(rows[0].clinic_id).toBe(resv!.clinic_id);  // ★ RLS 가시성
  });

  test('S2 빈메모 가드: 빈 memo push → rmh 도파민행 0(no-op)', async () => {
    const r = await pushViaEF('   ');   // btrim 후 빈값
    expect(r.status).toBe(200);
    const sb = admin();
    const resv = await resvRow(sb);
    expect(resv).not.toBeNull();
    expect(await memoRows(sb, resv!.id)).toHaveLength(0);
  });

  test('S3 멱등 + 구데이터/사람행 보존: 편집 재push=in-place 갱신, 사람행 append-only 보존', async () => {
    // 1) 최초 push
    await pushViaEF('최초메모');
    const sb = admin();
    const resv = await resvRow(sb);
    expect(resv).not.toBeNull();
    const rid = resv!.id;

    // 2) 사람 저작 행 직접 삽입(source_system NULL = 멱등 인덱스 제외 = 보존 대상)
    await sb.from('reservation_memo_history').insert({
      reservation_id: rid, clinic_id: resv!.clinic_id, content: '사람이 쓴 메모', created_by_name: '데스크',
    });

    // 3) 편집 재push(중복 external_id → EF duplicate 분기에서도 rmh 멱등 upsert)
    const re = await pushViaEF('수정된메모');
    expect(re.status).toBe(200);

    // 도파민행: 신규행 0, content in-place 갱신
    const dopa = await memoRows(sb, rid, true);
    expect(dopa).toHaveLength(1);
    expect(dopa[0].content).toBe('수정된메모');
    // 사람행: 보존(append-only)
    const human = await memoRows(sb, rid, false);
    expect(human).toHaveLength(1);
    expect(human[0].content).toBe('사람이 쓴 메모');
  });
});
