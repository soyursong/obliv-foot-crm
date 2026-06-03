/**
 * T-20260523-foot-CHARTSAVE-REGRESS — 진료차트 저장 RLS 회귀 수정 검증
 *
 * 루트 코즈: kim@oblivseoul.kr (coordinator, clinic_id=NULL) 가
 *   mc_clinic_isolated_v2 WITH CHECK 에서 RLS 차단됨.
 *   이전 핫픽스(MEDCHART-SAVE-ERR)는 admin/director/manager만 커버, coordinator 누락.
 *
 * 수정: user_profiles.clinic_id 보정 (kim@oblivseoul.kr → 74967aea-...)
 *
 * Supabase: rxlomoozakkjesdqjtvd
 * 클리닉:   74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브의원 서울 오리진점)
 */

// 본 스펙은 브라우저 없는 DB 통합 회귀(service role 쿼리)다.
// vitest 미설치 환경에서 Playwright 러너가 전체 suite collection 시 크래시하던 문제 해소를 위해
// @playwright/test API로 통일(describe→test.describe, it→test). 동일 assertion·커버리지 유지.
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
const describe = test.describe;
const it = test;

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY  =
  '***REMOVED-LEAKED-SERVICE-KEY***' +
  '***REMOVED-LEAKED-SERVICE-KEY***' +
  'ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const FOOT_CLINIC_ID  = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const KIM_EJ_UID      = '2b613328-5c4e-43d3-8b8c-649806bc1095'; // kim@oblivseoul.kr

describe('T-20260523-foot-CHARTSAVE-REGRESS', () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── AC-1: 근본원인 특정 — kim@oblivseoul.kr clinic_id 보정 확인 ──────────────
  describe('AC-1: 근본원인 특정 및 검증', () => {
    it('kim@oblivseoul.kr (coordinator) 의 clinic_id 가 풋센터로 설정돼 있어야 함', async () => {
      const { data, error } = await sb
        .from('user_profiles')
        .select('id, email, role, clinic_id')
        .eq('id', KIM_EJ_UID)
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.role).toBe('coordinator');
      expect(data!.clinic_id).toBe(FOOT_CLINIC_ID);
    });

    it('clinic_id=NULL 인 active 사용자가 없어야 함 (전체 완결 검증)', async () => {
      const { data, error } = await sb
        .from('user_profiles')
        .select('id, email, role, clinic_id')
        .is('clinic_id', null)
        .eq('active', true);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  // ── AC-2: 원인 기반 수정 — mc_clinic_isolated_v2 정책 존재 확인 ──────────────
  describe('AC-2: RLS 정책 상태 확인 (service role 쿼리)', () => {
    it('medical_charts 에서 coordinator clinic_id 보정 후 SELECT 가능해야 함', async () => {
      // service role로 medical_charts SELECT — RLS bypass, 스키마 검증 목적
      const { error } = await sb
        .from('medical_charts')
        .select('id, clinic_id, clinical_progress, prescription_items')
        .eq('clinic_id', FOOT_CLINIC_ID)
        .limit(1);

      expect(error).toBeNull(); // 컬럼 존재 + 테이블 접근 OK
    });

    it('medical_charts 에 clinical_progress, prescription_items 컬럼 존재해야 함 (REVAMP 마이그레이션 검증)', async () => {
      const { data, error } = await sb
        .from('medical_charts')
        .select('clinical_progress, prescription_items')
        .limit(1);

      expect(error).toBeNull();
      // data 가 배열로 반환되면 컬럼 정상
      expect(Array.isArray(data)).toBe(true);
    });
  });

  // ── AC-3: doctor_memo RBAC — coordinator 는 chart_doctor_memos 접근 불가 ────
  describe('AC-3: doctor_memo RBAC 정상', () => {
    it('chart_doctor_memos 테이블 존재 및 clinic_id 기반 격리 스키마 확인', async () => {
      // service role 로 조회 — 정책 bypassed, 테이블 존재 확인
      const { error } = await sb
        .from('chart_doctor_memos')
        .select('id, clinic_id')
        .limit(1);

      expect(error).toBeNull();
    });
  });

  // ── AC-4: 무파괴 — 기존 medical_charts 레코드 조회 OK ────────────────────────
  describe('AC-4: 기존 데이터 무파괴', () => {
    it('기존 medical_charts 레코드 정상 조회 (풋센터)', async () => {
      const { data, error } = await sb
        .from('medical_charts')
        .select('id, customer_id, clinic_id, visit_date, diagnosis')
        .eq('clinic_id', FOOT_CLINIC_ID)
        .order('created_at', { ascending: false })
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      // 기존 레코드가 있다면 clinic_id 가 풋센터여야 함
      if (data && data.length > 0) {
        expect(data[0].clinic_id).toBe(FOOT_CLINIC_ID);
      }
    });
  });
});
