/**
 * T-20260629-foot-NOSHOW-CANONICAL
 * reservations.status 값 통일: 'noshow' → 'no_show' (canonical=no_show, 대표 결정).
 *
 * 검증 불변식 (마이그 20260629150000 적용 후 PASS):
 *   AC-1) 백필 완료 — reservations 중 status='noshow' 0행.
 *   AC-2) CHECK 제약 — 'no_show' 허용 / 'noshow' 거부(write 차단).
 *   AC-3) foot-022 체크인 차단 트리거 — status='no_show' 예약은 체크인 INSERT 거부.
 *   AC-4) foot_stats_noshow_returning RPC — no_show 예약을 노쇼율 분자에 집계.
 *
 * ⚠️ 스코프 가드: notification event_type 'noshow'(send-notification EF)는 별개 도메인 → 본 스펙 비대상.
 *
 * 전제: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env. 마이그 선적용.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { CLINIC_ID, seedReservation } from '../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('T-20260629-foot-NOSHOW-CANONICAL', () => {
  test('AC-1: reservations 잔존 noshow 0행 (백필 완료)', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { count, error } = await sb
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'noshow');
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);
  });

  test('AC-2: CHECK 제약 — no_show 허용 / noshow 거부', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const res = await seedReservation({ time: '15:00' });
    try {
      // no_show 로 전이 가능해야 함
      const { data: ok, error: okErr } = await sb
        .from('reservations')
        .update({ status: 'no_show' })
        .eq('id', res.id)
        .select('status');
      expect(okErr).toBeNull();
      expect(ok?.[0]?.status).toBe('no_show');

      // 레거시 'noshow' write 는 CHECK 위반으로 거부되어야 함
      const { error: badErr } = await sb
        .from('reservations')
        .update({ status: 'noshow' })
        .eq('id', res.id);
      expect(badErr).not.toBeNull();
    } finally {
      await res.cleanup();
    }
  });

  test('AC-3: foot-022 — no_show 예약 체크인 INSERT 거부', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const res = await seedReservation({ time: '16:00' });
    try {
      await sb.from('reservations').update({ status: 'no_show' }).eq('id', res.id);
      const { error } = await sb.from('check_ins').insert({
        clinic_id: CLINIC_ID,
        reservation_id: res.id,
        visit_type: 'new',
      });
      // check_reservation_status 트리거가 EXCEPTION → INSERT 실패
      expect(error).not.toBeNull();
    } finally {
      await sb.from('check_ins').delete().eq('reservation_id', res.id);
      await res.cleanup();
    }
  });

  test('AC-4: foot_stats_noshow_returning — no_show 를 노쇼율 분자에 집계', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await seedReservation({ date: day, time: '17:00' });
    try {
      await sb.from('reservations').update({ status: 'no_show' }).eq('id', res.id);
      const { data, error } = await sb.rpc('foot_stats_noshow_returning', {
        p_clinic_id: CLINIC_ID,
        p_from: day,
        p_to: day,
      });
      expect(error).toBeNull();
      const row = (data as Array<{ dt: string; noshow_rate: number }> | null)?.find(
        (r) => r.dt === day,
      );
      // 당일 no_show 1건 이상 존재 → 노쇼율 분자 반영(>0)
      expect((row?.noshow_rate ?? 0)).toBeGreaterThan(0);
    } finally {
      await res.cleanup();
    }
  });
});
