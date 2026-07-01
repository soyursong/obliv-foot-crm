/**
 * T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN
 *   치료사별 가능 시술(프리컨디셔닝/포돌로게/리본) 설정 + 금일 치료유형 기반 자동배정 후보 제한.
 *
 * ── 확정 스펙(DA CONSULT-REPLY GO ADDITIVE, MSG-20260701-175504-8mjx) ──
 *   질의A(저장형상) = (ii) 매핑 소형테이블 therapist_capabilities(staff_id × capability_code).
 *                     UI 는 '자동배정 기본순번 설정' 화면 각 치료사 행 [프리컨디셔닝][포돌로게][리본] 3 체크박스(불변).
 *                     체크 = 행 upsert / 언체크 = 행 delete. capability_code 하드 CHECK 금지(앱레벨 검증).
 *   질의B(무좀 매칭) = SINGLE. required_caps = { 금일 치료유형 } ∩ { preconditioning, podologue, ribbon }.
 *                     무좀PC+NL → {preconditioning} SINGLE(NL=unheated_laser 는 체크박스 부재=gate 스킬 아님).
 *                     자매 '복수(need 전체 요구)' = 버그 → required_caps 규칙으로 교체.
 *
 * 검증 방식: 정적 소스/코드 SSOT 불변식(라이브 env·인증·시드 비의존). 현장 클릭 시나리오 1·2 를 코드 계약으로 고정.
 *   시나리오1 = 치료사 가능 시술 설정(자동배정 기본순번 설정 화면 3 체크박스 + 저장).
 *   시나리오2 = 금일 치료유형 기반 배정(required_caps 필터, SINGLE, 우선순위 정합, AC-3 fallback).
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
const ENGINE_C = stripComments(read('src/lib/autoAssign.ts'));
const ASSIGN = read('src/pages/Assignments.tsx');
const ASSIGN_C = stripComments(ASSIGN);
const MIG = read('supabase/migrations/20260701130000_foot_therapist_capabilities.sql');
const RB = read('supabase/migrations/20260701130000_foot_therapist_capabilities.rollback.sql');

// ── 코드 SSOT — gated capability 3항목 ──────────────────────────────────────────
test.describe('gated capability 코드 SSOT (treatmentRequestCodes)', () => {
  test('GATED_CAPABILITY_ITEMS = 프리컨디셔닝/포돌로게/리본 3항목(코드=session_type 공유 어휘)', () => {
    expect(CODES_C).toMatch(/GATED_CAPABILITY_ITEMS/);
    expect(CODES_C).toMatch(/code:\s*'preconditioning',\s*label:\s*'프리컨디셔닝'/);
    expect(CODES_C).toMatch(/code:\s*'podologue',\s*label:\s*'포돌로게'/);
    expect(CODES_C).toMatch(/code:\s*'ribbon',\s*label:\s*'리본'/);
  });

  test('GATED_CAPABILITY_CODES 파생 export(문자열 하드코딩 아님)', () => {
    expect(CODES_C).toMatch(/export const GATED_CAPABILITY_CODES/);
    expect(CODES_C).toMatch(/GATED_CAPABILITY_ITEMS\.map\(\(i\) => i\.code\)/);
  });

  test('NL(unheated_laser)은 gate 집합에서 제외 — 3항목에 없음(SINGLE 근거)', () => {
    // gated 3항목 정의 창(GATED_CAPABILITY_ITEMS 블록)에 unheated_laser 가 없어야 함.
    const gi = CODES_C.indexOf('GATED_CAPABILITY_ITEMS');
    const gEnd = CODES_C.indexOf('GATED_CAPABILITY_CODES', gi);
    const block = gi >= 0 && gEnd > gi ? CODES_C.slice(gi, gEnd) : '';
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toContain('unheated_laser');
  });

  test('신규 enum 신설 0 — CREATE TYPE 없이 session_type 어휘 재사용', () => {
    expect(CODES).not.toMatch(/CREATE TYPE/i);
    // 자매 TREATREQ-SPLIT 코드 정의처와 동일 파일(코드 한 곳 정의 계약)
    expect(CODES).toContain('THERAPIST-SKILL');
  });
});

// ── 마이그레이션 — therapist_capabilities (ADDITIVE, RLS, no CHECK) ─────────────
test.describe('마이그레이션 — therapist_capabilities(ADDITIVE·RLS·롤백)', () => {
  test('신규 소형 매핑테이블 grain=(staff_id, capability_code) PK', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS therapist_capabilities/);
    expect(MIG).toMatch(/staff_id\s+uuid\s+NOT NULL REFERENCES staff\(id\) ON DELETE CASCADE/);
    expect(MIG).toMatch(/capability_code text\s+NOT NULL/);
    expect(MIG).toMatch(/clinic_id\s+uuid\s+REFERENCES clinics\(id\)/);
    expect(MIG).toMatch(/PRIMARY KEY \(staff_id, capability_code\)/);
  });

  test('⚠ capability_code 하드 CHECK 금지(DA 경고) — CHECK 미설정 + 검증 블록이 강제', () => {
    // capability_code 컬럼 정의에 CHECK(...) in 절이 붙지 않아야 함.
    expect(MIG).not.toMatch(/capability_code[^\n]*CHECK\s*\(/);
    // 검증 DO 블록이 capability_code CHECK 존재 시 예외를 던짐(pg_get_constraintdef 로 탐지).
    expect(MIG).toMatch(/pg_get_constraintdef\(con\.oid\) ILIKE '%capability_code%'/);
    expect(MIG).toMatch(/RAISE EXCEPTION 'capability_code 하드 CHECK 존재/);
  });

  test('RLS 활성 + 승인·지점 격리(is_approved_user / current_user_clinic_id)', () => {
    expect(MIG).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(/is_approved_user\(\) AND clinic_id = current_user_clinic_id\(\)/);
  });

  test('ADDITIVE only — 기존 staff 스키마 무변(ALTER staff 없음)', () => {
    expect(MIG).not.toMatch(/ALTER TABLE staff/);
    // 현장 원안(can_precond/can_podologue/can_ribbon boolean 3컬럼)은 채택 안 됨
    expect(MIG).not.toContain('can_precond');
    expect(MIG).not.toContain('can_podologue');
    expect(MIG).not.toContain('can_ribbon');
  });

  test('롤백 SQL 동봉 — 순수 신설 DROP(다운스트림 FK 없음)', () => {
    expect(RB).toMatch(/DROP TABLE IF EXISTS therapist_capabilities/);
  });
});

// ── 배정 필터 — required_caps SINGLE 규칙(DA 질의B 정정) ─────────────────────────
test.describe('배정 필터 — required_caps = need ∩ gated (SINGLE)', () => {
  test('required_caps = 금일 치료유형 코드 ∩ GATED_CAPABILITY_CODES', () => {
    expect(ENGINE_C).toMatch(/import \{ GATED_CAPABILITY_CODES \} from '\.\/treatmentRequestCodes'/);
    expect(ENGINE_C).toMatch(/const gated = new Set\(GATED_CAPABILITY_CODES\)/);
    expect(ENGINE_C).toMatch(/const requiredCaps = need\.filter\(\(c\) => gated\.has\(c\)\)/);
  });

  test('required_caps=∅ → 필터 미적용(전체 후보) — 무좀단독-NL/피검사/KOH graceful', () => {
    expect(ENGINE_C).toMatch(/if \(requiredCaps\.length === 0\) return pool/);
  });

  test('후보 = therapist_capabilities(staff_id) ⊇ required_caps', () => {
    expect(ENGINE_C).toMatch(/\.from\('therapist_capabilities'\)/);
    expect(ENGINE_C).toMatch(/\.select\('staff_id, capability_code'\)/);
    expect(ENGINE_C).toMatch(/requiredCaps\.every\(\(c\) => caps\.has\(c\)\)/);
  });

  test('버그 정정 — 구 복수매칭(need.every)·구 테이블(staff_treatment_capabilities) 제거', () => {
    expect(ENGINE_C).not.toMatch(/need\.every\(/);
    expect(ENGINE_C).not.toContain('staff_treatment_capabilities');
  });

  test('AC-3 fallback — 수행가능자 0 시 전체 후보(완전제외 X) + 경고', () => {
    expect(ENGINE_C).toMatch(/filtered\.length === 0[\s\S]*?return pool/);
    expect(ENGINE_C).toContain('THERAPIST-SKILL AC-3');
  });

  test('초진 한정 + therapy 역할에서만 필터(상담 배정 회귀0)', () => {
    expect(ENGINE_C).toMatch(/if \(visitType !== 'new'\) return pool/);
    expect(ENGINE_C).toMatch(/if \(role === 'therapy'\)[\s\S]*?filterTherapistPoolByTreatmentCapability/);
  });

  test('AC-4 우선순위 정합 — capability 필터는 pre-filter, 그 위 지정0순위→월균등→기본순번 유지', () => {
    // 필터로 좁힌 pool 위에 기존 우선순위 로직(pickLeastLoaded) 그대로 적용.
    expect(ENGINE_C).toMatch(/pool = await filterTherapistPoolByTreatmentCapability\(pool/);
    expect(ENGINE_C).toMatch(/chosen = pickLeastLoaded\(pool, load, order\)/);
  });
});

// ── 시나리오 1: 치료사 가능 시술 설정 (자동배정 기본순번 설정 화면) ─────────────────
test.describe('시나리오1 — 치료사 가능 시술 설정 UI(자동배정 기본순번 설정 화면)', () => {
  test('설정 위치 = 자동배정 기본순번 설정(RotationOrderDialog) — 별도 화면 신설 X', () => {
    expect(ASSIGN_C).toMatch(/자동배정 기본순번 설정/);
    expect(ASSIGN_C).toMatch(/RotationOrderDialog/);
  });

  test('치료 파트 행에 가능 시술 3 체크박스 embed(GATED_CAPABILITY_ITEMS.map)', () => {
    expect(ASSIGN_C).toMatch(/GATED_CAPABILITY_ITEMS\.map/);
    expect(ASSIGN_C).toContain('rotation-cap-');
    // 상담 파트(withCaps=false)엔 미노출 — 치료 파트만 withCaps=true
    expect(ASSIGN_C).toMatch(/renderList\('치료 파트', therapy, setTherapy, 'therapy', true\)/);
    expect(ASSIGN_C).toMatch(/renderList\('상담 파트', consult, setConsult, 'consult'\)/);
  });

  test('capability 로드 — 재진입 시 체크 상태 유지(therapist_capabilities 조회)', () => {
    expect(ASSIGN_C).toMatch(/\.from\('therapist_capabilities'\)\s*\.select\('staff_id, capability_code'\)/);
    expect(ASSIGN_C).toMatch(/setCaps\(/);
    expect(ASSIGN_C).toMatch(/setCapBaseline\(/);
  });

  test('저장 = 체크 신설 upsert / 언체크 delete (baseline delta, onConflict staff_id,capability_code)', () => {
    expect(ASSIGN_C).toMatch(/onConflict:\s*'staff_id,capability_code'/);
    expect(ASSIGN_C).toMatch(/\.delete\(\)\.eq\('staff_id', d\.staff_id\)\.eq\('capability_code', d\.code\)/);
    // 저장 시 앱레벨 어휘 검증(gated 만 insert)
    expect(ASSIGN_C).toMatch(/const allowed = new Set\(GATED_CAPABILITY_CODES\)/);
    expect(ASSIGN_C).toMatch(/allowed\.has\(code\)/);
  });

  test('graceful — therapist_capabilities 부재 시 체크박스 비활성(capMissing), 순번 편집 무영향', () => {
    expect(ASSIGN_C).toMatch(/setCapMissing\(true\)/);
    expect(ASSIGN_C).toMatch(/capDisabled=\{capMissing\}/);
    expect(ASSIGN_C).toMatch(/if \(!capMissing\)/);
  });
});

// ── 시나리오 2: 금일 치료유형 기반 배정 (SINGLE 매칭 예시) ────────────────────────
test.describe('시나리오2 — 금일 치료유형 기반 배정(코드 계약)', () => {
  test('무좀PC+NL = SINGLE({preconditioning}) — codes 조합 ∩ gated 로 NL 자동 제외', () => {
    // 무좀 codes = [preconditioning, unheated_laser]. gated ∩ → {preconditioning}.
    expect(CODES_C).toMatch(/athlete_foot[\s\S]*?codes:\s*\['preconditioning', 'unheated_laser'\]/);
    // gated 집합에 unheated_laser 없음 → 교집합 시 preconditioning 만 남음(코드 계약).
    expect(CODES_C).toMatch(/GATED_CAPABILITY_CODES/);
  });

  test('포돌로게 가능 치료사만 후보 — 내성PD codes=[podologue] ∩ gated={podologue}', () => {
    expect(CODES_C).toMatch(/podologue_pd[\s\S]*?codes:\s*\['podologue'\]/);
  });

  test('각질RB → {ribbon} 단독 필터', () => {
    expect(CODES_C).toMatch(/ribbon_rb[\s\S]*?codes:\s*\['ribbon'\]/);
  });

  test('피검사/KOH → required_caps=∅ → 필터 미적용(exam 축 codes 없음)', () => {
    expect(CODES_C).toMatch(/blood_test[\s\S]*?codes:\s*\[\]/);
    expect(CODES_C).toMatch(/koh_fungal_test[\s\S]*?codes:\s*\[\]/);
  });

  test('배정 엔진은 어떤 오류도 throw 안 함(전체 후보 fallback, 동선 무차단)', () => {
    expect(ENGINE_C).toMatch(/catch \(e\)[\s\S]*?return pool/);
  });
});
