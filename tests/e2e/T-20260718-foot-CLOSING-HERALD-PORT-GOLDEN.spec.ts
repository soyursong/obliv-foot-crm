/**
 * E2E spec — T-20260718-foot-CLOSING-HERALD-PORT-GOLDEN
 * 발톱 매출마감 전령 발행체인 (골든레퍼런스 Wave 1) — 발행측 emit 불변식 검증.
 *
 * 성격: 백엔드(트리거/워커/EF, shadow 모드) 발행체인. 현장 클릭 = 마감확정(open→closed).
 *   클릭 후 발생하는 서버측 불변식을 service_role 클라이언트로 검증(DB-driven E2E).
 *   ⚠ dev DB(rxlomoozakkjesdqjtvd) 전용. throwaway clinic/daily_closing 생성 후 afterAll 정리.
 *
 * 시나리오 1 (정상 발행 동선, shadow):
 *   AC1-1: daily_closings draft(open) → 마감확정(closed) 시 revision=0 세팅(트리거 강제)
 *   AC1-2: closing_confirmed_outbox 에 status=pending 행 INSERT + clinic_slug 세팅(★HARD-DROP 방지)
 *   AC1-3: payload-time INV self-test — split_source 통과 시 schema_version=2 + revenue_ad+revenue_organic=total_amount_krw (INV1)
 *   AC1-4: split_insurance 존재 시 rev_copay_self+rev_noninsurance=total_amount_krw (INV2) · rev_insurance_covered>=0 total밖 (INV3) · 각 split>=0 (INV4)
 *   AC1-5: (shadow) worker 호출 → claimed=0(dispatch 보류), outbox status=pending 유지
 * 시나리오 2 (엣지):
 *   AC2-1: clinic_slug 필수 — outbox.clinic_slug NOT NULL(수신기 HARD-DROP 재현 방지)
 *   AC2-2: 재확정(직전 해제 이력) → revision=+1, 신규 outbox 행 superseded=true
 * 시나리오 3 (Q6 preflight):
 *   AC3-1: foot_closing_herald_preflight() hard_gate_pass=true (slug 실재)
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const hasDb = !!(SUPABASE_URL && SERVICE_KEY);

// throwaway 식별자 (충돌 방지)
const TAG = `herald_e2e_${Date.now()}`;
const TEST_SLUG = `${TAG}-foot`;
const TEST_DATE = '2026-07-18';

let sb: SupabaseClient;
let clinicId: string | null = null;

test.describe('T-20260718 CLOSING-HERALD — 발행체인 emit 불변식', () => {
  test.skip(!hasDb, 'SUPABASE_URL/SERVICE_ROLE_KEY 미설정 — DB-driven spec skip');

  test.beforeAll(async () => {
    sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    // throwaway clinic (slug UNIQUE — 채널맵과 무관한 테스트 slug)
    const { data, error } = await sb
      .from('clinics')
      .insert({ name: `[E2E] ${TAG}`, slug: TEST_SLUG })
      .select('id')
      .single();
    if (error) throw new Error(`clinic seed 실패: ${error.message}`);
    clinicId = data.id;
  });

  test.afterAll(async () => {
    if (!sb || !clinicId) return;
    // 역순 정리 (outbox → daily_closings → clinic)
    await sb.from('closing_confirmed_outbox').delete().eq('clinic_id', clinicId);
    await sb.from('daily_closings').delete().eq('clinic_id', clinicId);
    await sb.from('clinics').delete().eq('id', clinicId);
  });

  test('AC1: 마감확정(open→closed) → revision=0 + outbox pending + INV self-test', async () => {
    // draft(open) 생성 — 실수납 버킷 세팅
    const { error: insErr } = await sb.from('daily_closings').insert({
      clinic_id: clinicId,
      close_date: TEST_DATE,
      status: 'open',
      actual_card_total: 0,
      actual_cash_total: 0,
      actual_transfer_total: 0,
      difference: 0,
    });
    expect(insErr, insErr?.message).toBeNull();

    // 마감확정: open → closed (현장 "마감확정" 클릭 등가)
    const { data: closed, error: updErr } = await sb
      .from('daily_closings')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('close_date', TEST_DATE)
      .select('revision, status')
      .single();
    expect(updErr, updErr?.message).toBeNull();

    // AC1-1: revision=0 (최초 확정, 트리거 강제)
    expect(closed!.status).toBe('closed');
    expect(closed!.revision).toBe(0);

    // AC1-2: outbox pending + clinic_slug 세팅
    const { data: box } = await sb
      .from('closing_confirmed_outbox')
      .select('status, clinic_slug, revision, superseded, payload')
      .eq('clinic_id', clinicId)
      .eq('close_date', TEST_DATE)
      .eq('revision', 0)
      .single();
    expect(box).toBeTruthy();
    expect(box!.status).toBe('pending');
    expect(box!.clinic_slug).toBe(TEST_SLUG);          // ★HARD-DROP 방지
    expect(box!.superseded).toBe(false);

    // payload 기본 필드
    const p = box!.payload as any;
    expect(p.clinic_slug).toBe(TEST_SLUG);              // top-level 필수
    expect(p.source_system).toBe('foot');
    expect(p.close_date).toBe(TEST_DATE);
    expect(p.totals).toBeTruthy();
    expect(p.totals.other).toBe(0);                     // foot: other 버킷 없음 → 0

    // AC1-3: INV1 (split_source 통과 시 schema_version=2, ad+organic=total)
    if (p.schema_version === 2 && p.split_source) {
      const ad = p.split_source.revenue_ad ?? 0;
      const org = p.split_source.revenue_organic ?? 0;
      expect(ad + org).toBe(p.total_amount_krw);         // INV1
      expect(ad).toBeGreaterThanOrEqual(0);              // INV4
      expect(org).toBeGreaterThanOrEqual(0);             // INV4

      // AC1-4: INV2/INV3 (split_insurance 존재 시)
      if (p.split_insurance) {
        const copay = p.split_insurance.rev_copay_self ?? 0;
        const nonins = p.split_insurance.rev_noninsurance ?? 0;
        const covered = p.split_insurance.rev_insurance_covered ?? 0;
        expect(copay + nonins).toBe(p.total_amount_krw); // INV2 (S partition)
        expect(covered).toBeGreaterThanOrEqual(0);       // INV3 (>=0, total 밖)
        expect(copay).toBeGreaterThanOrEqual(0);         // INV4
        expect(nonins).toBeGreaterThanOrEqual(0);        // INV4
        // INV3: covered 는 total 에 미합산(청구 grain)
        expect(p.total_amount_krw).toBe(ad + org);
      }
    }
    // month 블록(graceful) — 있으면 is_projection 라벨
    if (p.month) {
      expect(p.month.is_projection).toBe(true);
      expect(typeof p.month.partial_month).toBe('boolean'); // Q7 부분월 라벨
    }
    // kpi 는 off 기본(Q7) → 미방출
    expect(p.kpi).toBeUndefined();
  });

  test('AC1-5: shadow 모드 — worker claim=0 (dispatch 보류), status pending 유지', async () => {
    // config 는 기본 shadow. worker 직접 호출.
    const { data: cfg } = await sb
      .from('closing_confirmed_config')
      .select('mode')
      .eq('id', true)
      .single();
    expect(cfg!.mode).toBe('shadow');

    const { data: res, error } = await sb.rpc('process_closing_confirmed_outbox');
    expect(error, error?.message).toBeNull();
    expect((res as any).mode).toBe('shadow');
    expect((res as any).claimed).toBe(0);              // shadow — no dispatch

    const { data: box } = await sb
      .from('closing_confirmed_outbox')
      .select('status')
      .eq('clinic_id', clinicId)
      .eq('revision', 0)
      .single();
    expect(box!.status).toBe('pending');               // 미발송 유지
  });

  test('AC2-2: 재확정(해제→재확정) → revision=+1 + 신규 outbox superseded=true', async () => {
    // 해제: closed → open + unconfirmed_at 기록(다음 재확정을 +1 로 감지)
    await sb
      .from('daily_closings')
      .update({ status: 'open', unconfirmed_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('close_date', TEST_DATE);

    // 재확정: open → closed
    const { data: recl } = await sb
      .from('daily_closings')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('close_date', TEST_DATE)
      .select('revision')
      .single();
    expect(recl!.revision).toBe(1);                    // 재확정 → +1

    // 신규 revision=1 outbox 행 superseded=true
    const { data: box2 } = await sb
      .from('closing_confirmed_outbox')
      .select('status, superseded, revision')
      .eq('clinic_id', clinicId)
      .eq('close_date', TEST_DATE)
      .eq('revision', 1)
      .single();
    expect(box2).toBeTruthy();
    expect(box2!.revision).toBe(1);
    expect(box2!.superseded).toBe(true);
  });

  test('AC3-1: Q6 preflight — hard_gate_pass=true (slug 실재)', async () => {
    const { data: pf, error } = await sb.rpc('foot_closing_herald_preflight');
    expect(error, error?.message).toBeNull();
    expect((pf as any).hard_gate_pass).toBe(true);
    // 실 slug 'jongno-foot' 이 채널맵 expected 에 존재
    expect((pf as any).expected_channel_map).toContain('jongno-foot');
  });
});
