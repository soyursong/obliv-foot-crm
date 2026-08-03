/**
 * E2E spec — T-20260803-foot-INFLOW-RESVFORM-DROPDOWN-WIRING (P1, broken-lane fix)
 *
 * 배경(확정 근본원인, 갭 a):
 *   원본 lane(T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE, deployed)은 DB/RPC/11코드 시드는 prod 적용 완료이나,
 *   접수 드롭다운을 방문접수(NewCheckInDialog.tsx)에만 배선하고 사전예약 접수 폼(Reservations.tsx / 팝업 new-mode
 *   ReservationDetailPopup.tsx)엔 통째 누락 → 사전예약 신규 전량 inflow_channel=null → CEO 실측 foot 0%(reservations grain)
 *   의 주 근본원인.
 *
 * fix: longre 정본 AdminReservations.tsx 패턴(useInflowChannels + <select data-testid=resv-inflow-select>
 *   + inflow.available 조건부 강제선택 + inbound.etc 사유필수 + 구환 first_inflow_channel 자동상속 면제)을
 *   두 사전예약 접수 진입점(ReservationEditor / ReservationDetailPopup new-mode)에 이식. ADDITIVE FE·no-DDL.
 *
 * 검증(배선 정적 + 백엔드 계약 — 로그인 비의존, 형제 foot spec 동형):
 *   시나리오1(정상 동선)   → 두 진입점에 resv-inflow-select 배선 + available 조건부 강제선택 게이트 실재.
 *   시나리오2(inbound.etc)  → requiresReason 기반 사유필수 입력란 + 게이트 배선 + RPC requires_reason 계약.
 *   시나리오3(TM 면제)      → 수기 폼 게이트가 inflow.available/구환상속에 한해서만 강제(TM=EF 경로 미도달) — created_via 무접점.
 *   §36 방화벽             → 신규 inflow 배선은 reservations.inflow_channel + customers.first_inflow_*(inflow 축)만 write.
 *                            referral_source / lead_source / visit_route 로의 유입경로 write 무접점.
 *   no-DDL                 → 신규 마이그레이션 파일 미생성(원본 lane 산출물 재사용).
 *   백엔드 계약(배포후)     → get_inflow_channels 11코드 반환 + inbound.etc.requires_reason=true.
 *
 * 티켓: T-20260803-foot-INFLOW-RESVFORM-DROPDOWN-WIRING
 * 부모: T-20260803-xcrm-INFLOW-CHANNEL-4CRM-EFFECTIVENESS-DIAG
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
const RESV_POPUP = 'src/components/ReservationDetailPopup.tsx';
const HOOK = 'src/hooks/useInflowChannels.ts';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function migrationApplied(service: SupabaseClient): Promise<boolean> {
  const { error } = await service.rpc('get_inflow_channels', {
    p_clinic_id: '00000000-0000-0000-0000-000000000000',
  });
  if (error?.message?.match(/Could not find the function/i)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오1 — 정상 동선: 두 진입점에 유입경로 드롭다운 배선 + 조건부 강제선택 게이트
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1: 사전예약 접수 폼 유입경로 드롭다운 배선(정상 동선)', () => {
  test('AC1-a: ReservationEditor(secondary nav)에 useInflowChannels + resv-inflow-select 배선', () => {
    const src = read(RESERVATIONS);
    expect(src, 'useInflowChannels 훅 도입').toMatch(/useInflowChannels/);
    expect(src, "유입경로 <select data-testid='resv-inflow-select'> 렌더").toMatch(/data-testid="resv-inflow-select"/);
    // inflow.available 조건부 렌더(배포순서 graceful)
    expect(src, 'inflow.available 조건부 렌더').toMatch(/inflow\.available/);
    // 11코드 옵션 소스 = inflow.options
    expect(src, 'inflow.options 로 옵션 렌더').toMatch(/inflow\.options\.map/);
  });

  test('AC1-b: ReservationDetailPopup(팝업 new-mode)에도 동일 배선', () => {
    const src = read(RESV_POPUP);
    expect(src, 'useInflowChannels 훅 도입').toMatch(/useInflowChannels/);
    expect(src, "resv-inflow-select 렌더").toMatch(/data-testid="resv-inflow-select"/);
    expect(src, 'inflow.available 조건부 렌더').toMatch(/inflow\.available/);
  });

  test('AC1-c: 미선택 저장 차단 게이트(available=true 전제) — 두 진입점', () => {
    const editor = read(RESERVATIONS);
    // ReservationEditor 게이트: inflow.available && !state.inflow_channel → 차단
    expect(editor, 'ReservationEditor 미선택 차단 게이트').toMatch(/inflow\.available[\s\S]{0,80}!state\.inflow_channel/);
    expect(editor, '유입경로 선택 안내 토스트').toMatch(/유입경로를 선택하세요/);

    const popup = read(RESV_POPUP);
    expect(popup, 'ReservationDetailPopup 미선택 차단 게이트').toMatch(/inflow\.available[\s\S]{0,60}!inflowChannel/);
    expect(popup, '유입경로 선택 안내 토스트').toMatch(/유입경로를 선택하세요/);
  });

  test('AC1-d: 선택값이 write payload(inflow_channel)로 전달 — createReservationCanonical 위임', () => {
    const editor = read(RESERVATIONS);
    // ReservationEditor → createReservationCanonical({ inflow_channel: state.inflow_channel ... })
    expect(editor, 'inflow_channel payload 전달').toMatch(/inflow_channel:\s*state\.inflow_channel/);
    // parent onCreateReservation → 단일 write-path 위임
    expect(editor, 'parent 위임 inflow_channel').toMatch(/inflow_channel:\s*params\.inflow_channel/);
    const popup = read(RESV_POPUP);
    expect(popup, '팝업 inflow_channel payload 전달').toMatch(/inflow_channel:\s*\(!loadedMatch\s*&&\s*inflowChannel\)/);
  });

  test('AC1-e: 구환(기존 고객)은 최초유입 자동상속 → 강제선택 면제(재입력 요구 X)', () => {
    const editor = read(RESERVATIONS);
    // inheritedInflow 보유 시 게이트 면제 + 읽기전용 표시
    expect(editor, 'inheritedInflow 상속값 조회').toMatch(/inheritedInflow/);
    expect(editor, '구환 면제 게이트(!inheritedInflow)').toMatch(/!inheritedInflow\s*&&\s*inflow\.available/);
    expect(editor, '상속 읽기전용 표시').toMatch(/resv-inflow-inherited/);
    const popup = read(RESV_POPUP);
    // 팝업: 신규(미식별=!loadedMatch)에서만 노출·강제
    expect(popup, '팝업 신규 접수에서만 강제(!loadedMatch)').toMatch(/isNewCustomer\s*=\s*!loadedMatch/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오2 — inbound.etc 사유 필수
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2: inbound.etc(기타) 선택 시 사유 필수', () => {
  test('AC2-a: requiresReason 기반 사유 입력란 조건부 노출 + 저장 게이트 — 두 진입점', () => {
    const editor = read(RESERVATIONS);
    expect(editor, '사유 입력란 조건부 노출').toMatch(/inflow\.requiresReason\(state\.inflow_channel\)/);
    expect(editor, '사유 필수 게이트').toMatch(/requiresReason\(state\.inflow_channel\)\s*&&\s*!inflowReason\.trim\(\)/);
    expect(editor, '기타 사유 안내 토스트').toMatch(/기타 유입경로는 사유를 입력하세요/);
    expect(editor, 'resv-inflow-etc 입력란').toMatch(/data-testid="resv-inflow-etc"/);

    const popup = read(RESV_POPUP);
    expect(popup, '팝업 사유 필수 게이트').toMatch(/requiresReason\(inflowChannel\)\s*&&\s*!inflowReason\.trim\(\)/);
    expect(popup, '팝업 resv-inflow-etc 입력란').toMatch(/data-testid="resv-inflow-etc"/);
  });

  test('AC2-b: 사유는 inflow 축 컬럼(first_inflow_source_ref)에만 stamp — walk-in 컨벤션 동일', () => {
    const editor = read(RESERVATIONS);
    // createReservationCanonical: inbound.etc 사유 → first_inflow_source_ref
    expect(editor, 'first_inflow_source_ref stamp').toMatch(/first_inflow_source_ref/);
    // referral_source 로 유입경로/사유 write 무접점(§36 방화벽)
    expect(editor, '§36: referral_source 로 inflow write 금지').not.toMatch(/referral_source:\s*(state\.inflow|input\.inflow|inflowReason|inflowChannel)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오3 — TM(도파민) 예약 강제선택 면제 (원본 lane 계승)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3: TM(source_system=dopamine) 자동귀속 예약 강제선택 면제', () => {
  test('AC3: 강제선택은 수기 폼(inflow.available/구환상속) 게이트에 한정 — TM(EF 경로) 미도달', () => {
    const editor = read(RESERVATIONS);
    // 게이트는 available && !state.inflow_channel 조건에만 발동 → TM은 이 수기 폼을 타지 않음(EF 자동귀속).
    // 폼 게이트에서 source_system=dopamine 를 직접 검사하지 않음(구조적 면제 = 경로 분리).
    expect(editor, 'TM 강제 우회 로직이 폼 게이트에 부재(경로 분리)').not.toMatch(/state\.inflow_channel[\s\S]{0,40}source_system/);
    // 게이트가 반드시 available 로 가드됨(RPC 부재/미배포 무중단)
    expect(editor, 'available 가드된 게이트').toMatch(/inflow\.available/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §36 방화벽 — write 대상은 오직 inflow 축(reservations.inflow_channel + customers.first_inflow_*)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('§36 방화벽: inflow_channel 축으로만 write(referral_source FREEZE)', () => {
  //   ⚠ legacy referral_source ← visit_route / lead_source 병행축(§36 FREEZE 유지)은 pre-existing — 정리 대상 아님.
  //   본 가드는 "본 티켓 신규 유입경로(inflow) 값이 referral_source/lead_source/visit_route 로 새는지"만 검사.
  test('firewall-a: 신규 배선이 referral_source/lead_source/visit_route 로 유입경로(inflow) 값 write 안 함', () => {
    for (const f of [RESERVATIONS, RESV_POPUP]) {
      const src = read(f);
      // inflow 값(inflowChannel/inflowReason/state.inflow_channel/input.inflow_channel/effectiveInflow)을
      // legacy 3축 컬럼으로 write 하는 라인이 없어야 함(§36 방화벽).
      expect(src, `${f}: lead_source 로 inflow write 금지`).not.toMatch(/lead_source:\s*(inflow|state\.inflow|input\.inflow|effectiveInflow)/i);
      expect(src, `${f}: referral_source 로 inflow write 금지`).not.toMatch(/referral_source:\s*(inflow|state\.inflow|input\.inflow|effectiveInflow)/i);
      expect(src, `${f}: visit_route 로 inflow write 금지`).not.toMatch(/visit_route:\s*(inflow|state\.inflow|input\.inflow|effectiveInflow)/i);
    }
  });

  test('firewall-b: reservations INSERT payload 의 유입경로 컬럼 = inflow_channel', () => {
    const src = read(RESERVATIONS);
    // createReservationCanonical INSERT payload: inflow_channel: effectiveInflow
    expect(src, 'reservations.inflow_channel 로만 각인').toMatch(/inflow_channel:\s*effectiveInflow/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// no-DDL — 신규 마이그레이션 파일 미생성(원본 lane 산출물 재사용)
// ─────────────────────────────────────────────────────────────────────────────
test('no-DDL: 본 티켓 신규 마이그레이션 파일 미생성', () => {
  const migDir = path.resolve(ROOT, 'supabase/migrations');
  if (!fs.existsSync(migDir)) return; // 마이그 디렉터리 부재 환경 skip
  const own = fs.readdirSync(migDir).filter((f) => /RESVFORM-DROPDOWN-WIRING|resvform_dropdown/i.test(f));
  expect(own, `본 티켓 마이그 파일 미생성(no-DDL): ${own.join(', ')}`).toHaveLength(0);
});

// 훅 계약 정적 가드 — RPC 미배포 graceful([] → available=false 완화)
test('hook: useInflowChannels RPC 미배포 시 graceful([] 반환, throw 금지)', () => {
  const src = read(HOOK);
  expect(src, 'get_inflow_channels RPC 조회').toMatch(/get_inflow_channels/);
  expect(src, 'available = options.length > 0').toMatch(/available:\s*options\.length\s*>\s*0/);
  expect(src, 'requiresReason 판별 노출').toMatch(/requiresReason:/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 백엔드 계약(배포후, service_role) — 원본 lane 산출물 재사용 회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('백엔드 계약: get_inflow_channels 11코드 + inbound.etc requires_reason(원본 lane 재사용)', () => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY, 'Supabase 자격 없음(로컬 FE-only) — DB 계약 검증 skip');

  test('시나리오1 enabler: get_inflow_channels 가 canonical 11코드를 반환', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용 — 배포후 재실행 forward-guard');
    const { data: clinics } = await service.from('clinics').select('id').limit(1);
    const clinicId = (clinics as { id: string }[] | null)?.[0]?.id;
    test.skip(!clinicId, 'clinics 행 없음 — skip');
    const { data, error } = await service.rpc('get_inflow_channels', { p_clinic_id: clinicId });
    expect(error, `RPC 오류: ${error?.message}`).toBeNull();
    const codes = ((data ?? []) as { code: string }[]).map((r) => r.code);
    expect(codes.length, '오버레이 노출 코드 존재').toBeGreaterThan(0);
    // 대표 canonical 코드 실재
    expect(codes).toContain('inbound.phone');
    expect(codes).toContain('inbound.etc');
  });

  test('시나리오2 enabler: inbound.etc = requires_reason true, inbound.phone = false', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용 — 배포후 재실행 forward-guard');
    const { data: clinics } = await service.from('clinics').select('id').limit(1);
    const clinicId = (clinics as { id: string }[] | null)?.[0]?.id;
    test.skip(!clinicId, 'clinics 행 없음 — skip');
    const { data } = await service.rpc('get_inflow_channels', { p_clinic_id: clinicId });
    const rows = ((data ?? []) as { code: string; requires_reason: boolean | null }[]);
    const etc = rows.find((r) => r.code === 'inbound.etc');
    const phone = rows.find((r) => r.code === 'inbound.phone');
    if (etc) expect(etc.requires_reason, 'inbound.etc.requires_reason=true').toBe(true);
    if (phone) expect(!!phone.requires_reason, 'inbound.phone.requires_reason=false').toBe(false);
  });
});
