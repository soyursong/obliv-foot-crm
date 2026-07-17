/**
 * T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT — 풋→도파민 lifecycle emit (step2, emit lane 3)
 *
 * 근거 canon(SSOT):
 *   memory/.../da_replies/DA-20260714-FOOT-LIFECYCLE-CANCEL-RESCHEDULE-CANON.md
 *   cross_crm_data_contract.md §6-6-8(reschedule) / §6-6-1(payload) / §6-6-5(event_id) / §6-6-2·§4-2d(secret)
 *
 * 범위 (step2 착지분):
 *   AC-1 단일 타깃: dispatch EF 는 crm-lifecycle-callback 로만 POST. crm-cancel-callback fan-out 금지.
 *   AC-2 secret: X-Callback-Secret = FOOT_CALLBACK_SECRET, 미설정 시 DOPAMINE_CALLBACK_SECRET 폴백.
 *   AC-3 reschedule: event_type='reschedule' 등재(ADDITIVE CHECK) + reservation_date UPDATE 트리거.
 *   AC-4 payload: source_system=foot / crm_reservation_id(=풋 PK) / old_date / new_date / changed_at.
 *   AC-5 event_id: outbox row 의 안정 PK(재시도 고정). reservation.id/check_in.id 원천 아님.
 *   AC-6 gate: 도파민 연동(source_system=dopamine + external_id) 건만. foot-direct/walk-in skip.
 *   AC-7 ADDITIVE: 기존 event_type 4값(visited/no_show/cancelled/rejected) 무손상.
 *   AC-8 rollback: 트리거·함수 제거 + CHECK 원복.
 *
 * ※ 실 emit/도파민 착지 검증은 step3 soak(아키텍트 일일감사 축①⑤). 본 스펙은 발신부 계약을
 *   마이그레이션 + dispatch EF 정적 단언으로 고정(unit 프로젝트, browser 미사용) — 동일 feature family
 *   (T-20260602-multi-CALLBACK-EF-4-NEW) 패턴 답습.
 *
 * 실행: npx playwright test T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIG = resolve(
  __dirname,
  '../../supabase/migrations/20260715140000_foot_dopamine_reschedule_emit.sql',
);
const MIG_RB = resolve(
  __dirname,
  '../../supabase/migrations/20260715140000_foot_dopamine_reschedule_emit.rollback.sql',
);
const EF = resolve(
  __dirname,
  '../../supabase/functions/dopamine-callback-dispatch/index.ts',
);

test.describe('T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT (풋 emit lane 3)', () => {
  let mig: string;
  let migRb: string;
  let ef: string;

  test.beforeAll(() => {
    mig = readFileSync(MIG, 'utf-8');
    migRb = readFileSync(MIG_RB, 'utf-8');
    ef = readFileSync(EF, 'utf-8');
  });

  // ── AC-1: 단일 타깃 (fan-out 금지) ─────────────────────────────────────
  test('AC-1: dispatch EF 는 crm-lifecycle-callback 단일 타깃, cancel-callback fan-out 없음', () => {
    expect(ef).toContain('/crm-lifecycle-callback');
    expect(ef).not.toContain('crm-cancel-callback');
  });

  // ── AC-2: secret 폴백 ──────────────────────────────────────────────────
  test('AC-2: FOOT_CALLBACK_SECRET → DOPAMINE_CALLBACK_SECRET 폴백, 헤더 배선', () => {
    expect(ef).toContain('FOOT_CALLBACK_SECRET');
    expect(ef).toMatch(/FOOT_CALLBACK_SECRET\s*\|\|\s*DOPAMINE_CALLBACK_SECRET/);
    expect(ef).toMatch(/"X-Callback-Secret":\s*CALLBACK_SECRET/);
  });

  // ── AC-3: reschedule CHECK 확장 + 트리거 ──────────────────────────────
  test('AC-3: event_type CHECK 에 reschedule 등재 (ADDITIVE)', () => {
    expect(mig).toMatch(/ADD CONSTRAINT dopamine_callback_outbox_event_type_check[\s\S]*reschedule/);
  });

  test('AC-3: reservation_date UPDATE 트리거 + 신규 enqueue 함수', () => {
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.enqueue_dopamine_reschedule()');
    expect(mig).toMatch(/AFTER UPDATE OF reservation_date ON public\.reservations/);
    expect(mig).toContain('trg_dopamine_cb_resv_reschedule');
    // 기존 status 트리거 함수는 무접촉(재정의 금지)
    expect(mig).not.toContain('CREATE OR REPLACE FUNCTION public.enqueue_dopamine_callback');
  });

  // ── AC-4: reschedule payload 계약키 ───────────────────────────────────
  test('AC-4: payload = source_system=foot + crm_reservation_id/old_date/new_date/changed_at', () => {
    expect(mig).toMatch(/'source_system',\s*'foot'/);
    expect(mig).toMatch(/'event_type',\s*'reschedule'/);
    for (const key of ['crm_reservation_id', 'old_date', 'new_date', 'changed_at']) {
      expect(mig).toContain(`'${key}'`);
    }
    // crm_reservation_id/grain = 풋 reservation PK (NEW.id)
    expect(mig).toMatch(/'crm_reservation_id',\s*NEW\.id/);
    expect(mig).toMatch(/'old_date',\s*to_char\(OLD\.reservation_date/);
    expect(mig).toMatch(/'new_date',\s*to_char\(NEW\.reservation_date/);
  });

  // ── AC-5: event_id = outbox row 안정 PK ───────────────────────────────
  test('AC-5: event_id = outbox row PK(gen_random_uuid), reservation.id/check_in.id 원천 아님', () => {
    expect(mig).toMatch(/v_id\s*:=\s*gen_random_uuid\(\)::TEXT/);
    // id 와 event_id 를 동일 PK 로 발급
    expect(mig).toMatch(/'event_id',\s*v_id/);
    expect(mig).toMatch(/v_id::UUID,\s*'reschedule',\s*v_id/);
  });

  // ── AC-6: 도파민 연동 게이트 (foot-direct/walk-in skip) ───────────────
  test('AC-6: source_system=dopamine + external_id 있는 건만, 그 외 skip', () => {
    expect(mig).toMatch(/NEW\.source_system IS DISTINCT FROM 'dopamine'\s*[\s\S]*NEW\.external_id IS NULL/);
    // 날짜 무변경/취소·노쇼 skip 가드
    expect(mig).toMatch(/NEW\.reservation_date IS NOT DISTINCT FROM OLD\.reservation_date/);
    expect(mig).toMatch(/NEW\.status IN \('cancelled','no_show'\)/);
  });

  // ── AC-7: 기존 event_type 값 무손상 (ADDITIVE) ────────────────────────
  test('AC-7: ADDITIVE — 기존 4값 보존', () => {
    const addCheck = mig.match(/ADD CONSTRAINT dopamine_callback_outbox_event_type_check[\s\S]*?\);/);
    expect(addCheck).not.toBeNull();
    for (const v of ['visited', 'no_show', 'cancelled', 'rejected', 'reschedule']) {
      expect(addCheck![0]).toContain(`'${v}'`);
    }
  });

  // ── AC-8: 롤백 대칭 ────────────────────────────────────────────────────
  test('AC-8: rollback — 트리거·함수 제거 + CHECK 원복(reschedule 제거)', () => {
    expect(migRb).toContain('DROP TRIGGER IF EXISTS trg_dopamine_cb_resv_reschedule');
    expect(migRb).toContain('DROP FUNCTION IF EXISTS public.enqueue_dopamine_reschedule');
    // CHECK 원복 = reschedule 없는 4값
    const rbCheck = migRb.match(/ADD CONSTRAINT dopamine_callback_outbox_event_type_check[\s\S]*?\);/);
    expect(rbCheck).not.toBeNull();
    expect(rbCheck![0]).not.toContain('reschedule');
    expect(rbCheck![0]).toContain("'cancelled'");
  });

  // ── 원자성/멱등 ────────────────────────────────────────────────────────
  test('마이그 = 단일 트랜잭션(BEGIN/COMMIT), 재실행 안전(CREATE OR REPLACE / IF EXISTS)', () => {
    expect(mig.trim().startsWith('BEGIN') || mig.includes('\nBEGIN;')).toBeTruthy();
    expect(mig).toContain('COMMIT;');
    expect(mig).toContain('DROP CONSTRAINT IF EXISTS');
    expect(mig).toContain('DROP TRIGGER IF EXISTS trg_dopamine_cb_resv_reschedule');
  });
});
