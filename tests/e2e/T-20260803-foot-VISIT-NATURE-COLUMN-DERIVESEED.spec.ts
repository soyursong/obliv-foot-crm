/**
 * E2E spec — T-20260803-foot-VISIT-NATURE-COLUMN-DERIVESEED (P1, ADDITIVE)
 *
 * 부모: T-20260803-xcrm-VISIT-NATURE-AXIS-STANDARDIZE (DA GO ADDITIVE)
 * SSOT: da_replies/da_decision_xcrm_visit_nature_axis_standardize_20260803.md
 *
 * 배경: visit_nature(방문성격, per-visit 본질) 축을 5-CRM 표준화. 풋센터는 신규 visit_nature 컬럼 ADDITIVE 신설
 *   + system_codes 4값(new/fulfillment/revisit/experience) + code_availability 오버레이(foot 은 experience 미노출)
 *   + 보수적 derive-seed 백필(visit_type new→new / returning→revisit, fulfillment 오버매핑 금지).
 *   배선 surface = deployed inflow lane(T-20260801) intake surface 편승(신규 write surface 신설 금지).
 *
 * 검증(배선 정적 + 백엔드 계약 — 로그인 비의존, 형제 foot spec 동형):
 *   시나리오1(신규)     → picker '신규(new)' 선택 → visit_nature='new' write.
 *   시나리오2(재방문)   → picker '재방문(revisit)' → visit_nature='revisit'(분모 포함). returning 이 자동 fulfillment 로 안 들어감.
 *   시나리오3(회차권 이행)→ 스태프가 '이행(fulfillment)' 명시 선택 → visit_nature='fulfillment'(AOV 분모 제외 대상).
 *   ADDITIVE/무접촉      → visit_type 컬럼 무접촉(in-place overwrite 없음). derive-seed 는 신규 컬럼에만 write.
 *   보수적 백필          → 크로스워크에 fulfillment 자동매핑 부재(returning→revisit 고정).
 *   백엔드 계약(배포후)   → get_visit_natures 가 foot 에서 experience 제외 3종(new/revisit/fulfillment) 반환.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf-8');

const RESERVATIONS = 'src/pages/Reservations.tsx';
const CHECKIN = 'src/components/NewCheckInDialog.tsx';
const HOOK = 'src/hooks/useVisitNatures.ts';
const TYPES = 'src/lib/types.ts';
const MIG = 'supabase/migrations/20260803230000_foot_visit_nature_intake_lane.sql';
const BACKFILL = 'supabase/migrations/20260803230500_foot_visit_nature_derive_seed_backfill.sql';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function migrationApplied(service: SupabaseClient): Promise<boolean> {
  const { error } = await service.rpc('get_visit_natures', {
    p_clinic_id: '00000000-0000-0000-0000-000000000000',
  });
  if (error?.message?.match(/Could not find the function/i)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// DDL 마이그레이션 — visit_nature 컬럼 ADDITIVE + system_codes 4값 + experience 오버레이 + RPC
// ─────────────────────────────────────────────────────────────────────────────
test.describe('DDL: visit_nature 컬럼 ADDITIVE 신설 + system_codes 4값 + 오버레이 + RPC', () => {
  test('mig-a: reservations/check_ins 에 visit_nature nullable ADD COLUMN(IF NOT EXISTS)', () => {
    const src = read(MIG);
    expect(src).toMatch(/ALTER TABLE public\.reservations ADD COLUMN IF NOT EXISTS visit_nature text/);
    expect(src).toMatch(/ALTER TABLE public\.check_ins ADD COLUMN IF NOT EXISTS visit_nature text/);
    // NOT NULL/DEFAULT 강제 없음(nullable ADDITIVE)
    expect(src, 'visit_nature 는 nullable(NOT NULL 강제 금지)').not.toMatch(/visit_nature text NOT NULL/);
  });

  test('mig-b: system_codes code_type=visit_nature 4값 시드(new/revisit/fulfillment/experience)', () => {
    const src = read(MIG);
    for (const code of ['new', 'revisit', 'fulfillment', 'experience']) {
      expect(src, `code_type=visit_nature ${code} 시드`).toMatch(new RegExp(`'visit_nature',\\s*'${code}'`));
    }
    expect(src, 'ON CONFLICT DO NOTHING 멱등').toMatch(/ON CONFLICT \(code_type, code\) DO NOTHING/);
  });

  test('mig-c: foot 은 experience 미노출 — code_availability is_available=false 오버레이', () => {
    const src = read(MIG);
    expect(src, 'experience 오버레이 삽입(전 clinic)').toMatch(/'visit_nature',\s*'experience',\s*c\.id,\s*false/);
    expect(src, 'clinics 전체 대상 INSERT..SELECT').toMatch(/FROM public\.clinics c/);
  });

  test('mig-d: get_visit_natures RPC = system_codes ∩ 오버레이(inflow lane 동형)', () => {
    const src = read(MIG);
    expect(src).toMatch(/CREATE OR REPLACE FUNCTION public\.get_visit_natures\(p_clinic_id uuid\)/);
    expect(src).toMatch(/sc\.code_type = 'visit_nature'/);
    expect(src).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_visit_natures\(uuid\) TO authenticated, anon/);
  });

  test('mig-e: visit_type 무접촉(in-place overwrite 없음) — DESTRUCTIVE 경로 부재', () => {
    const src = read(MIG);
    // DDL 마이그가 visit_type 을 UPDATE/DROP/타입변경 하지 않음(직교 축 방화벽)
    expect(src, 'visit_type UPDATE 금지').not.toMatch(/UPDATE[\s\S]{0,40}SET visit_type/);
    expect(src, 'visit_type DROP 금지').not.toMatch(/DROP COLUMN[\s\S]{0,20}visit_type/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// derive-seed 백필 — 보수적 크로스워크 + SOP 봉투(archive-first/freeze/assert)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('derive-seed 백필: 보수적 크로스워크(new→new / returning→revisit) + SOP 봉투', () => {
  test('bf-a: 크로스워크 = new→new / returning→revisit (fulfillment 오버매핑 부재)', () => {
    const src = read(BACKFILL);
    expect(src, 'new→new / returning→revisit CASE').toMatch(/CASE\s+\w+\.visit_type\s+WHEN 'new' THEN 'new' WHEN 'returning' THEN 'revisit' ELSE NULL END/);
    // returning 을 fulfillment 로 매핑하는 라인 부재(보수적)
    expect(src, "returning→fulfillment 자동매핑 금지").not.toMatch(/WHEN 'returning' THEN 'fulfillment'/);
  });

  test('bf-b: archive-first freeze 스냅샷 + apply직전 재검증(visit_nature IS NULL) + 멱등', () => {
    const src = read(BACKFILL);
    expect(src, 'archive-first freeze 테이블').toMatch(/CREATE TABLE IF NOT EXISTS public\.archive_visit_nature_deriveseed_20260803/);
    expect(src, 'apply직전 재검증 = visit_nature IS NULL').toMatch(/AND r\.visit_nature IS NULL/);
    expect(src, 'freeze INSERT 멱등(ON CONFLICT DO NOTHING)').toMatch(/ON CONFLICT \(anchor_table, row_id\) DO NOTHING/);
  });

  test('bf-c: rows-affected assert — fulfillment 오버매핑 0 + freeze 잔여 NULL 0', () => {
    const src = read(BACKFILL);
    expect(src, 'fulfillment 오버매핑 assert').toMatch(/fulfillment 오버매핑/);
    expect(src, '잔여 NULL assert').toMatch(/잔여 NULL/);
  });

  test('bf-d: visit_type 컬럼 무접촉(신규 visit_nature 컬럼에만 write)', () => {
    const src = read(BACKFILL);
    expect(src, 'visit_type SET 금지').not.toMatch(/SET visit_type/);
    expect(src, 'visit_nature 만 SET').toMatch(/SET visit_nature =/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1/2/3 — FE picker 배선(walk-in + 예약 접수 폼)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1~3: visit_nature picker 배선(default 크로스워크 + fulfillment 명시 선택)', () => {
  test('AC-a: walk-in(NewCheckInDialog)에 useVisitNatures + checkin-visit-nature picker', () => {
    const src = read(CHECKIN);
    expect(src, 'useVisitNatures 훅 도입').toMatch(/useVisitNatures/);
    expect(src, 'picker 렌더').toMatch(/data-testid="checkin-visit-nature"/);
    expect(src, 'available 조건부 렌더(배포순서 graceful)').toMatch(/visitNat\.available/);
    expect(src, 'visit_nature write payload').toMatch(/visit_nature:/);
  });

  test('AC-b: 예약 접수 폼(ReservationEditor)에 동일 배선(inflow lane surface 편승)', () => {
    const src = read(RESERVATIONS);
    expect(src, 'useVisitNatures 훅 도입').toMatch(/useVisitNatures/);
    expect(src, 'picker 렌더').toMatch(/data-testid="resv-visit-nature-select"/);
    expect(src, 'available 조건부 렌더').toMatch(/visitNat\.available/);
  });

  test('AC-c: forward default 크로스워크 = new→new / returning→revisit (deriveVisitNatureDefault)', () => {
    const hook = read(HOOK);
    expect(hook, 'deriveVisitNatureDefault export').toMatch(/export function deriveVisitNatureDefault/);
    expect(hook, 'new→new').toMatch(/visitType === 'new'\)\s*return 'new'/);
    expect(hook, 'returning→revisit').toMatch(/visitType === 'returning'\)\s*return 'revisit'/);
    expect(hook, '미포착 → null(강제 대입 금지)').toMatch(/return null/);
    // FE 가 default 파생을 write 경로에 사용
    for (const f of [CHECKIN, RESERVATIONS]) {
      expect(read(f), `${f}: deriveVisitNatureDefault 사용`).toMatch(/deriveVisitNatureDefault/);
    }
  });

  test('AC-d: fulfillment 는 스태프 명시 선택(touched) — 자동승격 로직 부재', () => {
    for (const f of [CHECKIN, RESERVATIONS]) {
      const src = read(f);
      // 스태프 override 플래그(touched) 존재 = 자동 대입과 분리
      expect(src, `${f}: visitNatureTouched override 플래그`).toMatch(/visitNatureTouched/);
    }
  });

  test('AC-e: VisitNature 타입 = new/revisit/fulfillment/experience', () => {
    const src = read(TYPES);
    expect(src).toMatch(/export type VisitNature = 'new' \| 'revisit' \| 'fulfillment' \| 'experience'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 훅 계약 — RPC 미배포 graceful([] → available=false)
// ─────────────────────────────────────────────────────────────────────────────
test('hook: useVisitNatures RPC 미배포 시 graceful([] 반환, throw 금지)', () => {
  const src = read(HOOK);
  expect(src, 'get_visit_natures RPC 조회').toMatch(/get_visit_natures/);
  expect(src, 'available = options.length > 0').toMatch(/available:\s*options\.length\s*>\s*0/);
  expect(src, 'RPC 에러 시 [] 반환(throw 금지)').toMatch(/return \[\]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 백엔드 계약(배포후, service_role) — get_visit_natures foot 노출 3종(experience 제외)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('백엔드 계약: get_visit_natures = foot 노출 new/revisit/fulfillment(experience 오버레이 숨김)', () => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY, 'Supabase 자격 없음(로컬 FE-only) — DB 계약 검증 skip');

  test('시나리오 enabler: foot 은 experience 제외 3종 반환', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용 — 배포후 재실행 forward-guard');
    const { data: clinics } = await service.from('clinics').select('id').limit(1);
    const clinicId = (clinics as { id: string }[] | null)?.[0]?.id;
    test.skip(!clinicId, 'clinics 행 없음 — skip');
    const { data, error } = await service.rpc('get_visit_natures', { p_clinic_id: clinicId });
    expect(error, `RPC 오류: ${error?.message}`).toBeNull();
    const codes = ((data ?? []) as { code: string }[]).map((r) => r.code);
    expect(codes).toContain('new');
    expect(codes).toContain('revisit');
    expect(codes).toContain('fulfillment');
    expect(codes, 'foot 은 experience 미노출(body 전용)').not.toContain('experience');
  });
});
