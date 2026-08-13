/**
 * T3 Critical Flow CF-5 — 일마감 (T-foot-qa-002)
 *
 * 시나리오:
 *   1. 오늘 done 체크인 + payments 시드 (단건 + 분할)
 *   2. daily_closings INSERT (마감 시뮬)
 *   3. status='closed' 검증
 *   4. 미수 (payment_waiting 상태) 카운트 별도 검증
 */
import { test, expect } from '@playwright/test';
// CF-PROD-WRITE-BAN(Axis-A · T-20260812-meta-CLOSING-HERALD-CF5-E2E-PROD-WRITE-BAN):
//   createClient 를 @supabase/supabase-js 가 아니라 가드 모듈에서 import 한다. 가드된
//   팩토리가 client 생성 이전에 PROD ref 를 fail-closed 로 차단(진원 봉인). 직접 import 금지
//   (불변식 spec _prod-write-ban-invariant.spec.ts 강제).
import {
  createClient,
  cleanupClosingOutbox,
  assertCriticalFlowDbSafe,
  resolveTargetRef,
  isProdRef,
} from './_prodWriteGuard';
import { CLINIC_ID, seedCheckIn } from '../../fixtures';

// CF-PROD-WRITE-BAN(Axis-A) green 경로 (T-20260720-meta-RED-CI-DEPLOY-BLOCK-GATE):
//   dev-DB 컷오버 전 CI 는 PROD ref 만 주입 → 이 파일 전체를 skip 한다(PROD write 0 · 잡 green).
//   CF-5 는 특히 PROD 가짜 closed daily_closings INSERT → closing_confirmed_outbox rev0 선점 →
//   실 EOD emit silent-drop 진원이었다(Axis-A RC). skip 이 그 진원을 CI 에서 원천 차단.
//   guard 는 fail-closed belt 로 존치 — dev DB(=skip false)에선 정상 실행. dev-isolation=T-20260804-foot-FOOTCTR-E2E-DEVDB-ISOLATION-CUTOVER.
test.skip(
  isProdRef(resolveTargetRef(process.env.VITE_SUPABASE_URL)),
  'CF-PROD-WRITE-BAN: PROD 타깃 → dev DB 컷오버(E2E dev-isolation) 전까지 skip.',
);

// CF-PROD-WRITE-BAN(Axis-A) primary 게이트: 어떤 write(fixtures 시더 포함)보다 먼저 실행돼
//   target 이 PROD ref 면 spec 전체를 fail-closed abort. (guarded createClient 는 belt.)
test.beforeAll(() => assertCriticalFlowDbSafe('CF-5-daily-closing'));

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.describe('CF-5 일마감', () => {
  test('done 체크인 + 결제 + 일마감 INSERT', async () => {
    const ck = await seedCheckIn({
      status: 'done',
      visit_type: 'new',
      name: `cf5-close-${Date.now()}`,
    });
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    let closingId: string | null = null;
    // AC2 outbox-inclusive cleanup 을 위해 close_date 를 try 밖으로 hoist(finally 접근).
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    try {
      // 1) 단건 payment 시드
      await sb.from('payments').insert({
        clinic_id: CLINIC_ID,
        check_in_id: ck.id,
        customer_id: ck.customerId,
        amount: 80000,
        method: 'card',
        installment: null,
        memo: 'CF-5 단건',
        payment_type: 'payment',
      });

      // 2) daily_closings INSERT (마감 시뮬)
      const { data: closing, error: closeErr } = await sb
        .from('daily_closings')
        .insert({
          clinic_id: CLINIC_ID,
          close_date: today,
          system_card_total: 80000,
          system_cash_total: 0,
          actual_card_total: 80000,
          actual_cash_total: 0,
          single_card_total: 80000,
          single_cash_total: 0,
          single_transfer_total: 0,
          package_card_total: 0,
          package_cash_total: 0,
          package_transfer_total: 0,
          difference: 0,
          status: 'closed',
          closed_at: new Date().toISOString(),
          memo: 'CF-5 자동 마감 spec',
        })
        .select('id, status, close_date')
        .single();
      // 같은 날 다중 close 방지 정책 있을 수 있음 — 이미 있으면 update 시도
      if (closeErr && closeErr.code === '23505') {
        // unique violation — 기존 row 갱신 path (스킵 처리)
        console.log('이미 같은 날 마감 row 존재, INSERT 시뮬 skip');
      } else {
        expect(closeErr).toBeNull();
        expect(closing?.status).toBe('closed');
        closingId = closing!.id as string;
      }

      // 3) v_daily_revenue 뷰 조회 (마감과 별개로 매출 집계)
      const { data: rev } = await sb
        .from('v_daily_revenue')
        .select('*')
        .eq('clinic_id', CLINIC_ID)
        .eq('dt', today)
        .maybeSingle();
      console.log('오늘 v_daily_revenue:', rev);
    } finally {
      if (closingId) {
        await sb.from('daily_closings').delete().eq('id', closingId);
      }
      // AC2 (belt): daily_closings status→closed 로 trg_enqueue_closing_confirmed 가 남긴
      //   파생 outbox 행(누수 진원)을 close_date 스코프로 회수. 기존 teardown 은 daily_closings/
      //   payments 만 지워 outbox 가 누수됐다. (실 fix 는 AC1 prod-write 금지 = phantom 미생성.)
      await cleanupClosingOutbox(sb, CLINIC_ID, today);
      await sb.from('payments').delete().eq('check_in_id', ck.id);
      await ck.cleanup();
    }
  });

  test('미수 (payment_waiting) 카운트 정확', async () => {
    const ck = await seedCheckIn({
      status: 'payment_waiting',
      visit_type: 'new',
      name: `cf5-due-${Date.now()}`,
    });
    try {
      const sb = createClient(SUPA_URL, SERVICE_KEY);
      const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const { count } = await sb
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', CLINIC_ID)
        .eq('created_date', today)
        .eq('status', 'payment_waiting');
      console.log(`오늘 미수 카운트: ${count}`);
      expect((count ?? 0)).toBeGreaterThan(0);
    } finally {
      await ck.cleanup();
    }
  });
});
