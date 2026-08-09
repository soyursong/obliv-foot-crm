/**
 * T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE
 *   키오스크(태블릿 사전 체크리스트=환자 셀프리포트) 유입경로 커버리지 lane — 풋센터(obliv-foot-crm).
 *
 * 부모: T-20260801-xcrm-INFLOW-CHANNEL-11CODE-INTAKE / 선행: T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE.
 * DA RESOLUTION(MSG-20260801-194223-aao9): 조건부 GO(ADDITIVE) + 매핑치환 NO-GO(§36 Q3 방화벽).
 *
 * 구현(요약):
 *   · migration 20260807120000_foot_inflow_kiosk_selfcheckin_candidate.sql
 *       - check_ins.inflow_channel_self_reported (nullable ADDITIVE) = 환자 셀프리포트 CANDIDATE(lower-trust)
 *       - fn_complete_prescreen_checklist = 로직 승계 + candidate write(referral_source verbatim). canonical 무접점.
 *   · src/lib/inflowSelfReportCrosswalk.ts — advisory 크로스워크(확신 1:1 만 제안, 자동 write 0)
 *   · src/components/CheckInDetailSheet.tsx — 스태프-대면 advisory hint(참고용, canonical 미확정 시만 노출)
 *
 * ★ 이 spec 은 (A) 크로스워크 순수함수 (B) 소스-계약(candidate-only·방화벽·자동 write 0) (C) 백엔드 계약을 가드한다.
 *   forward-guard: 마이그 미적용(컬럼 부재) 시 (C)는 test.skip → 배포후 supervisor 재실행.
 *
 * 티켓: T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inflowSelfReportCrosswalk } from '../../src/lib/inflowSelfReportCrosswalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ══════════════════════════════════════════════════════════════════════
// (A) advisory 크로스워크 순수함수 — 확신 1:1 만 제안, lossy 는 null(스태프 직접 판단)
// ══════════════════════════════════════════════════════════════════════
test.describe('(A) inflowSelfReportCrosswalk — advisory 확신 1:1 매핑', () => {
  test('네이버 검색 → inbound.naver_place(네이버) 제안', () => {
    expect(inflowSelfReportCrosswalk('네이버 검색')).toEqual({ code: 'inbound.naver_place', label: '네이버' });
    // 외부 셀프체크인 변형 문구 방어(검색_네이버)
    expect(inflowSelfReportCrosswalk('검색_네이버')).toEqual({ code: 'inbound.naver_place', label: '네이버' });
  });

  test('지인 소개 → inbound.referral(지인 소개) 제안', () => {
    expect(inflowSelfReportCrosswalk('지인 소개')).toEqual({ code: 'inbound.referral', label: '지인 소개' });
    expect(inflowSelfReportCrosswalk('지인소개_홍길동')).toEqual({ code: 'inbound.referral', label: '지인 소개' });
  });

  test('lossy(SNS/블로그/TV·언론/기타) = 제안 없음(null) — 억지 매핑 금지(방화벽 취지)', () => {
    expect(inflowSelfReportCrosswalk('SNS/인스타')).toBeNull();
    expect(inflowSelfReportCrosswalk('블로그')).toBeNull();
    expect(inflowSelfReportCrosswalk('TV/언론')).toBeNull();
    expect(inflowSelfReportCrosswalk('기타')).toBeNull();
  });

  test('빈값/누락 = null', () => {
    expect(inflowSelfReportCrosswalk('')).toBeNull();
    expect(inflowSelfReportCrosswalk('   ')).toBeNull();
    expect(inflowSelfReportCrosswalk(null)).toBeNull();
    expect(inflowSelfReportCrosswalk(undefined)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// (B) 소스-계약 — candidate-only·방화벽·자동 write 0 (정적 가드, 회귀 방지)
// ══════════════════════════════════════════════════════════════════════
test.describe('(B) 소스-계약 가드 — 방화벽/자동 write 금지', () => {
  test('마이그 fn_complete_prescreen_checklist: candidate(self_reported) write 有 · canonical inflow_channel write 無', () => {
    const migPath = path.join(
      REPO_ROOT,
      'supabase/migrations/20260807120000_foot_inflow_kiosk_selfcheckin_candidate.sql',
    );
    const sql = fs.readFileSync(migPath, 'utf-8');
    // candidate 컬럼 write 존재
    expect(sql).toContain('inflow_channel_self_reported = v_self_report');
    // ★ canonical inflow_channel 직접 write(치환) 부재 — 'inflow_channel =' (self_reported 접미 아님) 금지
    expect(sql).not.toMatch(/SET\s+inflow_channel\s*=/i);
    // ★ customers.first_inflow_channel 키오스크 write 부재
    expect(sql).not.toMatch(/first_inflow_channel\s*=/i);
  });

  test('크로스워크 모듈: 자동 write/DB 호출 없음(표시 전용 순수함수)', () => {
    const libPath = path.join(REPO_ROOT, 'src/lib/inflowSelfReportCrosswalk.ts');
    const src = fs.readFileSync(libPath, 'utf-8');
    expect(src).not.toContain('supabase');
    expect(src).not.toContain('.update(');
    expect(src).not.toContain('.insert(');
    expect(src).not.toContain('.rpc(');
  });

  test('CheckInDetailSheet: advisory hint 는 canonical 미확정 시만 노출(참고용, 자동 write 0)', () => {
    const compPath = path.join(REPO_ROOT, 'src/components/CheckInDetailSheet.tsx');
    const src = fs.readFileSync(compPath, 'utf-8');
    // 노출 게이트 = selfReportedInflow && !checkIn.inflow_channel (canonical 확정 시 hint 숨김)
    expect(src).toContain('selfReportedInflow && !checkIn.inflow_channel');
    // hint testid 존재
    expect(src).toContain("data-testid=\"inflow-self-report-hint\"");
    // 셀프리포트 값으로 canonical 을 자동 write 하는 코드 부재
    expect(src).not.toMatch(/inflow_channel:\s*selfReportedInflow/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// (C) 백엔드 계약 — 실 DB(service_role) (forward-guard: 컬럼 부재 시 skip)
// ══════════════════════════════════════════════════════════════════════
test.describe('(C) 백엔드 계약 — candidate 컬럼 실재 · canonical 무접점', () => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY, 'Supabase 자격 없음(로컬 FE-only) — DB 계약 검증 skip');

  async function columnExists(service: SupabaseClient): Promise<boolean> {
    const { error } = await service.from('check_ins').select('inflow_channel_self_reported').limit(1);
    return !error;
  }

  test('check_ins.inflow_channel_self_reported (nullable ADDITIVE) 실재', async () => {
    const service = svc();
    test.skip(!(await columnExists(service)), '마이그 미적용(컬럼 부재) — 배포후 재실행 forward-guard');
    // canonical(inflow_channel) 과 candidate 컬럼이 별개로 공존(trust-tier 방화벽)
    const { error } = await service.from('check_ins').select('inflow_channel, inflow_channel_self_reported').limit(1);
    expect(error, `candidate/canonical 컬럼 공존 부재: ${error?.message}`).toBeNull();
  });
});
