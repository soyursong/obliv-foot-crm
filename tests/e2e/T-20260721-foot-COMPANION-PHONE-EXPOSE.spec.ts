/**
 * T-20260721-foot-COMPANION-PHONE-EXPOSE-DECISION — 동행자 연락처 표시전용 carriage E2E
 *
 * 근거: DA 확정 판정 MSG-20260721-161823-xckd.
 *   ⛔ provision 실번호 경로 REJECT(동행≠예약자 differ = 제3자 공유폰 collapse 미탐지, §461/INV-1·§52).
 *   ✅ 채택 = 기존 표준 customer_real_phone(비키·표시전용, INV-3) 재사용 → reservations.customer_real_phone
 *      carry → 예약상세 '동행자 연락처' 표시. 동행 identity(customer_id=NULL·customer_phone=NULL) 무변.
 *
 * ── 왜 service-role DB 통합 spec 인가 (형제 T-20260630-COMPANION-RESV-INSERT-FAIL 동형) ──
 *   foot 네이티브 예약화면은 동행 UI 자체가 없다 — 동행 인입 = 도파민 push → ingest EF /
 *   upsert_reservation_from_source RPC(계약 표준 진입점). 따라서 '동행자 연락처' carriage 의 결정론적
 *   검증 대상 = 마이그(reservations.customer_real_phone ADD + RPC persist 절)의 DB 착지 행동.
 *   FE 표시(예약상세 팝업)는 reservations.customer_real_phone 를 select('*') 로 읽어 conditional 렌더 →
 *   정적 가드(아래 describe)로 렌더 계약을 잠근다. (EF 직접 호출은 X-Callback-Secret 필요 → 배포검증 커버.)
 *
 * ── 격리 ─────────────────────────────────────────────────────────────────────
 *   source_system='e2e-foot-comp-phone' 마커로 prod 'dopamine' 행과 완전 격리
 *   (enqueue_dopamine_callback 은 source_system='dopamine' 에만 발화). before/after 전수 purge.
 *
 * 커버 시나리오 (티켓 §게이트 "현장 클릭 시나리오 3종"):
 *   S1 (정상표시): 동행 push + customer_real_phone → reservations.customer_real_phone 착지,
 *        customer_id NULL·customer_phone NULL(identity 무변). ← '동행자 연락처' 표시 데이터.
 *   S2 (공유폰 엣지): 동행 2건이 동일 실 연락처 공유 → 각각 독립 예약행(2 distinct id),
 *        둘 다 customer_id NULL(collapse 0·§461/INV-1), 둘 다 customer_real_phone=공유번호.
 *        = phone 이 identity 키로 쓰이지 않음(귀속/역조회 미사용) 증명.
 *   S3 (null 안전): 동행 push 무-연락처(customer_real_phone 미동봉) → 행 영속·customer_real_phone NULL.
 *        (FE 는 값 없으면 '동행자 연락처' 행 미렌더 → 크래시 0.)
 *   S4 (preserve-on-NULL 재push): 실연락처 착지 후 무-연락처 재push → 기존 customer_real_phone 유지(무손실).
 *   S5 (비동행 회귀 0): is_companion 미동봉 → customer_real_phone NULL(회귀 0), customer_id 링크 유지.
 *
 * 사전조건(graceful skip): 마이그 미적용 환경(customer_real_phone 컬럼 부재)에서는 명시 skip(배포 前 GREEN-or-SKIP).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '../..');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SRC = 'e2e-foot-comp-phone';                       // prod 'dopamine' 과 격리된 테스트 마커
const CLINIC_SLUG = 'jongno-foot';
const CUE = 'a1b2c3d4-0000-4000-8000-0000000cp210';      // 테스트용 가상 cue_card UUID
const EXT_COMP1 = `${CUE}#companion-1`;
const EXT_COMP2 = `${CUE}#companion-2`;
const EXT_COMP_NULL = `${CUE}#companion-null`;
const EXT_MAIN = `${CUE}-main`;
const SHARED_PHONE = '+821055554444';                    // 공유폰 엣지: 동행 2건이 동일 실 연락처

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function purge() {
  if (!SERVICE_KEY) return;
  await admin().from('reservations').delete().eq('source_system', SRC);
}

/** 마이그 적용 여부 탐지(reservations.customer_real_phone 컬럼). 미적용 → skip 사유 반환. */
async function migrationReady(): Promise<string | null> {
  if (!SERVICE_KEY) return 'SERVICE_ROLE_KEY 부재 — DB 통합 검증 skip';
  const sb = admin();
  const { error: colErr } = await sb.from('reservations').select('customer_real_phone').limit(1);
  if (colErr && /customer_real_phone/.test(colErr.message)) {
    return `customer_real_phone 컬럼 부재(마이그 미적용): ${colErr.message}`;
  }
  return null;
}

/** RPC 미해석(마이그/스키마캐시 미적용) 이면 skip. */
function skipIfUnresolved(error: { message?: string } | null) {
  if (error && /PGRST202|schema cache|function .* does not exist/i.test(error.message ?? '')) {
    test.skip(true, `RPC 미해석(마이그 미적용): ${error.message}`);
  }
}

const D = '2026-12-02';

test.describe('T-20260721 동행자 연락처 carriage — DB 착지(RPC 표준 진입점)', () => {
  test.beforeAll(purge);
  test.afterAll(purge);

  test('S1 정상표시: 동행 push + customer_real_phone → 착지 + identity(customer_id/phone NULL) 무변', async () => {
    test.skip(!!(await migrationReady()), (await migrationReady()) ?? '');
    const sb = admin();

    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_COMP1,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: null,                        // 동행 무폰(identity)
      p_customer_name: '동행루루',
      p_reservation_date: D,
      p_reservation_time: '10:00:00',
      p_customer_real_name: '동행루루',
      p_customer_real_phone: SHARED_PHONE,           // ← 동행 본인 실 연락처(표시전용)
      p_is_companion: true,
    });
    skipIfUnresolved(error);
    expect(error, `동행 RPC 영속 실패: ${error?.message ?? ''}`).toBeNull();
    expect(rid).toBeTruthy();

    const { data: row, error: selErr } = await sb
      .from('reservations')
      .select('id, customer_id, customer_phone, customer_real_phone, customer_real_name')
      .eq('source_system', SRC).eq('external_id', EXT_COMP1).maybeSingle();
    expect(selErr).toBeNull();
    expect(row, '동행 예약 미영속(무음실패)').toBeTruthy();
    expect(row!.customer_real_phone, '동행자 연락처 착지').toBe(SHARED_PHONE);
    // identity 무변(§1): customer_id / customer_phone 모두 NULL — provision 경로 미개입.
    expect(row!.customer_id, '동행 customer_id NULL 불변(§444/§52)').toBeNull();
    expect(row!.customer_phone, '동행 customer_phone NULL 불변(identity 무변)').toBeNull();
  });

  test('S2 공유폰 엣지: 동행 2건 동일 실 연락처 → 각각 독립행·둘 다 customer_id NULL(collapse 0·§461)', async () => {
    test.skip(!!(await migrationReady()), (await migrationReady()) ?? '');
    const sb = admin();

    // 동행#1 은 S1 에서 착지. 동행#2 를 같은 SHARED_PHONE 으로 push.
    const { error: e2 } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_COMP2,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: null,
      p_customer_name: '동행미미',
      p_reservation_date: D,
      p_reservation_time: '10:30:00',
      p_customer_real_name: '동행미미',
      p_customer_real_phone: SHARED_PHONE,           // 동행#1 과 동일 번호(공유폰)
      p_is_companion: true,
    });
    skipIfUnresolved(e2);
    expect(e2, e2?.message ?? '').toBeNull();

    const { data: rows } = await sb
      .from('reservations')
      .select('id, customer_id, customer_real_phone')
      .eq('source_system', SRC)
      .in('external_id', [EXT_COMP1, EXT_COMP2]);
    expect(rows, '공유폰 동행 2건 조회').toBeTruthy();
    expect(rows!.length, '동행 2건이 각각 독립 예약행(공유폰이라도 merge 안 됨)').toBe(2);
    const ids = new Set(rows!.map((r) => r.id));
    expect(ids.size, '2 distinct reservation id').toBe(2);
    // ★ collapse 0: 공유폰이어도 customer_id 로 귀속/병합되지 않음(phone 은 identity 키 아님, §461/INV-1).
    for (const r of rows!) {
      expect(r.customer_id, `공유폰 동행 collapse 금지 — customer_id NULL 유지 (${r.id})`).toBeNull();
      expect(r.customer_real_phone).toBe(SHARED_PHONE);
    }
  });

  test('S3 null 안전: 동행 push 무-연락처 → 행 영속 + customer_real_phone NULL(FE 행 미렌더)', async () => {
    test.skip(!!(await migrationReady()), (await migrationReady()) ?? '');
    const sb = admin();

    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_COMP_NULL,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: null,
      p_customer_name: '동행무폰',
      p_reservation_date: D,
      p_reservation_time: '11:00:00',
      p_customer_real_name: '동행무폰',
      // p_customer_real_phone 미동봉(=DEFAULT NULL)
      p_is_companion: true,
    });
    skipIfUnresolved(error);
    expect(error, error?.message ?? '').toBeNull();
    expect(rid).toBeTruthy();

    const { data: row } = await sb
      .from('reservations')
      .select('customer_id, customer_real_phone')
      .eq('source_system', SRC).eq('external_id', EXT_COMP_NULL).maybeSingle();
    expect(row, '무-연락처 동행도 정상 영속').toBeTruthy();
    expect(row!.customer_real_phone, '무동봉 → customer_real_phone NULL(null-safe)').toBeNull();
    expect(row!.customer_id).toBeNull();
  });

  test('S4 preserve-on-NULL: 실연락처 착지 후 무-연락처 재push → 기존값 유지(무손실)', async () => {
    test.skip(!!(await migrationReady()), (await migrationReady()) ?? '');
    const sb = admin();

    // EXT_COMP1 은 S1 에서 SHARED_PHONE 착지됨. 같은 external_id 로 무-연락처 재push(edit).
    const { error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_COMP1,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: null,
      p_customer_name: '동행루루',
      p_reservation_date: D,
      p_reservation_time: '10:00:00',
      p_customer_real_name: '동행루루',
      // p_customer_real_phone 미동봉 → COALESCE preserve 로 기존 SHARED_PHONE 유지되어야 함
      p_is_companion: true,
    });
    skipIfUnresolved(error);
    expect(error, error?.message ?? '').toBeNull();

    const { data: row } = await sb
      .from('reservations')
      .select('customer_real_phone')
      .eq('source_system', SRC).eq('external_id', EXT_COMP1).maybeSingle();
    expect(row!.customer_real_phone, '빈값 재push 시 기존 동행연락처 preserve(무손실)').toBe(SHARED_PHONE);
  });

  test('S5 비동행 회귀 0: is_companion 미동봉 → customer_real_phone NULL·customers 링크 유지', async () => {
    test.skip(!!(await migrationReady()), (await migrationReady()) ?? '');
    const sb = admin();

    const { data: rid, error } = await sb.rpc('upsert_reservation_from_source', {
      p_source_system: SRC,
      p_external_id: EXT_MAIN,
      p_clinic_slug: CLINIC_SLUG,
      p_customer_phone: '+821099998888',
      p_customer_name: '[E2E]본예약환자',
      p_reservation_date: D,
      p_reservation_time: '12:00:00',
      // companion 인자 전부 미동봉
    });
    skipIfUnresolved(error);
    expect(error, error?.message ?? '').toBeNull();
    expect(rid).toBeTruthy();

    const { data: row } = await sb
      .from('reservations')
      .select('customer_id, customer_real_phone')
      .eq('source_system', SRC).eq('external_id', EXT_MAIN).maybeSingle();
    expect(row?.customer_id, '비동행 customers 링크 유지').toBeTruthy();
    expect(row?.customer_real_phone, '비동행은 동행연락처 미착지(회귀 0)').toBeNull();
  });
});

test.describe('T-20260721 정적 가드 — 마이그 ADDITIVE + FE 표시 계약', () => {
  test('마이그: customer_real_phone 컬럼 ADD(멱등) + RPC persist 절 + signature 18-arg 불변', () => {
    const sql = readFileSync(
      path.join(REPO_ROOT, 'supabase/migrations/20260721150000_foot_reservations_customer_real_phone_add.sql'),
      'utf8',
    );
    // (1) ADDITIVE 컬럼 — 멱등 가드
    expect(sql).toMatch(/ALTER TABLE public\.reservations\s+ADD COLUMN IF NOT EXISTS customer_real_phone TEXT/);
    // (2) persist 절 — INSERT + ON CONFLICT preserve-on-NULL
    expect(sql).toContain('customer_real_name, customer_real_phone, brief_note');
    expect(sql).toMatch(/customer_real_phone = COALESCE\(NULLIF\(btrim\(EXCLUDED\.customer_real_phone\),''\), reservations\.customer_real_phone\)/);
    // signature 18-arg 불변(동행 identity 분기 무변)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source');
    expect(sql).toContain('p_is_companion        BOOLEAN DEFAULT false');
    expect(sql).toContain('v_customer_id := NULL;');  // 동행 identity 분기 보존
    // 롤백 동봉
    // (파일 존재만 확인 — 내용은 rollback SOP)
    const rb = readFileSync(
      path.join(REPO_ROOT, 'supabase/migrations/20260721150000_foot_reservations_customer_real_phone_add.rollback.sql'),
      'utf8',
    );
    expect(rb).toContain('DROP COLUMN IF EXISTS customer_real_phone');
  });

  test('FE: 예약상세 팝업이 동행자 연락처 행을 값-존재 조건부(null-safe)로 렌더', () => {
    const tsx = readFileSync(
      path.join(REPO_ROOT, 'src/components/ReservationDetailPopup.tsx'),
      'utf8',
    );
    // 값 있을 때만 렌더(null-safe) — reservation.customer_real_phone truthy + trim 가드
    expect(tsx).toMatch(/reservation\.customer_real_phone\s*&&\s*reservation\.customer_real_phone\.trim\(\)\s*!==\s*''/);
    expect(tsx).toMatch(/label="동행자 연락처"/);
    expect(tsx).toContain('formatPhone(reservation.customer_real_phone)');
  });
});
