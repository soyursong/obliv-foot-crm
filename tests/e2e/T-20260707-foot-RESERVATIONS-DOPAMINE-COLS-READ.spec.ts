/**
 * T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-READ — reservations 도파민 3컬럼 read 정합 (AC6)
 *
 * ── 배경 ──────────────────────────────────────────────────────────────────────
 *   부모 게이트 CROSSPRODUCT-V1-GATE §3(대표=A) 확정 → dopamine(§3 IMPL)이 cross-CRM 공유
 *   reservations 에 도파민TM write 컬럼 3종을 ADDITIVE 로 추가:
 *     · prevention_call_done   (bool, nullable/defaulted)
 *     · cancellation_call_done (bool, nullable/defaulted)
 *     · no_show_clicked_at     (timestamptz, nullable)
 *   DA CONSULT-REPLY 판정 = ADDITIVE(무손실). 소유권 = 도파민TM(write). 풋센터CRM = read-only.
 *
 * ── 본 spec 이 검증하는 것 ────────────────────────────────────────────────────
 *   풋센터CRM read 측 무회귀:
 *     (1) 3컬럼이 채워진 예약 건을 select('*') 로 로드 → 에러 0, 컬럼 값 그대로 read.
 *     (2) 3컬럼이 NULL 인 기존형 예약 건도 정상 read(신규 컬럼 존재해도 깨짐 0).
 *     (3) 컬럼이 prod reservations 스키마에 실재(= dopamine §3 prod 반영 확인).
 *   CRM측 DB 변경 없음(컬럼 추가는 dopamine 소관) — 본 티켓은 read 방어만.
 *   RLS 는 기존 policy 상속(신규 정책 0) — service_role read 는 정책 우회이나, 컬럼이
 *   기존 select 경로에 그대로 실려 옴을 확인하는 데 목적.
 *
 * 격리: source_system='e2e-dopa-cols-read' 마커(prod 'dopamine' 무영향). before/after purge.
 * 사전조건(GREEN-or-SKIP): SERVICE_ROLE_KEY 미주입 → 명시 skip.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SRC = 'e2e-dopa-cols-read';            // 격리 마커(prod 'dopamine' 무영향)
const CLINIC_SLUG = 'jongno-foot';

let admin: SupabaseClient | null = null;
let clinicId: string | null = null;

test.beforeAll(async () => {
  if (!SERVICE_KEY) return;
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: clinic } = await admin
    .from('clinics')
    .select('id')
    .eq('slug', CLINIC_SLUG)
    .maybeSingle();
  clinicId = (clinic as { id: string } | null)?.id ?? null;
  // 이전 잔여 격리 데이터 제거
  await admin.from('reservations').delete().eq('source_system', SRC);
});

test.afterAll(async () => {
  if (admin) {
    await admin.from('reservations').delete().eq('source_system', SRC);
  }
});

test('AC3: dopamine 3컬럼이 채워진 예약 건 select(*) read 무회귀', async () => {
  test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY 미주입 — read 정합 검증 skip');
  test.skip(!clinicId, 'jongno-foot clinic 미확인 — skip');

  // 3컬럼이 채워진(도파민TM write 모사) 예약 건 삽입
  const nowIso = new Date().toISOString();
  const { data: ins, error: insErr } = await admin!
    .from('reservations')
    .insert({
      clinic_id: clinicId,
      customer_name: 'E2E도파민콜',
      customer_phone: '01000000000',
      reservation_date: '2026-07-07',
      reservation_time: '10:00',
      visit_type: 'new',
      status: 'confirmed',
      source_system: SRC,
      prevention_call_done: true,
      cancellation_call_done: false,
      no_show_clicked_at: nowIso,
    })
    .select('id')
    .maybeSingle();

  // 삽입 자체가 성공 = 3컬럼이 prod 스키마에 실재(AC1 prod 반영 확인 + db_change=false 정합)
  expect(insErr, `insert 실패 = 컬럼 미실재/제약 위반: ${insErr?.message}`).toBeNull();
  const rid = (ins as { id: string } | null)?.id;
  expect(rid).toBeTruthy();

  // FE 실경로와 동일한 select('*') 로 read → 에러 0 + 3컬럼 그대로 실려 옴
  const { data: row, error: readErr } = await admin!
    .from('reservations')
    .select('*')
    .eq('id', rid!)
    .maybeSingle();

  expect(readErr, `select(*) read 실패: ${readErr?.message}`).toBeNull();
  const r = row as Record<string, unknown>;
  expect(r).toBeTruthy();
  expect(r.prevention_call_done).toBe(true);
  expect(r.cancellation_call_done).toBe(false);
  expect(r.no_show_clicked_at).toBeTruthy();
  // 기존 필드도 온전 (read 회귀 0)
  expect(r.status).toBe('confirmed');
  expect(r.customer_name).toBe('E2E도파민콜');
});

test('AC3: 3컬럼 NULL(기존형) 예약 건도 정상 read', async () => {
  test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY 미주입 — skip');
  test.skip(!clinicId, 'jongno-foot clinic 미확인 — skip');

  // dopamine 컬럼 미지정 = 기존 예약 형태(NULL)
  const { data: ins, error: insErr } = await admin!
    .from('reservations')
    .insert({
      clinic_id: clinicId,
      customer_name: 'E2E기존형',
      customer_phone: '01000000001',
      reservation_date: '2026-07-07',
      reservation_time: '11:00',
      visit_type: 'returning',
      status: 'confirmed',
      source_system: SRC,
    })
    .select('id')
    .maybeSingle();

  expect(insErr, `insert 실패: ${insErr?.message}`).toBeNull();
  const rid = (ins as { id: string } | null)?.id;

  const { data: row, error: readErr } = await admin!
    .from('reservations')
    .select('*')
    .eq('id', rid!)
    .maybeSingle();

  expect(readErr, `NULL 건 read 실패: ${readErr?.message}`).toBeNull();
  const r = row as Record<string, unknown>;
  // 신규 컬럼이 존재하되 NULL — 깨짐 0, undefined-safe
  expect(r.prevention_call_done ?? null).toBeNull();
  expect(r.cancellation_call_done ?? null).toBeNull();
  expect(r.no_show_clicked_at ?? null).toBeNull();
  expect(r.status).toBe('confirmed');
});
