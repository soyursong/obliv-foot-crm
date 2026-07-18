/**
 * T-20260719-foot-DOPAMINE-RESCHED-INGEST-5XX-DIAG — reschedule 경계 캐스팅 5xx RC 회귀 spec
 *
 * ★ RC(진단):
 *   도파민TM 취부콜 → 큐추가 → 발신 다이얼로그 → '날짜 변경'(reschedule) 저장 시
 *   foot-reservation-push → reservation-ingest-from-dopamine(풋 ingest EF) 가 5xx 반환 →
 *   현장 팝업 '풋센터 반영 실패'. 원인 계층 = 풋 ingest reschedule(기존 예약 멱등 UPDATE) 경로.
 *
 *   근본원인: 도파민 '날짜 변경' push 는 새 날짜만 운반하고 time 을 빈/malformed 로 조립할 수 있다
 *   (예 scheduled_at='2026-07-21T+09:00' — cancel H3(T-20260707) 와 동형 ISO 잔해). 그러면
 *   scheduledTime=substring(11,19)='+09:00' 이 비-TIME → RPC 의 p_reservation_time(TIME) PostgREST
 *   경계 캐스팅에서 22007 hard-fail → RPC 미실행 → 500 INTERNAL. 신규 push 는 EF 직접 INSERT(RPC 미경유)
 *   라 정상 → reschedule(UPDATE/RPC)만 5xx.
 *
 *   fix: EDIT/reschedule 라우팅 시 malformed date/time 은 existing 행의 known-good 값으로 폴백
 *   ('날짜 변경'=time 보존이 정확한 시맨틱). valid 신규 date/time 은 그대로 사용(회귀 0).
 *   → cancel(H3)과 동형 방어를 reschedule 경로에도 적용. no-DDL(순수 EF 경계 캐스팅 로직 결함).
 *
 * 검증 대상:
 *   (AC1) reschedule valid full scheduled_at → RPC UPDATE 라우팅 → 날짜/시간 실제 변경(회귀 0)
 *   (AC2) reschedule malformed scheduled_at='2026-07-21T+09:00'(date-only, time 잔해) →
 *         旣존엔 500 이었음. fix 후 200 rescheduled + 새 날짜 착지 + 기존 시간 보존.
 *   (AC3) 순수 동일-payload 재push → 멱등 duplicate 유지(guard#2 불변 회귀)
 *
 * 인증: EF 는 X-Callback-Secret(DOPAMINE_CALLBACK_SECRET) 게이트. 미주입 시 graceful skip.
 *   (권위 실행 = dev-foot 가 배포 후 시크릿 주입해 foot prod 대상 GREEN 확인.)
 * 격리: external_id 'e2e-r5xx-%' 고유 마커 + afterAll purge. source_system='dopamine' 이나 고유 ext 로 prod 무영향.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 공유 prod reservations(source_system='dopamine') 를 실제 write/mutate → 파일 내 직렬 실행 강제.
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
  return `e2e-r5xx-${tag}-${Date.now()}-${Math.floor(performance.now())}`;
}
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
    customer: { phone_e164: phone, name: '정기봉E2E' },
    reservation: { scheduled_at: '2026-07-17T11:00:00+09:00', slot_type: 'new_consult', memo: 'e2e resched add', ...over },
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
  await sb.from('reservations').delete().eq('source_system', SRC).like('external_id', 'e2e-r5xx-%');
});

test('AC1 reschedule(valid full scheduled_at) → RPC UPDATE 라우팅 → 날짜/시간 실제 변경 (회귀 0)', async () => {
  const skip = preconditionSkip();
  test.skip(!!skip, skip ?? '');
  const sb = admin();
  const ext = extId('valid');
  const phone = uniquePhone();
  let r = await seedAdd(payload(ext, phone));
  expect(r.status).toBe(200);
  expect(r.json.applied).toBe(true);
  const before = await row(sb, ext);
  expect(before?.reservation_date).toBe('2026-07-17');
  await new Promise((z) => setTimeout(z, 1100));
  // reschedule: 날짜+시간 모두 변경
  r = await post(payload(ext, phone, { scheduled_at: '2026-07-21T14:30:00+09:00' }));
  expect(r.status).toBe(200);
  expect(r.json.applied).toBe(true);
  expect(r.json.reason).toBe('rescheduled');
  const after = await row(sb, ext);
  expect(after?.reservation_date).toBe('2026-07-21');
  expect(after?.reservation_time.startsWith('14:30')).toBe(true);
  expect(after?.updated_at).not.toBe(before?.updated_at);
});

test('AC2 reschedule(malformed scheduled_at="2026-07-21T+09:00", date-only/time 잔해) → 旣존 500 → fix 후 200 + 새 날짜 + 기존 시간 보존 (RC 픽스)', async () => {
  // ★ RC 재현: 도파민 '날짜 변경' push 가 date 만 바꾸고 time 을 빈 잔해로 조립 → scheduledTime='+09:00'
  //   = 비-TIME → p_reservation_time(TIME) 경계 캐스팅 22007 → RPC 미실행 → 500 INTERNAL 이었음.
  //   fix: EDIT 라우팅 시 malformed time 은 existing known-good 시간으로 폴백 → 200. 날짜만 변경.
  //   (旣존 EDIT 테스트(T-20260707 AC1)는 valid full scheduled_at 만 써서 이 조건을 못 잡아 GREEN 오탐.)
  const skip = preconditionSkip();
  test.skip(!!skip, skip ?? '');
  const sb = admin();
  const ext = extId('badts');
  const phone = uniquePhone();
  await seedAdd(payload(ext, phone));                 // valid ADD (confirmed, 2026-07-17 11:00)
  const before = await row(sb, ext);
  expect(before?.reservation_time.startsWith('11:00')).toBe(true);
  await new Promise((z) => setTimeout(z, 1100));
  // reschedule — 도파민이 실제 보낼 수 있는 date-only malformed scheduled_at 재현
  const r = await post(payload(ext, phone, { scheduled_at: '2026-07-21T+09:00' }));
  expect(r.status).toBe(200);                         // 旣존엔 500 이었음
  expect(r.json.applied).toBe(true);
  expect(r.json.reason).toBe('rescheduled');
  const after = await row(sb, ext);
  expect(after?.reservation_date).toBe('2026-07-21');          // 새 날짜 착지
  expect(after?.reservation_time.startsWith('11:00')).toBe(true); // 기존 시간 보존(malformed time 잔해 미착지)
  expect(after?.updated_at).not.toBe(before?.updated_at);
});

test('AC3 순수 동일 payload 재push → 멱등 duplicate 유지 (guard#2 회귀)', async () => {
  const skip = preconditionSkip();
  test.skip(!!skip, skip ?? '');
  const ext = extId('idem');
  const phone = uniquePhone();
  await seedAdd(payload(ext, phone));
  const r = await post(payload(ext, phone));          // 완전 동일 재push
  expect(r.status).toBe(200);
  expect(r.json.applied).toBe(false);
  expect(r.json.reason).toBe('duplicate');
});
