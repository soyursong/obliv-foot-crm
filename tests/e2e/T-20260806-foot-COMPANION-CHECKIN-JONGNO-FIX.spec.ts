/**
 * T-20260806-dopamine-COMPANION-CHECKIN-FOOT-JONGNO-FIX
 *   동행(customer_id=NULL) 예약 상세 → 스태프-확정 승격(find-or-create 실번호 materialize) → 고객차트/체크인 활성.
 *
 * DA verdict A (scalp2 canonical 포팅·스태프-JWT). change-class=ADDITIVE.
 *   ▸ companion_of_reservation_id nullable self-FK(ON DELETE SET NULL) + partial index (마이그 A)
 *   ▸ fn_staff_companion_promote(uuid,text,text,text) SECDEF · GRANT authenticated ONLY · anon EXECUTE 0 (마이그 B)
 *
 * ── 왜 DB-통합 + 스태프-JWT spec 인가 ──────────────────────────────────────────
 *   승격 glue 의 결정론적 게이트 = (a)authz(스태프-JWT only·VG5) (b)§52 결속 사다리(VG2)
 *   (c)진성 실번호(VG1) (d)customer_id 결속(orphan 제거·AC-2) (e)companion_of external_id resolve(VG3).
 *   이들은 서버 RPC 계약이므로 스태프 세션 + service-role seed 로 결정론 검증. 팝업 UI 클릭 동선(고객차트/체크인
 *   버튼 활성)은 customer_id 결속 이후 기존 경로가 그대로 발화 → 리셉션 field-soak(이유나/서민기 재현 케이스)로 커버.
 *
 * ── 격리 ─────────────────────────────────────────────────────────────────────
 *   source_system='e2e-foot-companion-promote' + 전용 테스트 전화번호 마커. before/after 전수 purge.
 *   prod 'dopamine' 트리거 무발화(source_system 상이).
 *
 * 사전조건(GREEN-or-SKIP): 마이그 A/B 미적용 환경 → 컬럼/함수 미해석 → 명시 skip(배포 前).
 *   SERVICE_ROLE_KEY / TEST 스태프 크레덴셜 부재 → 해당 leg skip.
 *
 * 커버:
 *   S1 (VG5 authz)     : 세션 없음(anon) 호출 → 거부(permission denied / 미노출). staff-JWT only.
 *   S2 (happy·AC-1/2/VG1/VG3): 동행 seed → 실명+실번호 승격 → customer materialize + reservation.customer_id 결속
 *                        + companion_of == 메인 예약(external_id {cue} resolve). phone_dummy=false.
 *   S3 (VG1)           : 더미폰(+821000000000) → 'real_phone_required' 거부(더미 provision 금지).
 *   S4 (VG2)           : (clinic,phone) 기존고객 이름불일치 → provisional true·결속 안 함(전화단독 auto-bind 금지).
 *   S5 (멱등)          : 승격 2회 → 2회차 already_bound(재-materialize 없음).
 *   S6 (입력검증)      : 빈 성함→name_required / 짧은 번호→phone_required.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? '';

const SRC = 'e2e-foot-companion-promote';
const CUE_UUID = 'c0000001-0000-4000-8000-0000000000e1';
const EXT_MAIN = CUE_UUID;                       // 본예약 external_id = {cue}
const EXT_COMP = `${CUE_UUID}_comp_1`;           // 동행 external_id = {cue}_comp_{ord}
const TEST_PHONE = '+821099880011';              // 전용 테스트 실번호(합성 마커·phi-allowlist 등재)
const TEST_PHONE_INPUT = '010-9988-0011';        // 위 E.164 의 입력(하이픈) 표기 — normalize_phone → TEST_PHONE

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function migrationReady(): Promise<string | null> {
  if (!SERVICE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY 부재 — DB 통합 검증 skip';
  const sb = admin();
  const { error: colErr } = await sb.from('reservations').select('companion_of_reservation_id').limit(1);
  if (colErr && /companion_of_reservation_id/.test(colErr.message)) {
    return `companion_of_reservation_id 컬럼 부재(마이그 A 미적용): ${colErr.message}`;
  }
  // 함수 존재 probe: 잘못된 인자로 호출해도 "함수 없음" 과 "인자 검증 실패" 는 구분됨.
  const { error: fnErr } = await sb.rpc('fn_staff_companion_promote', {
    p_reservation_id: '00000000-0000-0000-0000-000000000000',
    p_name: '', p_phone: '',
  });
  if (fnErr && /could not find the function|does not exist|schema cache/i.test(fnErr.message)) {
    return `fn_staff_companion_promote 미노출(마이그 B 미적용): ${fnErr.message}`;
  }
  return null;
}

async function purge() {
  if (!SERVICE_KEY) return;
  const sb = admin();
  await sb.from('reservations').delete().eq('source_system', SRC);
  await sb.from('customers').delete().in('phone', [TEST_PHONE]);
}

/** 스태프 JWT client + 그 스태프의 clinic_id 반환. 크레덴셜/키 부재 시 null. */
async function staffSession(): Promise<{ sb: SupabaseClient; clinicId: string } | null> {
  if (!ANON_KEY || !TEST_PASSWORD) return null;
  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (error || !data.user) return null;
  const { data: prof } = await admin()
    .from('user_profiles').select('clinic_id').eq('id', data.user.id).maybeSingle();
  if (!prof?.clinic_id) return null;
  return { sb, clinicId: prof.clinic_id as string };
}

async function seedCompanion(clinicId: string) {
  const sb = admin();
  const date = '2026-08-11';
  // 메인(본예약) — external_id={cue} · customer_id 有 무관(앵커는 external_id 로 resolve)
  await sb.from('reservations').insert({
    clinic_id: clinicId, reservation_date: date, reservation_time: '19:00:00',
    visit_type: 'new', status: 'confirmed', customer_name: '이유나',
    source_system: SRC, external_id: EXT_MAIN,
  });
  // 동행 — customer_id=NULL · external_id={cue}_comp_1 · 동행명
  const { data, error } = await sb.from('reservations').insert({
    clinic_id: clinicId, reservation_date: date, reservation_time: '19:00:00',
    visit_type: 'new', status: 'confirmed', customer_name: '서민기', customer_id: null,
    customer_real_name: '서민기', source_system: SRC, external_id: EXT_COMP,
  }).select('id').single();
  if (error) throw new Error(`companion seed 실패: ${error.message}`);
  const { data: mainRow } = await sb.from('reservations')
    .select('id').eq('source_system', SRC).eq('external_id', EXT_MAIN).single();
  return { companionId: data!.id as string, mainId: mainRow!.id as string };
}

test.beforeAll(purge);
test.afterAll(purge);

test('S1 VG5: 세션 없음(anon) 승격 호출 거부 — staff-JWT only', async () => {
  const skip = await migrationReady();
  test.skip(!!skip, skip ?? '');
  test.skip(!ANON_KEY, 'ANON_KEY 부재 — anon 거부 leg skip');
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc('fn_staff_companion_promote', {
    p_reservation_id: '00000000-0000-0000-0000-000000000000', p_name: 'x', p_phone: TEST_PHONE_INPUT,
  });
  // anon 은 EXECUTE 미부여 → PostgREST 미노출(에러) 또는 permission denied. 성공 payload 절대 없음.
  const ok = (data as { success?: boolean } | null)?.success;
  expect(ok, 'anon 이 승격에 성공하면 VG5 위반').not.toBe(true);
  expect(error, 'anon 호출은 에러여야 함(EXECUTE 미부여)').toBeTruthy();
});

test('S2 happy: 동행 승격 → customer materialize + customer_id 결속 + companion_of(external_id resolve)', async () => {
  const skip = await migrationReady();
  test.skip(!!skip, skip ?? '');
  const sess = await staffSession();
  test.skip(!sess, 'TEST 스태프 크레덴셜/ANON_KEY 부재 — 스태프-JWT happy leg skip');
  await purge();
  const { companionId, mainId } = await seedCompanion(sess!.clinicId);

  const { data, error } = await sess!.sb.rpc('fn_staff_companion_promote', {
    p_reservation_id: companionId, p_name: '서민기', p_phone: TEST_PHONE_INPUT,
  });
  expect(error, error?.message).toBeFalsy();
  const res = data as { success: boolean; provisional: boolean; customer_id: string; companion_of: string | null };
  expect(res.success).toBe(true);
  expect(res.provisional).toBe(false);
  expect(res.customer_id).toBeTruthy();

  const sb = admin();
  // AC-2: reservation.customer_id 결속(orphan 제거)
  const { data: resv } = await sb.from('reservations')
    .select('customer_id, companion_of_reservation_id').eq('id', companionId).single();
  expect(resv!.customer_id).toBe(res.customer_id);
  // VG3: companion_of == 메인 예약(external_id {cue} deterministic resolve)
  expect(resv!.companion_of_reservation_id).toBe(mainId);
  // VG1: 진성 실번호 customer(phone_dummy=false)
  const { data: cust } = await sb.from('customers')
    .select('name, phone, phone_dummy').eq('id', res.customer_id).single();
  expect(cust!.phone).toBe(TEST_PHONE);
  expect(cust!.name).toBe('서민기');
  expect(cust!.phone_dummy).toBe(false);
});

test('S3 VG1: 더미폰 승격 거부(real_phone_required) — 더미 provision 금지', async () => {
  const skip = await migrationReady();
  test.skip(!!skip, skip ?? '');
  const sess = await staffSession();
  test.skip(!sess, 'staff-JWT leg skip');
  await purge();
  const { companionId } = await seedCompanion(sess!.clinicId);
  const { data, error } = await sess!.sb.rpc('fn_staff_companion_promote', {
    p_reservation_id: companionId, p_name: '서민기', p_phone: '+821000000000',
  });
  expect(error, error?.message).toBeFalsy();
  const res = data as { success: boolean; error?: string };
  expect(res.success).toBe(false);
  expect(res.error).toBe('real_phone_required');
});

test('S4 VG2: (clinic,phone) 기존고객 이름불일치 → provisional(전화단독 auto-bind 금지)', async () => {
  const skip = await migrationReady();
  test.skip(!!skip, skip ?? '');
  const sess = await staffSession();
  test.skip(!sess, 'staff-JWT leg skip');
  await purge();
  const { companionId } = await seedCompanion(sess!.clinicId);
  // 동일 번호·다른 이름의 기존 고객 선점
  await admin().from('customers').insert({
    clinic_id: sess!.clinicId, name: '홍길동', phone: TEST_PHONE, visit_type: 'new',
  });
  const { data, error } = await sess!.sb.rpc('fn_staff_companion_promote', {
    p_reservation_id: companionId, p_name: '서민기', p_phone: TEST_PHONE_INPUT,
  });
  expect(error, error?.message).toBeFalsy();
  const res = data as { success: boolean; provisional: boolean };
  expect(res.success).toBe(true);
  expect(res.provisional).toBe(true);
  // 결속 안 함
  const { data: resv } = await admin().from('reservations').select('customer_id').eq('id', companionId).single();
  expect(resv!.customer_id).toBeNull();
});

test('S5 멱등: 승격 2회 → 2회차 already_bound', async () => {
  const skip = await migrationReady();
  test.skip(!!skip, skip ?? '');
  const sess = await staffSession();
  test.skip(!sess, 'staff-JWT leg skip');
  await purge();
  const { companionId } = await seedCompanion(sess!.clinicId);
  const first = await sess!.sb.rpc('fn_staff_companion_promote', {
    p_reservation_id: companionId, p_name: '서민기', p_phone: TEST_PHONE_INPUT,
  });
  expect((first.data as { success: boolean }).success).toBe(true);
  const second = await sess!.sb.rpc('fn_staff_companion_promote', {
    p_reservation_id: companionId, p_name: '서민기', p_phone: TEST_PHONE_INPUT,
  });
  const res = second.data as { success: boolean; already_bound?: boolean; customer_id: string };
  expect(res.success).toBe(true);
  expect(res.already_bound).toBe(true);
  expect(res.customer_id).toBe((first.data as { customer_id: string }).customer_id);
});

test('S6 입력검증: 빈 성함/짧은 번호 거부', async () => {
  const skip = await migrationReady();
  test.skip(!!skip, skip ?? '');
  const sess = await staffSession();
  test.skip(!sess, 'staff-JWT leg skip');
  await purge();
  const { companionId } = await seedCompanion(sess!.clinicId);
  const noName = await sess!.sb.rpc('fn_staff_companion_promote', {
    p_reservation_id: companionId, p_name: '   ', p_phone: TEST_PHONE_INPUT,
  });
  expect((noName.data as { error?: string }).error).toBe('name_required');
  const shortPhone = await sess!.sb.rpc('fn_staff_companion_promote', {
    p_reservation_id: companionId, p_name: '서민기', p_phone: '123',
  });
  expect((shortPhone.data as { error?: string }).error).toBe('phone_required');
});
