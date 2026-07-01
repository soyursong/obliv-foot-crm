/**
 * T-20260701-foot-CHART2-TREATREQ-SPLIT
 *   2번차트 패키지 섹션 [치료부위]/[치료신청] 2박스 분리 + 5항목 체크박스 + 초진/재진 시술기준 + 배정 필터.
 *
 * ⭐ 핵심: 5항목은 단일 축이 아니라 2개 의미 축(DA CONSULT-REPLY §7 — 뭉치지 말 것).
 *   treatment 축[배정 O]: 내성 podologue / 각질 ribbon → chart_treatment_requests(axis='treatment').
 *   exam 축[배정 X]: 피검사 blood_test / KOH koh_fungal_test → 既존 리스트업 엔티티(check_in_services 플래그).
 *                     무좀 athlete_foot_pc_nl → chart_treatment_requests(axis='exam'). 배정 불참.
 *
 * 검증 방식: 정적 소스/코드 SSOT 불변식(라이브 env·인증·시드 비의존, autoAssign 엔진·아키텍처 dominant 패턴).
 *   현장 시나리오 1~4(초진 저장/검사 리스트업/재진 자동/초진 배정필터)를 코드 계약으로 고정한다.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CODES = read('src/lib/treatmentRequestCodes.ts');
const CODES_C = stripComments(CODES);
const BOX = read('src/components/TreatmentRequestBox.tsx');
const BOX_C = stripComments(BOX);
const CHART = read('src/pages/CustomerChartPage.tsx');
const CHART_C = stripComments(CHART);
const ENGINE_C = stripComments(read('src/lib/autoAssign.ts'));
const MIG = read('supabase/migrations/20260701120000_foot_chart_treatment_requests.sql');
const RB = read('supabase/migrations/20260701120000_foot_chart_treatment_requests.rollback.sql');

// ── 2개 의미 축 (⭐뭉치지 말 것, DA §7 + lpro 확정) ─────────────────────────────
test.describe('2개 의미 축 — 코드 SSOT(treatmentRequestCodes)', () => {
  test('치료유형 코드가 session_type 공유 어휘(podologue/ribbon/preconditioning/unheated_laser)', () => {
    for (const c of ['podologue', 'ribbon', 'preconditioning', 'unheated_laser']) {
      expect(CODES_C).toContain(`'${c}'`);
    }
    // 발명 코드 athlete_foot_pc_nl 는 폐기(DA lpro 재분류) — 소스에 없어야 함
    expect(CODES).not.toContain('athlete_foot_pc_nl');
  });

  test('배정 필터 참여 = treatment 축(내성 podologue / 각질 ribbon / 무좀 PC+NL)', () => {
    expect(CODES_C).toMatch(/podologue_pd[\s\S]*?axis:\s*'treatment'[\s\S]*?codes:\s*\['podologue'\]/);
    expect(CODES_C).toMatch(/ribbon_rb[\s\S]*?axis:\s*'treatment'[\s\S]*?codes:\s*\['ribbon'\]/);
    // 무좀PC+NL = 치료유형 축(DA lpro), PC=preconditioning + NL=unheated_laser 조합
    expect(CODES_C).toMatch(/athlete_foot[\s\S]*?axis:\s*'treatment'[\s\S]*?codes:\s*\['preconditioning', 'unheated_laser'\]/);
    expect(CODES_C).toMatch(/export const TREATMENT_AXIS_CODES/);
    expect(CODES_C).toMatch(/axis === 'treatment'[\s\S]*?flatMap\(\(i\) => i\.codes\)/);
  });

  test('exam 축(피검사/KOH)만 배정 불참 — axis=exam + codes 없음(chart_treatment_requests 미저장)', () => {
    expect(CODES_C).toMatch(/blood_test[\s\S]*?axis:\s*'exam'[\s\S]*?codes:\s*\[\]/);
    expect(CODES_C).toMatch(/koh_fungal_test[\s\S]*?axis:\s*'exam'[\s\S]*?codes:\s*\[\]/);
  });

  test('피검사/KOH 는 既존 엔티티 위임(existingEntity=blood_flag/koh_flag), 치료유형 항목은 null', () => {
    expect(CODES_C).toMatch(/blood_test[\s\S]*?existingEntity:\s*'blood_flag'/);
    expect(CODES_C).toMatch(/koh_fungal_test[\s\S]*?existingEntity:\s*'koh_flag'/);
    expect(CODES_C).toMatch(/podologue_pd[\s\S]*?existingEntity:\s*null/);
  });

  test('AC-7 코드 단일 정의처 — 자매 티켓 THERAPIST-SKILL 재사용 계약 명시(문서 계약)', () => {
    expect(CODES).toContain('THERAPIST-SKILL');
    expect(CODES).toMatch(/한 곳에서 한 번만 정의/);
    // 코드 레벨: 배정 join key 를 산출식으로 export(문자열 하드코딩 아님)
    expect(CODES_C).toMatch(/export const TREATMENT_AXIS_CODES/);
  });
});

// ── AC-1 2박스 분리 (병렬) ──────────────────────────────────────────────────────
test.describe('AC-1 — [치료부위]/[치료신청] 2박스 병렬 분리', () => {
  test('패키지 섹션이 치료부위(pkg-tab-toe-section) + 치료신청(TreatmentRequestBox) 병렬 grid', () => {
    expect(CHART_C).toMatch(/grid grid-cols-1 gap-3 md:grid-cols-2/);
    expect(CHART_C).toContain('data-testid="pkg-tab-toe-section"');
    expect(CHART_C).toMatch(/<TreatmentRequestBox/);
  });

  test('치료부위 박스 회귀0 — FootToeIllustration(발가락) 저장 경로 유지', () => {
    expect(CHART_C).toMatch(/<FootToeIllustration[\s\S]*?value=\{treatmentToes\}/);
    expect(CHART_C).toMatch(/onChange=\{canEditToes \? saveTreatmentToes : undefined\}/);
  });

  test('피검사/KOH 는 치료신청 박스로 이관 — 치료부위 박스에서 별도 토글 제거(중복 컨트롤 없음)', () => {
    expect(CHART).not.toMatch(/<KohRequestToggle/);
    expect(CHART).not.toMatch(/<BloodTestRequestToggle/);
  });
});

// ── AC-2 5항목 체크박스 + chart_treatment_requests 저장 ─────────────────────────
test.describe('AC-2 — 5항목 체크박스 + chart_treatment_requests 저장', () => {
  test('치료신청 박스가 5항목 전부를 체크박스로 렌더(TREATMENT_REQUEST_ITEMS map)', () => {
    expect(BOX_C).toMatch(/TREATMENT_REQUEST_ITEMS\.map/);
    expect(BOX_C).toContain('data-testid="pkg-tab-treatreq-section"');
    expect(BOX_C).toContain('treatreq-item-');
  });

  test('저장 grain=(check_in_id)×request_code — upsert onConflict check_in_id,request_code', () => {
    expect(BOX_C).toMatch(/onConflict:\s*'check_in_id,request_code'/);
    expect(MIG).toMatch(/UNIQUE \(check_in_id, request_code\)/);
  });

  test('각 행에 request_axis + source 기록', () => {
    expect(BOX_C).toMatch(/request_axis:\s*item\.axis/);
    expect(BOX_C).toMatch(/source,/);
    expect(MIG).toMatch(/request_axis text\s+NOT NULL CHECK \(request_axis IN \('treatment', 'exam'\)\)/);
    expect(MIG).toMatch(/source\s+text\s+NOT NULL DEFAULT 'manual' CHECK \(source IN \('manual', 'package_derived'\)\)/);
  });

  test('재진입 상태 유지 — chart_treatment_requests 조회 후 codeSet 로 checked 판정(복수코드=전부 present)', () => {
    expect(BOX_C).toMatch(/useTreatmentRequests\(checkInId\)/);
    expect(BOX_C).toMatch(/item\.codes\.every\(\(c\) => codeSet\.has\(c\)\)/);
  });
});

// ── AC-3 초진 manual / 재진 package_derived 스냅샷 ──────────────────────────────
test.describe('AC-3 — 초진 수동 / 재진 자동 파생(공통 grain)', () => {
  test('초진(manual) 기본 source', () => {
    expect(BOX_C).toMatch(/source\s*=\s*'manual'/);
  });

  test('재진(returning) = 패키지 파생 스냅샷 source=package_derived, 초진 아님 조건', () => {
    expect(BOX_C).toMatch(/visitType !== 'returning'/);
    expect(BOX_C).toMatch(/source:\s*'package_derived'/);
  });

  test('스냅샷은 point-in-time 1회 동결 — 기존 행 있으면 재삽입 금지(live mirror 아님)', () => {
    expect(BOX_C).toMatch(/ctrRows\.length > 0[\s\S]*?return/);
    expect(BOX_C).toMatch(/snapshotDone/);
  });

  test('재진 파생 소스 = active 패키지 시술유형(podologue) → 치료신청 코드 매핑', () => {
    expect(CHART_C).toMatch(/packageDerivedCodes/);
    expect(CHART_C).toMatch(/p\.podologe_sessions[\s\S]*?PACKAGE_SESSION_TYPE_TO_REQUEST_CODE\.podologue/);
    expect(CODES_C).toMatch(/PACKAGE_SESSION_TYPE_TO_REQUEST_CODE[\s\S]*?podologue:\s*'podologue'/);
  });

  test('저장은 초진/재진 공통 grain(같은 테이블) — visit_type 는 스냅샷 컬럼', () => {
    expect(MIG).toMatch(/visit_type\s+text/);
    expect(BOX_C).toMatch(/visit_type:\s*visitType/);
  });
});

// ── AC-4 검사요청 축 → 既존 리스트업 엔티티 (중복 저장소 방지) ──────────────────
test.describe('AC-4 — 피검사/KOH 既존 리스트업 연동(끊김·중복 0)', () => {
  test('피검사/KOH 는 既존 RPC(request_blood_test_for_customer / request_koh_for_customer)로 위임', () => {
    expect(BOX_C).toContain('request_blood_test_for_customer');
    expect(BOX_C).toContain('request_koh_for_customer');
  });

  test('피검사/KOH 는 chart_treatment_requests 에 저장하지 않음 — existingEntity 분기로 examMutation 경유', () => {
    expect(BOX_C).toMatch(/item\.existingEntity === 'blood_flag' \|\| item\.existingEntity === 'koh_flag'/);
    expect(BOX_C).toMatch(/examMutation\.mutate/);
  });

  test('검사 신청 시 리스트업 목록 즉시 반영 — exam_targets / koh_report query invalidate', () => {
    expect(BOX_C).toContain("queryKey: ['exam_targets']");
    expect(BOX_C).toContain("queryKey: ['koh_report']");
  });
});

// ── AC-5 배정 필터 (treatment subset only, 초진 한정, graceful) ──────────────────
test.describe('AC-5 — 초진 치료신청 배정 필터(treatment subset만)', () => {
  test('배정 필터가 treatment 축만 좁힘 — request_axis=treatment 조회', () => {
    expect(ENGINE_C).toMatch(/filterTherapistPoolByTreatmentCapability/);
    expect(ENGINE_C).toMatch(/\.eq\('request_axis', 'treatment'\)/);
  });

  test('초진 한정 — visit_type !== new 면 필터 무동작', () => {
    expect(ENGINE_C).toMatch(/if \(visitType !== 'new'\) return pool/);
  });

  test('capability subset ⊇ 필터 — capability_codes ⊇ 환자 treatment subset', () => {
    expect(ENGINE_C).toMatch(/need\.every\(\(c\) => caps\.has\(c\)\)/);
    expect(ENGINE_C).toContain('staff_treatment_capabilities');
  });

  test('graceful 회귀0 — capability 소스 부재/치료신청 없음 → 전체 pool(기존 동작)', () => {
    expect(ENGINE_C).toMatch(/if \(need\.length === 0\) return pool/);
    expect(ENGINE_C).toMatch(/capability 소스 없음[\s\S]*?return pool/);
  });

  test('capability 있으나 수행가능자 0 → fallback(전체 후보 + 경고, THERAPIST-SKILL AC-3)', () => {
    expect(ENGINE_C).toMatch(/filtered\.length === 0[\s\S]*?return pool/);
    expect(ENGINE_C).toContain('THERAPIST-SKILL AC-3');
  });

  test('therapy 역할에서만 pool 에 필터 적용(상담 배정 회귀0)', () => {
    expect(ENGINE_C).toMatch(/if \(role === 'therapy'\)[\s\S]*?filterTherapistPoolByTreatmentCapability/);
  });

  test('정본 우선순위(지정 0순위→월균등→기본순번) 회귀0 — pickLeastLoaded(pool, load, order) 유지', () => {
    expect(ENGINE_C).toMatch(/chosen = pickLeastLoaded\(pool, load, order\)/);
  });
});

// ── AC-6 ADDITIVE only (신규 enum 0) ────────────────────────────────────────────
test.describe('AC-6 — ADDITIVE only, 신규 enum 0', () => {
  test('podologue 는 既존 — 본 마이그 델타는 ribbon 단 1개(CHECK 값 확장)', () => {
    expect(MIG).toMatch(/'podologue', 'trial', 'reborn', 'ribbon'/);
    expect(MIG).toContain("'podologue' 는 이미 존재");
  });

  test('신규 treatment_request_type enum 신설 없음(CREATE TYPE 부재)', () => {
    expect(MIG).not.toMatch(/CREATE TYPE/i);
  });

  test('CHECK 확장이 ADDITIVE 임을 검증 블록이 강제(기존 위반행 0)', () => {
    expect(MIG).toMatch(/session_type NOT IN \([\s\S]*?RAISE EXCEPTION 'session_type CHECK 확장이 ADDITIVE 아님/);
  });

  test('롤백 SQL 동봉 — 테이블 DROP + CHECK 원복(ribbon 행 가드)', () => {
    expect(RB).toMatch(/DROP TABLE IF EXISTS chart_treatment_requests/);
    expect(RB).toMatch(/ribbon session_type 행[\s\S]*?RAISE EXCEPTION/);
  });

  test('RLS 활성 + 승인·지점 격리(is_approved_user / current_user_clinic_id)', () => {
    expect(MIG).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(/is_approved_user\(\) AND clinic_id = current_user_clinic_id\(\)/);
  });
});

// ── graceful 계약(마이그 전 prod 도달 안전) ─────────────────────────────────────
test.describe('graceful — 스키마 미적용 시 동선 무차단', () => {
  test('chart_treatment_requests 부재(42P01) 시 조회 빈배열·엔진 필터 skip', () => {
    expect(BOX_C).toMatch(/42P01[\s\S]*?return \[\]/);
    expect(ENGINE_C).toMatch(/if \(reqErr\) return pool/);
  });

  test('배정 엔진은 어떤 오류도 throw 안 함(전체 후보 fallback)', () => {
    expect(ENGINE_C).toMatch(/catch \(e\)[\s\S]*?return pool/);
  });
});
