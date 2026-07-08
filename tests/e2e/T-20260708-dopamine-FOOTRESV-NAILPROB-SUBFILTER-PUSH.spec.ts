/**
 * T-20260708-dopamine-FOOTRESV-NAILPROB-SUBFILTER-PUSH — 문제성발톱 간략메모(brief_note) 배선 E2E
 *
 * ── 문제(4번 미반영) ─────────────────────────────────────────────────────────
 *   도파민 CTI 측(문제성발톱=발톱무좀/내성발톱 등 선택 UI + push payload reservation.brief_note 동봉)
 *   은 배포 완료(commit 66d661d, 3번 정상). 그러나 풋CRM 수신부(ingest EF + upsert RPC)가
 *   brief_note 를 읽지 않아 풋 예약상세 팝업>간략메모(reservations.brief_note read SoT)에서 공란.
 *   → 박민지 팀장 현장 확인: 3번 정상 / 4번 미반영.
 *
 * ── 본건 delta(수신부 배선, ADDITIVE·스키마 무변경) ──────────────────────────
 *   - ingest EF(실 push 경로): reservation.brief_note 추출 →
 *       (a) 신규 INSERT 경로 rsvPayload.brief_note (첫 push 실 write-path) 착지.
 *       (b) edit/reschedule RPC 경로 p_brief_note 전달.
 *   - upsert_reservation_from_source RPC: p_brief_note 18th(末尾) param.
 *       INSERT brief_note = NULLIF(btrim(p_brief_note),'').
 *       ON CONFLICT DO UPDATE brief_note = COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note).
 *   - reservations.brief_note = 旣존 컬럼(20260624100000). 예약메모(rmh timeline)와 직교 독립 축.
 *
 * ── 왜 EF HTTP 통합 spec ─────────────────────────────────────────────────────
 *   결정론 검증 대상 = "실 push 경로(EF)가 reservations.brief_note 에 기록하는가".
 *   FE 표시부(ReservationDetailPopup <간략메모> = reservation.brief_note read)는 旣존 확정.
 *
 * 격리: source_system='e2e-nailprob-subfilter' 마커(prod 'dopamine' 무영향). before/after purge.
 * 사전조건(GREEN-or-SKIP): DOPAMINE_CALLBACK_SECRET / SERVICE_ROLE_KEY 미주입 → 명시 skip.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CALLBACK_SECRET = process.env.DOPAMINE_CALLBACK_SECRET ?? '';
const EF_URL = `${SUPABASE_URL}/functions/v1/reservation-ingest-from-dopamine`;

const SRC = 'e2e-nailprob-subfilter';        // 외부 sync 모사 마커(prod 'dopamine' 격리)
const CLINIC_SLUG = 'jongno-foot';
const CUE = 'c3d4e5f6-0000-4000-8000-00000nailp01';
const EXT = `${CUE}-resv`;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}
async function purge() {
  if (!SERVICE_KEY) return;
  await admin().from('reservations').delete().eq('source_system', SRC);
}
/** 실 push = 배포된 ingest EF 를 HTTP 로 호출(도파민 계약 진입점). briefNote=null → 키 미동봉. */
async function pushViaEF(briefNote: string | null, opts?: { scheduledAt?: string; status?: string }) {
  const res = await fetch(EF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Callback-Secret': CALLBACK_SECRET },
    body: JSON.stringify({
      source_system: SRC,
      external_id: EXT,
      clinic_slug: CLINIC_SLUG,
      customer: { phone_e164: '+821099990708', name: '문제성발톱' },
      reservation: {
        scheduled_at: opts?.scheduledAt ?? '2099-03-03T10:00:00+09:00',
        slot_type: 'new_consult',
        ...(briefNote !== null ? { brief_note: briefNote } : {}),
        ...(opts?.status ? { status: opts.status } : {}),
        registrar_name: '진운선',
      },
    }),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
async function resvRow(sb: SupabaseClient) {
  const { data } = await sb.from('reservations').select('id,clinic_id,brief_note,reservation_date,reservation_time')
    .eq('source_system', SRC).eq('external_id', EXT).maybeSingle();
  return data as { id: string; clinic_id: string; brief_note: string | null; reservation_date: string; reservation_time: string } | null;
}

const CAN_RUN = !!SERVICE_KEY && !!CALLBACK_SECRET;

test.describe('T-20260708 FOOTRESV-NAILPROB-SUBFILTER-PUSH — 문제성발톱 brief_note 배선', () => {
  test.skip(!CAN_RUN, 'SERVICE_ROLE_KEY / DOPAMINE_CALLBACK_SECRET 미주입 → GREEN-or-SKIP');
  test.beforeEach(purge);
  test.afterEach(purge);

  test('S1 신규 push(brief_note=발톱무좀) → reservations.brief_note 착지(실 INSERT 경로)', async () => {
    const r = await pushViaEF('발톱무좀');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const resv = await resvRow(admin());
    expect(resv).not.toBeNull();
    expect(resv!.brief_note).toBe('발톱무좀');   // ★ 4번 반영(예약상세 간략메모 read SoT)
  });

  test('S2 빈값 가드: brief_note 미동봉/공백 → NULL(회귀 0, 오염 없음)', async () => {
    const r1 = await pushViaEF(null);            // 키 미동봉
    expect(r1.status).toBe(200);
    let resv = await resvRow(admin());
    expect(resv).not.toBeNull();
    expect(resv!.brief_note == null || resv!.brief_note === '').toBeTruthy();
  });

  test('S3 편집 재push 갱신 + 빈값 재push COALESCE 보존', async () => {
    // 1) 신규
    await pushViaEF('발톱무좀');
    const sb = admin();
    let resv = await resvRow(sb);
    expect(resv!.brief_note).toBe('발톱무좀');

    // 2) 리스케줄 + brief_note 편집(다른 시간 → EF edit RPC 경로 라우팅) → 갱신
    const re = await pushViaEF('내성발톱', { scheduledAt: '2099-03-04T11:00:00+09:00' });
    expect(re.status).toBe(200);
    resv = await resvRow(sb);
    expect(resv!.brief_note).toBe('내성발톱');   // ON CONFLICT non-empty → 갱신

    // 3) 빈값 재push(동일시간, 순수 재push) → COALESCE 보존(불변)
    const rk = await pushViaEF('   ', { scheduledAt: '2099-03-04T11:00:00+09:00' });
    expect(rk.status).toBe(200);
    resv = await resvRow(sb);
    expect(resv!.brief_note).toBe('내성발톱');   // 빈값=기존 보존(no-op)
  });

  test('S4 순수 재push(시간 무변경) brief_note 뒤늦은 추가 → duplicate 분기에서도 반영', async () => {
    // 1) brief_note 없이 신규 예약
    await pushViaEF(null);
    const sb = admin();
    let resv = await resvRow(sb);
    expect(resv!.brief_note == null || resv!.brief_note === '').toBeTruthy();
    // 2) 동일 시간 재push + 문제성발톱 뒤늦게 추가(취소·리스케줄 아님 = duplicate 분기)
    const r = await pushViaEF('발톱무좀');   // 기본 scheduledAt 동일
    expect(r.status).toBe(200);
    expect(r.body.reason).toBe('duplicate');   // guard#2 멱등 유지
    resv = await resvRow(sb);
    expect(resv!.brief_note).toBe('발톱무좀');   // ★ duplicate 분기도 brief_note 반영(4번 재발 차단)
  });
});
