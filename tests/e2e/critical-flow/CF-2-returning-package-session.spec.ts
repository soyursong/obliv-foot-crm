/**
 * T3 Critical Flow CF-2 — 재진 환자 + 패키지 회차 사용 (T-foot-qa-002)
 *
 * 시나리오:
 *   1. 재진 customer 시드 + active 패키지 (12회) 시드
 *   2. check_in 등록 (status=registered, package_id=pkg)
 *   3. 단계 전환 → treatment
 *   4. package_sessions INSERT (1회차 사용)
 *   5. status=done
 *   6. 사용 회차 = 1 검증
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { CLINIC_ID, seedCheckIn, seedPackage } from '../../fixtures';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('CF-2 재진 환자 + 패키지 회차 사용', () => {
  test('풀 사이클: 재진 등록 → 패키지 연결 → 시술 → 회차 차감', async () => {
    // 1) 재진 customer + check_in 시드
    const ck = await seedCheckIn({
      status: 'registered',
      visit_type: 'returning',
      name: `cf2-ret-${Date.now()}`,
    });

    let pkgId: string | null = null;
    try {
      // 2) 패키지 시드 + check_in.package_id 연결
      const pkg = await seedPackage({ customerId: ck.customerId });
      pkgId = pkg.id;
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      await sb.from('check_ins').update({ package_id: pkgId }).eq('id', ck.id);

      // 3) 단계 전환 (registered → treatment_waiting → treatment)
      await sb.from('check_ins').update({ status: 'treatment_waiting' }).eq('id', ck.id);
      await sb
        .from('check_ins')
        .update({ status: 'treatment', treatment_room: '치료실1' })
        .eq('id', ck.id);

      // 4) package_sessions INSERT (1회차 사용 - heated)
      const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: sessRow, error: sessErr } = await sb
        .from('package_sessions')
        .insert({
          package_id: pkgId,
          check_in_id: ck.id,
          session_number: 1,
          session_type: 'heated_laser',
          session_date: today,
          status: 'used',
          memo: 'CF-2 1회차',
        })
        .select('id, session_number, session_type')
        .single();
      expect(sessErr).toBeNull();
      expect(sessRow?.session_number).toBe(1);
      expect(sessRow?.session_type).toBe('heated_laser');

      // 5) status=done
      await sb
        .from('check_ins')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', ck.id);

      // 6) 사용 회차 카운트
      const { count } = await sb
        .from('package_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('package_id', pkgId);
      console.log(`패키지 ${pkgId} 사용 회차:`, count);
      expect(count).toBe(1);

      // 추가 검증: check_in.package_id 정합
      const { data: ciRow } = await sb
        .from('check_ins')
        .select('status, package_id')
        .eq('id', ck.id)
        .single();
      expect(ciRow?.status).toBe('done');
      expect(ciRow?.package_id).toBe(pkgId);
    } finally {
      // cleanup
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      if (pkgId) {
        await sb.from('package_sessions').delete().eq('package_id', pkgId);
        await sb.from('package_payments').delete().eq('package_id', pkgId);
        await sb.from('packages').delete().eq('id', pkgId);
      }
      await ck.cleanup();
    }
  });

  test('패키지 잔여 회차 계산 (12회 - 사용 1회 = 11)', async () => {
    const ck = await seedCheckIn({
      status: 'treatment',
      visit_type: 'returning',
      name: `cf2-rem-${Date.now()}`,
    });
    let pkgId: string | null = null;
    try {
      const pkg = await seedPackage({ customerId: ck.customerId });
      pkgId = pkg.id;
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      await sb.from('check_ins').update({ package_id: pkgId }).eq('id', ck.id);

      const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      await sb.from('package_sessions').insert({
        package_id: pkgId,
        check_in_id: ck.id,
        session_number: 1,
        session_type: 'heated_laser',
        session_date: today,
        status: 'used',
      });

      const { data: pkgRow } = await sb
        .from('packages')
        .select('total_sessions')
        .eq('id', pkgId)
        .single();
      const { count } = await sb
        .from('package_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('package_id', pkgId);
      const remaining = (pkgRow?.total_sessions ?? 0) - (count ?? 0);
      console.log(`잔여 회차: ${pkgRow?.total_sessions} - ${count} = ${remaining}`);
      expect(remaining).toBe(11);
    } finally {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      if (pkgId) {
        await sb.from('package_sessions').delete().eq('package_id', pkgId);
        await sb.from('package_payments').delete().eq('package_id', pkgId);
        await sb.from('packages').delete().eq('id', pkgId);
      }
      await ck.cleanup();
    }
  });
});
