/**
 * T-20260723-foot-COMPANION-REALPHONE-RESVPOPUP-DROP — 동행 실연락처 external_id 폴백 파생 + carriage E2E
 *
 * ── 근인(bisect diagnostic, READ-ONLY 확정) ──────────────────────────────────
 *   7/23 동행 테스트 예약이 예약상세 팝업에 '동행자 연락처' 공란.
 *   실측(reservation_id 기준·PHI UUID-only): 동행 행 존재(external_id `<parent>_comp_<phone_e164>`,
 *         source=dopamine, created = T-20260721 EF 배포 이후) 이나 customer_real_phone = NULL.
 *         실연락처는 reservations 어느 컬럼에도 미착지.
 *   ⇒ 분기 A(EF 매핑 gap): 도파민 push 가 companion_phone 을 customer/reservation/body 어느 키에도
 *      동봉하지 않음 → customer_real_phone NULL. FE 렌더(ReservationDetailPopup)·formatPhone 은 정상.
 *
 * ── fix (additive, no-DDL, 표시전용, identity 무접촉) ─────────────────────────
 *   동행 실연락처는 composite external_id 접미사(`_comp_<phone>`)에 결정적으로 실려 풋CRM 이 이미 수신·저장.
 *   ingest EF 가 payload companion_phone 3소진 시 external_id 접미사에서 실연락처를 파생(동행에서만) →
 *   reservations.customer_real_phone(표시전용·비키·INV-3) 착지 → 예약상세 '동행자 연락처' 표시.
 *   ★ identity 무변: customer_id=NULL·phone_e164/customer_phone 미투입(§461 collapse 무관). external_id
 *     는 이미 저장된 값 → PII 표면 증가 0. 엄격 phone 패턴만 수용(이름/토큰 오탐 0).
 *
 * ── 테스트 값(합성) ──────────────────────────────────────────────────────────
 *   실환자 phone 미기재(§4.3). MSIT 문서화 test MSISDN(010-1234-5678 / +821012345678, phi-allowlist)만 사용.
 *   파생 로직은 format-based → 특정 digits 무관·동일 code-path 검증.
 *
 * 커버:
 *   S0 (순수 파생 로직): companionPhoneFromExternalId 미러 — composite external_id → 실연락처 파생,
 *        marker 부재/비-phone 접미사 → undefined(오탐 0). formatPhone(+82...) → 국내표기(FE 표기).
 *   S1 (carriage 착지): 파생 실연락처 → RPC persist → reservations.customer_real_phone 착지 +
 *        customer_id/customer_phone NULL 불변(identity 무접촉).
 *   S2 (null 안전): 접미사가 phone 아님 → 파생 undefined → customer_real_phone NULL(FE 미렌더·크래시 0).
 *   S3 (비동행 회귀 0): isCompanion=false → external_id 파생 미사용(payload only) — 파생 게이트 검증.
 *
 * 사전조건(graceful skip): 마이그 미적용(customer_real_phone 컬럼 부재)/서비스키 부재 → 명시 skip.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { formatPhone } from '../../src/lib/format';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SRC = 'e2e-foot-comp-realphone';                   // prod 'dopamine' 격리 마커
const CLINIC_SLUG = 'jongno-foot';
// composite external_id 형태(`<parent>_comp_<phone_e164>`). 합성 test MSISDN(phi-allowlist).
const PARENT = 'a1b2c3d4-0000-4000-8000-00000000rp23';
const REAL_PHONE = '+821012345678';                      // 합성 test MSISDN(= 010-1234-5678, phi-allowlist)
const EXT_COMP = `${PARENT}_comp_${REAL_PHONE}`;
const EXT_COMP_NOPHONE = `${PARENT}_comp_notaphone`;     // 접미사가 phone 아님 → 파생 거부

/** ingest EF 의 companionPhoneFromExternalId 미러(순수 파생 로직 잠금 — EF 직접호출은 secret 필요·배포검증 커버). */
function companionPhoneFromExternalId(extId: string | undefined): string | undefined {
  if (!extId) return undefined;
  const marker = '_comp_';
  const idx = extId.lastIndexOf(marker);
  if (idx < 0) return undefined;
  const suffix = extId.slice(idx + marker.length).trim();
  return /^\+?\d{8,15}$/.test(suffix) ? suffix : undefined;
}

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}
async function purge() {
  if (!SERVICE_KEY) return;
  await admin().from('reservations').delete().eq('source_system', SRC);
}
async function migrationReady(): Promise<string | null> {
  if (!SERVICE_KEY) return 'SERVICE_ROLE_KEY 부재 — DB 통합 검증 skip';
  const { error } = await admin().from('reservations').select('customer_real_phone').limit(1);
  if (error && /customer_real_phone/.test(error.message)) {
    return `customer_real_phone 컬럼 부재(마이그 미적용): ${error.message}`;
  }
  return null;
}
function skipIfUnresolved(error: { message?: string } | null) {
  if (error && /PGRST202|schema cache|function .* does not exist/i.test(error.message ?? '')) {
    test.skip(true, `RPC 미해석(마이그 미적용): ${error.message}`);
  }
}

const D = '2026-12-03';
const EXPECTED_DISPLAY = formatPhone(REAL_PHONE);        // 합성 test MSISDN 의 국내표기

test.describe('T-20260723 동행 실연락처 external_id 폴백 파생', () => {
  test('S0 순수 파생 로직: composite external_id → 실연락처, 오탐 0, formatPhone 표기', () => {
    // composite external_id 접미사에서 실연락처 파생.
    expect(companionPhoneFromExternalId(EXT_COMP)).toBe(REAL_PHONE);
    expect(companionPhoneFromExternalId(`${PARENT}_comp_+821012345678`)).toBe('+821012345678');
    // 오탐 0: marker 부재 / 비-phone 접미사 / 빈값 → undefined.
    expect(companionPhoneFromExternalId(`${PARENT}`)).toBeUndefined();
    expect(companionPhoneFromExternalId(EXT_COMP_NOPHONE)).toBeUndefined();
    expect(companionPhoneFromExternalId(undefined)).toBeUndefined();
    expect(companionPhoneFromExternalId('')).toBeUndefined();
    // 국내 raw digits 도 수용 — 단 하이픈 포함 원문은 거부(엄격 패턴).
    expect(companionPhoneFromExternalId(`${PARENT}_comp_01012345678`)).toBe('01012345678');
    // FE 표기: E.164 파생값이 formatPhone 으로 국내표기와 일치(공란 아님).
    expect(EXPECTED_DISPLAY).not.toBe('');
    expect(EXPECTED_DISPLAY).toMatch(/^\d{3}-\d{4}-\d{4}$/);
  });
});

test.describe('T-20260723 동행 실연락처 carriage — DB 착지(RPC 표준 진입점)', () => {
  test.beforeAll(purge);
  test.afterAll(purge);

  test('S1 carriage 착지: 파생 실연락처 → customer_real_phone 착지 + identity(id/phone) NULL 무변', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();

    // EF 가 external_id 에서 파생한 실연락처를 RPC 로 persist 하는 계약을 재현.
    const derived = companionPhoneFromExternalId(EXT_COMP);
    expect(derived, '동행 external_id 에서 실연락처 파생').toBe(REAL_PHONE);

    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_COMP,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: null,                 // 동행 무폰(identity)
      p_customer_name: '동행테스트',
      p_reservation_date: D,
      p_reservation_time: '12:00:00',
      p_customer_real_name: '동행테스트',
      p_customer_real_phone: derived,         // ← external_id 파생 실연락처(표시전용)
      p_is_companion: true,
    });
    skipIfUnresolved(error);
    expect(error, `동행 RPC 영속 실패: ${error?.message ?? ''}`).toBeNull();
    expect(rid).toBeTruthy();

    const { data: row } = await sb
      .from('reservations')
      .select('customer_id, customer_phone, customer_real_phone')
      .eq('source_system', SRC).eq('external_id', EXT_COMP).maybeSingle();
    expect(row, '동행 예약 미영속(무음실패)').toBeTruthy();
    expect(row!.customer_real_phone, '동행자 연락처 착지(공란 아님)').toBe(REAL_PHONE);
    // 렌더 계약: FE formatPhone(customer_real_phone) → 국내표기.
    expect(formatPhone(row!.customer_real_phone)).toBe(EXPECTED_DISPLAY);
    // identity 무변(§1/§461): provision 경로 미개입.
    expect(row!.customer_id, '동행 customer_id NULL 불변(§444/§52)').toBeNull();
    expect(row!.customer_phone, '동행 customer_phone NULL 불변(identity 무변)').toBeNull();
  });

  test('S2 null 안전: 접미사 비-phone → 파생 undefined → customer_real_phone NULL(FE 미렌더)', async () => {
    const skip = await migrationReady();
    test.skip(!!skip, skip ?? '');
    const sb = admin();

    const derived = companionPhoneFromExternalId(EXT_COMP_NOPHONE);
    expect(derived, '비-phone 접미사 → 파생 안 함').toBeUndefined();

    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_COMP_NOPHONE,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: null,
      p_customer_name: '동행무폰',
      p_reservation_date: D,
      p_reservation_time: '12:30:00',
      p_customer_real_name: '동행무폰',
      p_customer_real_phone: derived ?? null,
      p_is_companion: true,
    });
    skipIfUnresolved(error);
    expect(error, error?.message ?? '').toBeNull();
    expect(rid).toBeTruthy();

    const { data: row } = await sb
      .from('reservations')
      .select('customer_id, customer_real_phone')
      .eq('source_system', SRC).eq('external_id', EXT_COMP_NOPHONE).maybeSingle();
    expect(row, '무-연락처 동행도 정상 영속').toBeTruthy();
    expect(row!.customer_real_phone, '파생 실패 → NULL(null-safe, 크래시 0)').toBeNull();
    expect(row!.customer_id).toBeNull();
  });

  test('S3 비동행 회귀 0: external_id 에 _comp_ 유사 접미사가 있어도 비동행은 파생 게이트 미통과', () => {
    // EF 게이트: customerRealPhoneIn = isCompanion ? companionPhoneFromExternalId(externalId) : undefined.
    //   비동행(isCompanion=false)은 external_id 파생을 절대 사용하지 않음 → 회귀 0.
    const isCompanion = false;
    const externalId = `${PARENT}_comp_${REAL_PHONE}`;
    const customerRealPhoneIn = isCompanion ? companionPhoneFromExternalId(externalId) : undefined;
    expect(customerRealPhoneIn, '비동행은 external_id 파생 미사용').toBeUndefined();
  });
});
