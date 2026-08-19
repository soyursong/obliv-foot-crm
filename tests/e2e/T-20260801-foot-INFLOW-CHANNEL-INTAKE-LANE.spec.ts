/**
 * T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE
 *   유입경로 inflow_channel 신규 필드 + 11코드 접수 필수입력 — 풋센터(obliv-foot-crm).
 *
 * 부모: T-20260801-xcrm-INFLOW-CHANNEL-11CODE-INTAKE (큐카드 v1.2 ★1, CEO).
 * DA CONSULT-REPLY 조건부 GO(ADDITIVE) / codify=cross_crm_data_contract.md §36(v1.66).
 *
 * 구현(요약):
 *   · migration 20260801230000_foot_inflow_channel_intake_lane.sql
 *       - dual-anchor 물리 3컬럼(전량 nullable ADDITIVE):
 *           reservations.inflow_channel / check_ins.inflow_channel /
 *           customers.first_inflow_channel(+first_inflow_at+first_inflow_source_ref)
 *       - system_codes(code_type='inflow_channel') 11종 시드 + code_availability 오버레이
 *       - get_inflow_channels(p_clinic_id) RPC(system_codes ∩ 오버레이)
 *   · src/hooks/useInflowChannels.ts — 옵션 로더(RPC 미배포 시 [] graceful, 강제선택 게이트 완화)
 *   · src/components/NewCheckInDialog.tsx — 신규(미식별) 접수 유입경로 필수 드롭다운 + 기타 사유필수 +
 *       customers.first_inflow_channel first-write-wins + check_ins.inflow_channel 이벤트 캡처
 *   · src/pages/Reservations.tsx — 예약행 inflow_channel 영속 + customers first-write-wins 상속
 *       (예약/재예약 UI 강제선택 없음 — T-20260520-foot-RESV-INFLOW-HIDE 확정 정책과 정합)
 *
 * ★ 이 spec 은 백엔드 계약(dual-anchor 컬럼·11코드·requires_reason·RPC 오버레이)을 실 DB(service_role)로
 *    검증한다. 4개 현장 시나리오의 백엔드 인에이블러를 회귀 가드:
 *      - 시나리오1(신규 접수 필수 선택)  → get_inflow_channels 가 11코드를 반환(드롭다운 소스 실재)
 *      - 시나리오2(기타 사유 필수)        → inbound.etc.requires_reason=true, 그 외 false
 *      - 시나리오3(재진 재예약 자동 상속) → customers.first_inflow_channel 컬럼 실재(first-write-wins 앵커)
 *      - 시나리오4(TM 자동귀속)          → 이벤트 앵커(reservations/check_ins.inflow_channel) 실재(강제선택 앱-레이어 면제)
 *    forward-guard: 마이그 미적용(RPC 부재) 시 배포전 실행이므로 test.skip(배포후 supervisor 재실행).
 *
 * 티켓: T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ★ T-20260819-foot-INFLOW-KAKAO-CANONICAL-CODE-ADD: inbound.kakao(카톡) 12번째 canonical 코드 ADDITIVE 추가.
//   기존 11코드 무변(회귀 0) — 이 목록은 canonical 코드 셋의 SSOT 회귀 가드로 12종을 반영한다.
const EXPECTED_CODES = [
  'inbound.walkin',
  'inbound.phone',
  'inbound.naver_place',
  'inbound.homepage',
  'inbound.kakao',
  'inbound.referral',
  'inbound.revisit',
  'inbound.etc',
  'partner.agency',
  'internal.center_referral',
  'internal.transfer',
  'internal.staff',
];

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 마이그 적용 여부 프로브 — get_inflow_channels 부재 시 배포전 상태로 판단. */
async function migrationApplied(service: SupabaseClient): Promise<boolean> {
  const { error } = await service.rpc('get_inflow_channels', {
    p_clinic_id: '00000000-0000-0000-0000-000000000000',
  });
  if (error?.message?.match(/Could not find the function/i)) return false;
  return true;
}

test.describe('T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE — 유입경로 접수 필수입력 백엔드 계약', () => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY, 'Supabase 자격 없음(로컬 FE-only) — DB 계약 검증 skip');

  // ── 시나리오1: 드롭다운 소스 = get_inflow_channels 가 11코드를 반환 ──
  test('시나리오1: get_inflow_channels 가 11종 canonical 코드를 반환(드롭다운 소스 실재)', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용(get_inflow_channels 부재) — 배포후 재실행 forward-guard');

    // 임의 clinic 하나(오버레이 미설정 → 전체 노출 기대)
    const { data: clinics } = await service.from('clinics').select('id').limit(1);
    const clinicId = (clinics as { id: string }[] | null)?.[0]?.id;
    test.skip(!clinicId, 'clinics 행 없음 — 오버레이 테스트 skip');

    const { data, error } = await service.rpc('get_inflow_channels', { p_clinic_id: clinicId });
    expect(error, `RPC 오류: ${error?.message}`).toBeNull();
    const codes = ((data ?? []) as { code: string }[]).map((r) => r.code).sort();
    // 오버레이 미설정 clinic → 11종 전량 노출
    expect(codes).toEqual([...EXPECTED_CODES].sort());
  });

  // ── 시나리오2: inbound.etc 사유 필수 플래그 ──
  test('시나리오2: system_codes inbound.etc.requires_reason=true, 그 외 10종 false', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용 — forward-guard skip');

    const { data, error } = await service
      .from('system_codes')
      .select('code, requires_reason')
      .eq('code_type', 'inflow_channel');
    expect(error, `system_codes 조회 오류: ${error?.message}`).toBeNull();

    const rows = (data ?? []) as { code: string; requires_reason: boolean }[];
    // T-20260819-KAKAO-CANONICAL: inbound.kakao ADDITIVE 로 12종(기존 11 + 카톡). 회귀 가드 = 유실 0.
    expect(rows.length, '12종 시드 기대(기존 11 + inbound.kakao)').toBe(12);
    const etc = rows.find((r) => r.code === 'inbound.etc');
    expect(etc?.requires_reason, 'inbound.etc 사유 필수').toBe(true);
    const kakao = rows.find((r) => r.code === 'inbound.kakao');
    expect(kakao?.requires_reason, 'inbound.kakao 사유 불요').toBe(false);
    const others = rows.filter((r) => r.code !== 'inbound.etc');
    expect(others.every((r) => r.requires_reason === false), '기타 외 전부 사유 불요').toBe(true);
  });

  // ── 시나리오3: 재진 재예약 자동 상속 앵커(first-write-wins) 컬럼 실재 ──
  test('시나리오3: customers.first_inflow_channel/at/source_ref 컬럼 실재(nullable ADDITIVE 상속앵커)', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용 — forward-guard skip');

    // 컬럼 부재 시 supabase 가 "column ... does not exist" 오류 → 실재 검증.
    const { error } = await service
      .from('customers')
      .select('first_inflow_channel, first_inflow_at, first_inflow_source_ref')
      .limit(1);
    expect(error, `customers 상속앵커 컬럼 부재: ${error?.message}`).toBeNull();
  });

  // ── 시나리오4: TM 자동귀속 = 이벤트 앵커 컬럼 실재(강제선택은 앱-레이어 면제) ──
  test('시나리오4: reservations/check_ins.inflow_channel 이벤트 앵커 컬럼 실재', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용 — forward-guard skip');

    const r = await service.from('reservations').select('inflow_channel').limit(1);
    expect(r.error, `reservations.inflow_channel 부재: ${r.error?.message}`).toBeNull();
    const c = await service.from('check_ins').select('inflow_channel').limit(1);
    expect(c.error, `check_ins.inflow_channel 부재: ${c.error?.message}`).toBeNull();
  });

  // ── carve-out 회귀 가드: partner.agency 는 코드만 등록(목록 노출), write-path 미구현 ──
  test('carve-out: partner.agency 코드는 등록되되(목록 노출) 별도 staff role/RLS 신설 없음', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용 — forward-guard skip');

    const { data } = await service
      .from('system_codes')
      .select('code, label')
      .eq('code_type', 'inflow_channel')
      .eq('code', 'partner.agency')
      .maybeSingle();
    expect((data as { code: string } | null)?.code, 'partner.agency 코드 등록됨').toBe('partner.agency');
    // write-path(agency staff role) 기능은 본 lane 제외 = T-20260801-xcrm-INFLOW-PARTNER-AGENCY-WRITEPATH-DAGATE.
  });
});
