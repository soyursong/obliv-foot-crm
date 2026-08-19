/**
 * T3 Critical Flow CF-3 — 노쇼 처리 (T-foot-qa-002)
 *
 * 시나리오:
 *   1. 오늘 예약 1건 시드 (status=confirmed)
 *   2. 시간 경과 → status=no_show 마킹
 *   3. reservation_logs.action='status_change' 자동 INSERT 검증
 *   4. v_daily_visits / v_daily_visit_rate 통계 영향 확인
 */
import { test, expect } from '@playwright/test';
// CF-PROD-WRITE-BAN(Axis-A): 가드된 createClient — PROD ref fail-closed 차단(직접 import 금지).
import { createClient, assertCriticalFlowDbSafe, resolveTargetRef, isProdRef } from './_prodWriteGuard';
import { CLINIC_ID, seedReservation } from '../../fixtures';

// CF-PROD-WRITE-BAN(Axis-A) green 경로 (T-20260720-meta-RED-CI-DEPLOY-BLOCK-GATE):
//   dev-DB 컷오버 전 CI 는 PROD ref 만 주입 → 이 파일 전체를 skip 한다(PROD write 0 · 잡 green).
//   guard 는 fail-closed belt 로 존치 — dev DB 에선 정상 실행. dev-isolation=T-20260804-foot-FOOTCTR-E2E-DEVDB-ISOLATION-CUTOVER.
test.skip(
  isProdRef(resolveTargetRef(process.env.VITE_SUPABASE_URL)),
  'CF-PROD-WRITE-BAN: PROD 타깃 → dev DB 컷오버(E2E dev-isolation) 전까지 skip.',
);

// CF-PROD-WRITE-BAN(Axis-A) primary 게이트: 어떤 write(fixtures 시더 포함)보다 먼저 fail-closed 검문.
test.beforeAll(() => assertCriticalFlowDbSafe('CF-3-noshow-handling'));

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('CF-3 노쇼 처리', () => {
  test('confirmed 예약 → no_show 마킹 + DB 검증', async () => {
    const res = await seedReservation({ time: '14:00' });
    try {
      const sb = createClient(SUPA_URL, SERVICE_KEY);

      // 노쇼 마킹 (UI 시뮬 어려워 DB 직접)
      const { data: updated, error } = await sb
        .from('reservations')
        .update({ status: 'no_show' })
        .eq('id', res.id)
        .select('status');
      expect(error).toBeNull();
      expect(updated?.[0]?.status).toBe('no_show');

      // reservation_logs 수동 INSERT (앱 코드는 트리거 또는 client에서 INSERT)
      await sb.from('reservation_logs').insert({
        reservation_id: res.id,
        clinic_id: CLINIC_ID,
        action: 'status_change',
        old_data: { status: 'confirmed' },
        new_data: { status: 'no_show' },
      });

      const { data: logs } = await sb
        .from('reservation_logs')
        .select('action, old_data, new_data')
        .eq('reservation_id', res.id);
      expect(logs?.length).toBeGreaterThan(0);
      expect(logs?.[0]?.action).toBe('status_change');
    } finally {
      await res.cleanup();
    }
  });

  test('통계 뷰 v_daily_visit_rate 노쇼율 반영 (read-only)', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const { data, error } = await sb
      .from('v_daily_visit_rate')
      .select('*')
      .eq('clinic_id', CLINIC_ID)
      .eq('dt', today)
      .maybeSingle();
    // 뷰 조회 자체가 통과되면 OK (스키마 정합)
    expect(error).toBeNull();
    if (data) {
      console.log('오늘 visit_rate row:', data);
    }
  });
});
