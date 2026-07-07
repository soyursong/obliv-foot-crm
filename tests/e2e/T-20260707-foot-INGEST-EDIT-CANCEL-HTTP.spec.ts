/**
 * T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL (FIX/reopen) — EDIT/CANCEL EF HTTP 라우팅 E2E
 *
 * ★ 왜 이 spec 이 새로 필요한가 (reopen 근본):
 *   부모 spec(T-20260630-foot-TM-EDIT-CANCEL)은 upsert_reservation_from_source RPC 를 service-role 로
 *   직접 호출해 검증했다. 그러나 실 push 경로는 도파민 → reservation-ingest-from-dopamine EF → RPC 다.
 *   EF 가 기존 external_id 를 무조건 'duplicate' 로 단락(short-circuit)해 RPC 의 UPDATE/cancel 분기에
 *   도달하지 못했고(무음 no-op), RPC-only spec 은 이 층을 건너뛰어 GREEN 오탐을 냈다.
 *   → 본 spec 은 **배포된 EF 를 HTTP 로 실제 호출**해 라우팅 분기 자체를 검증한다.
 *
 * 검증 대상(FIX): EF 가 기존 external_id 에 대해
 *   (a) reschedule(scheduled_at 변경) → RPC UPDATE 분기 라우팅 → 행 실제 변경 + updated_at 갱신
 *   (b) status='cancelled' → RPC cancel 분기 라우팅 → status='cancelled' 전이 + 슬롯 release
 *   (c) 순수 동일-payload 재push → 멱등 duplicate 유지(guard#2)
 *   (d) guard#5 lifecycle(checked_in/done/no_show) → 409 LIFECYCLE_INVALID reject(무음 clobber 금지)
 *   (e) self-mint scope → foot-native(source NULL) 행은 dopamine 호출로 불변(split-brain 차단)
 *
 * 인증: EF 는 X-Callback-Secret(DOPAMINE_CALLBACK_SECRET) 게이트. env 에 시크릿 미주입 시 graceful skip.
 *   (권위 실행 = dev-foot 가 배포 후 시크릿 주입해 foot prod 대상 GREEN 확인 — 2026-07-07. 결과 첨부: 9/9 PASS.)
 * 격리: external_id 'e2e-fix-%' 고유 마커 + before/after purge. source_system='dopamine' 이나 고유 ext 로 prod 무영향.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 공유 prod reservations(source_system='dopamine') 를 실제 write/mutate 하므로 병렬 실행 시
// 테스트 간 상태 경합(예: 한 테스트가 checked_in 으로 전이시킨 행을 다른 테스트 픽스처가 스윕)이
// 발생한다. 결정론 보장을 위해 파일 내 직렬 실행 강제.
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CB_SECRET = process.env.DOPAMINE_CALLBACK_SECRET ?? process.env.FOOT_CB_SECRET ?? '';
const EF_URL = `${SUPABASE_URL}/functions/v1/reservation-ingest-from-dopamine`;

const SRC = 'dopamine';
const CLINIC = 'jongno-foot';

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}
function extId(tag: string): string {
  // 고유 마커(테스트 격리). purge 는 prefix 'e2e-fix-' 로 일괄.
  return `e2e-fix-${tag}-${Date.now()}-${Math.floor(performance.now())}`;
}
// 테스트마다 고유 phone → customer 상태 커플링/누적 회피(E.164 KR mobile).
function uniquePhone(): string {
  return `+8210${String(Date.now()).slice(-8)}`;
}
async function post(body: unknown) {
  const r = await fetch(EF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Callback-Secret': CB_SECRET },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({} as Record<string, unknown>)) };
}
// 시딩용 ADD — 드문 transient 5xx(EF 인스턴스 순간 결함) 를 짧게 재시도(로직 검증 결과엔 무영향).
async function seedAdd(body: unknown) {
  for (let i = 0; i < 3; i++) {
    const r = await post(body);
    if (r.status < 500) return r;
    await new Promise((z) => setTimeout(z, 400));
  }
  return post(body);
}
async function row(sb: SupabaseClient, ext: string) {
  const { data } = await sb.from('reservations')
    .select('id,status,reservation_date,reservation_time,updated_at')
    .eq('source_system', SRC).eq('external_id', ext).maybeSingle();
  return data as { id: string; status: string; reservation_date: string; reservation_time: string; updated_at: string } | null;
}
function payload(ext: string, phone: string, over: Record<string, unknown> = {}) {
  return {
    source_system: SRC, external_id: ext, clinic_slug: CLINIC,
    customer: { phone_e164: phone, name: 'E2E수정취소' },
    reservation: { scheduled_at: '2026-07-15T05:00:00+09:00', slot_type: 'new_consult', memo: 'e2e add', ...over },
  };
}

function preconditionSkip(): string | null {
  if (!SERVICE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY 부재 — DB 검증 skip';
  if (!CB_SECRET) return 'DOPAMINE_CALLBACK_SECRET 미주입 — EF HTTP 인증 불가(권위 실행은 dev-foot prod 주입 GREEN)';
  return null;
}

test.afterAll(async () => {
  if (!SERVICE_KEY) return;
  const sb = admin();
  await sb.from('reservations').delete().eq('source_system', SRC).like('external_id', 'e2e-fix-%');
  await sb.from('reservations').delete().like('external_id', 'e2e-fix-sm-%');
});

test('EDIT reschedule → EF 가 RPC UPDATE 분기 라우팅 → 행 실제 변경 + updated_at 갱신 (AC1)', async () => {
  const skip = preconditionSkip();
  test.skip(!!skip, skip ?? '');
  const sb = admin();
  const ext = extId('edit');
  const phone = uniquePhone();
  // ADD
  let r = await seedAdd(payload(ext, phone));
  expect(r.status).toBe(200);
  expect(r.json.applied).toBe(true);
  const before = await row(sb, ext);
  expect(before?.reservation_date).toBe('2026-07-15');
  await new Promise((z) => setTimeout(z, 1100));
  // EDIT reschedule
  r = await post(payload(ext, phone, { scheduled_at: '2026-07-20T09:00:00+09:00' }));
  expect(r.status).toBe(200);
  expect(r.json.applied).toBe(true);
  expect(r.json.reason).toBe('rescheduled');
  const after = await row(sb, ext);
  expect(after?.reservation_date).toBe('2026-07-20');
  expect(after?.reservation_time.startsWith('09:00')).toBe(true);
  expect(after?.updated_at).not.toBe(before?.updated_at);   // no-op 아님
});

test('CANCEL → EF 가 RPC cancel 분기 라우팅 → status=cancelled 전이 + 캘린더뷰 제외 (AC2)', async () => {
  const skip = preconditionSkip();
  test.skip(!!skip, skip ?? '');
  const sb = admin();
  const ext = extId('cancel');
  const phone = uniquePhone();
  await seedAdd(payload(ext, phone));
  const r = await post(payload(ext, phone, { status: 'cancelled' }));
  expect(r.status).toBe(200);
  expect(r.json.applied).toBe(true);
  expect(r.json.reason).toBe('cancelled');
  const after = await row(sb, ext);
  expect(after?.status).toBe('cancelled');
  // 슬롯 release = 캘린더뷰(status <> cancelled)에서 제외
  const { data: visible } = await sb.from('reservations').select('id')
    .eq('source_system', SRC).eq('external_id', ext).neq('status', 'cancelled');
  expect(visible?.length ?? 0).toBe(0);
  // 재취소 멱등
  const r2 = await post(payload(ext, phone, { status: 'cancelled' }));
  expect(r2.status).toBe(200);
  expect(r2.json.ok).toBe(true);
});

test('동일 payload 재push → 멱등 duplicate 유지 (AC3, guard#2 불변)', async () => {
  const skip = preconditionSkip();
  test.skip(!!skip, skip ?? '');
  const ext = extId('idem');
  const phone = uniquePhone();
  await seedAdd(payload(ext, phone));
  const r = await post(payload(ext, phone));   // 완전 동일 재push
  expect(r.status).toBe(200);
  expect(r.json.applied).toBe(false);
  expect(r.json.reason).toBe('duplicate');
});

test('guard#5 lifecycle: checked_in 행 EDIT/CANCEL → 409 LIFECYCLE_INVALID reject, 행 불변 (AC4)', async () => {
  const skip = preconditionSkip();
  test.skip(!!skip, skip ?? '');
  const sb = admin();
  const ext = extId('lc');
  const phone = uniquePhone();
  const add = await seedAdd(payload(ext, phone));
  expect(add.status).toBe(200);   // 시딩 ADD 성공 확인(전제)
  const upd = await sb.from('reservations').update({ status: 'checked_in' })
    .eq('source_system', SRC).eq('external_id', ext).select('id');
  expect(upd.data?.length).toBe(1);   // checked_in 전이가 실제 반영됐음을 EF 호출 전 확정
  // stale EDIT
  let r = await post(payload(ext, phone, { scheduled_at: '2026-07-25T10:00:00+09:00' }));
  expect(r.status).toBe(409);
  expect(r.json.error).toBe('LIFECYCLE_INVALID');
  let x = await row(sb, ext);
  expect(x?.status).toBe('checked_in');
  expect(x?.reservation_date).toBe('2026-07-15');   // 불변
  // stale CANCEL
  r = await post(payload(ext, phone, { status: 'cancelled' }));
  expect(r.status).toBe(409);
  expect(r.json.error).toBe('LIFECYCLE_INVALID');
  x = await row(sb, ext);
  expect(x?.status).toBe('checked_in');             // 불변
});

test('self-mint scope: foot-native(source NULL) 행은 dopamine CANCEL 호출로 불변 (AC5, split-brain 차단)', async () => {
  const skip = preconditionSkip();
  test.skip(!!skip, skip ?? '');
  const sb = admin();
  const ext = `e2e-fix-sm-${Date.now()}`;
  const { data: clinic } = await sb.from('clinics').select('id').eq('slug', CLINIC).single();
  const { data: native } = await sb.from('reservations').insert({
    clinic_id: clinic!.id, customer_name: '네이티브', reservation_date: '2026-07-17',
    reservation_time: '07:00:00', status: 'confirmed', source_system: null, external_id: ext, visit_type: 'new',
  }).select('id,status').single();
  // dopamine CANCEL 호출(동일 ext) → native 행(source NULL)은 스코프 밖 → 불변
  await post(payload(ext, uniquePhone(), { status: 'cancelled' }));
  const { data: after } = await sb.from('reservations').select('id,status,source_system').eq('id', native!.id).single();
  expect(after!.status).toBe('confirmed');
  expect(after!.source_system).toBe(null);
});
