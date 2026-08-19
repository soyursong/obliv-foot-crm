/**
 * T-20260819-foot-INFLOW-KAKAO-CANONICAL-CODE-ADD
 *   유입경로 canonical 신규코드 inbound.kakao(카톡) 추가 — 풋센터(obliv-foot-crm).
 *
 * DA CONSULT-REPLY GO (MSG-20260819-120836-9pqg):
 *   Q1(a) inbound.kakao ADDITIVE CONDITIONAL-GO (진성 distinct 1급 inbound 채널 · naver_place/homepage peer).
 *   Q1(b) display-variant REJECT-as-default · Q2 forward-only · Q3 foot-only overlay(cross-CRM DECOUPLE).
 *   SSOT = da_decision_foot_inflow_kakao_canonical_code_add_20260819.md.
 *
 * 구현(요약):
 *   · migration 20260819230000_foot_inflow_kakao_canonical_code_add.sql
 *       - system_codes INSERT 1행: inbound.kakao (label='카톡', series='inbound', sort_order=3, requires_reason=false)
 *       - 순수 ADDITIVE: 기존 11코드 DROP/rename/semantic/sort_order UPDATE 0 · backfill 0 · forward-only.
 *       - foot-only overlay(default-available): code_availability is_available=false 행 미삽입 → foot 전 clinic 노출.
 *   · src/lib/inflowSelfReportCrosswalk.ts — 카카오톡 셀프리포트 → inbound.kakao advisory 힌트(비권위·자동 write 0).
 *   · FE 옵션 = 데이터구동(get_inflow_channels RPC → useInflowChannels → 드롭다운) → seed 착지 = 즉시 노출(하드코딩 무).
 *
 * ★ 이 spec 은 백엔드 계약(canonical 12번째 코드 시드 + RPC 노출 + 기존 11코드 무변 + advisory crosswalk)을
 *    실 DB(service_role)로 검증. 현장 클릭 시나리오의 백엔드 인에이블러를 회귀 가드:
 *      - 시나리오1(정상 forward): get_inflow_channels 가 inbound.kakao(카톡)를 반환 = 드롭다운 소스 실재.
 *      - 시나리오2(엣지/회귀): 기존 11코드 버킷 무변(총 12) + inbound.etc 사유필수 무변.
 *    forward-guard: 마이그 미적용(RPC 부재) 시 배포전 실행 → test.skip(배포후 supervisor 재실행).
 *
 * 티켓: T-20260819-foot-INFLOW-KAKAO-CANONICAL-CODE-ADD
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inflowSelfReportCrosswalk } from '../../src/lib/inflowSelfReportCrosswalk';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 기존 11코드 (회귀 가드 — 유실 0 확인용)
const LEGACY_11 = [
  'inbound.walkin',
  'inbound.phone',
  'inbound.naver_place',
  'inbound.homepage',
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

// ─────────────────────────────────────────────────────────────
// FE-only(무DB): advisory crosswalk — 카카오톡 셀프리포트 → inbound.kakao 제안
// ─────────────────────────────────────────────────────────────
test.describe('T-20260819-KAKAO-CANONICAL — advisory crosswalk (FE 순수함수)', () => {
  test('카카오톡/카톡/카카오/kakao 셀프리포트 → inbound.kakao(카톡) 확신 1:1 제안', () => {
    for (const s of ['카카오톡', '카톡', '카카오', 'kakao', '카카오 톡', '카카오톡 채널']) {
      const hint = inflowSelfReportCrosswalk(s);
      expect(hint?.code, `"${s}" → inbound.kakao`).toBe('inbound.kakao');
      expect(hint?.label).toBe('카톡');
    }
  });

  test('회귀: 네이버/지인소개 기존 제안 무변 · 불확실 문구는 제안 없음(null)', () => {
    expect(inflowSelfReportCrosswalk('네이버 검색')?.code).toBe('inbound.naver_place');
    expect(inflowSelfReportCrosswalk('지인 소개')?.code).toBe('inbound.referral');
    // SNS/인스타/블로그/TV = 확신 1:1 부재 → null(스태프 직접 선택). kakao 추가가 이를 오염시키지 않음.
    expect(inflowSelfReportCrosswalk('인스타그램')).toBeNull();
    expect(inflowSelfReportCrosswalk('블로그')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 백엔드 계약(실 DB) — 시드 착지 + RPC 노출 + 회귀
// ─────────────────────────────────────────────────────────────
test.describe('T-20260819-KAKAO-CANONICAL — canonical 코드 백엔드 계약', () => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY, 'Supabase 자격 없음(로컬 FE-only) — DB 계약 검증 skip');

  // ── 시나리오1: RPC 가 inbound.kakao(카톡)를 반환 = 드롭다운 소스 실재(정상 forward) ──
  test('시나리오1: get_inflow_channels 가 inbound.kakao(카톡)를 노출(foot overlay=default-available)', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용(get_inflow_channels 부재) — 배포후 재실행 forward-guard');

    const { data: clinics } = await service.from('clinics').select('id').limit(1);
    const clinicId = (clinics as { id: string }[] | null)?.[0]?.id;
    test.skip(!clinicId, 'clinics 행 없음 — RPC 테스트 skip');

    const { data, error } = await service.rpc('get_inflow_channels', { p_clinic_id: clinicId });
    expect(error, `RPC 오류: ${error?.message}`).toBeNull();
    const rows = (data ?? []) as { code: string; label: string; series: string | null }[];
    const kakao = rows.find((r) => r.code === 'inbound.kakao');
    expect(kakao, 'inbound.kakao 가 RPC 결과에 노출됨(드롭다운 소스 실재)').toBeTruthy();
    expect(kakao?.label, '라벨=카톡(현장 표기)').toBe('카톡');
    expect(kakao?.series, 'series=inbound(진성 1급 inbound 채널)').toBe('inbound');
  });

  // ── 시나리오2: 시드 정합 + 기존 11코드 무변(엣지/회귀) ──
  test('시나리오2: system_codes 총 12종(기존 11 무변 + inbound.kakao) · etc 사유필수 무변', async () => {
    const service = svc();
    test.skip(!(await migrationApplied(service)), '마이그 미적용 — forward-guard skip');

    const { data, error } = await service
      .from('system_codes')
      .select('code, label, series, sort_order, requires_reason')
      .eq('code_type', 'inflow_channel');
    expect(error, `system_codes 조회 오류: ${error?.message}`).toBeNull();

    const rows = (data ?? []) as {
      code: string; label: string; series: string | null; sort_order: number; requires_reason: boolean;
    }[];
    const codes = rows.map((r) => r.code);

    // 기존 11코드 전량 존치(회귀 0)
    for (const c of LEGACY_11) {
      expect(codes.includes(c), `기존 코드 존치: ${c}`).toBe(true);
    }
    // inbound.kakao 추가 → 총 12
    expect(rows.length, '총 12종(11 + inbound.kakao)').toBe(12);

    // inbound.kakao 계약 값
    const kakao = rows.find((r) => r.code === 'inbound.kakao');
    expect(kakao?.label).toBe('카톡');
    expect(kakao?.series).toBe('inbound');
    expect(kakao?.requires_reason, 'kakao 사유 불요').toBe(false);

    // inbound.etc semantic 무변(사유 필수 유지)
    const etc = rows.find((r) => r.code === 'inbound.etc');
    expect(etc?.requires_reason, 'inbound.etc 사유 필수 무변').toBe(true);
    expect(etc?.label, 'inbound.etc 라벨 무변').toBe('기타 (사유 필수 입력)');
  });
});
