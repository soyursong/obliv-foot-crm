/**
 * T-20260724-foot-NHIS-MANUAL-CAPTURE — 건보 자격 수기조회 인라인 캡처 (Phase 1)
 *
 * API 자동조회 blocked → 포털 수기조회 + 차트 내 붙여넣기 캡처 pivot.
 *   [건보조회] → 포털 딥링크 open + 인라인 캡처 UI → 붙여넣기 파싱 → 평문 에코 →
 *   사람이 우측 InsuranceGradeSelect 에서 등급 확정(자동확정 금지) → 기존 sink 재산정 연쇄.
 *
 * 현장 클릭 시나리오 2종(티켓 §시나리오)을 (a) 파서 하드가드 실로직 단위검증 +
 *   (b) 소스 wiring 정적검증으로 회귀 가드. EF 모킹/if(count>0) 가짜GREEN 없음 —
 *   하드가드는 실제 순수함수(parseNhisEligibilityText/evaluateNhisGuards)로 결정론 검증.
 *   (갤탭 실기기 클릭 QA 는 supervisor 종료게이트 소관.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseNhisEligibilityText,
  evaluateNhisGuards,
  parseAndEvaluate,
  ageFromBirthDate,
} from '../../src/lib/nhisParse';

const __root = dirname(fileURLToPath(import.meta.url));
function readSrc(rel: string): string {
  return readFileSync(resolve(__root, '../../src', rel), 'utf-8');
}
function readMigration(rel: string): string {
  return readFileSync(resolve(__root, '../../supabase/migrations', rel), 'utf-8');
}
const chartSrc = readSrc('pages/CustomerChartPage.tsx');
const hookSrc = readSrc('hooks/useNhisLookup.ts');
const panelSrc = readSrc('components/insurance/NhisCapturePanel.tsx');
const gradeSelectSrc = readSrc('components/insurance/InsuranceGradeSelect.tsx');

// 포털 붙여넣기 픽스처 (요양기관정보마당 수진자자격조회 복사 형태 — 라벨/구분자 변형 포함)
const PORTAL_GENERAL = [
  '수진자자격조회',
  '수진자성명\t홍길동',
  '자격여부 : 건강보험 직장가입자',
  '증번호\t1-2345678901',
  '자격취득일: 2020-03-01',
].join('\n');

// ──────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 (포털조회 → 붙여넣기 → 확정)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오1: 정상 동선 (붙여넣기 파싱 → 제안 → 사람 확정)', () => {
  test('파서가 성명·자격여부·증번호·자격취득일을 추출한다', () => {
    const f = parseNhisEligibilityText(PORTAL_GENERAL);
    expect(f.patientName).toBe('홍길동');
    expect(f.eligibilityRaw).toContain('건강보험');
    expect(f.certNo).toBe('1-2345678901');
    expect(f.acquiredDate).toBe('2020-03-01');
    expect(f.candidateGrade).toBe('general');
  });

  test('성명 일치 + 정상 연령 → suggestedGrade=general (제안 성립)', () => {
    const r = parseAndEvaluate(PORTAL_GENERAL, { customerName: '홍 길동', birthDateDisplay: '1990-05-15' }, 1);
    expect(r.suggestedGrade).toBe('general');
    // strong 경고 없음
    expect(r.warnings.filter((w) => w.level === 'strong')).toHaveLength(0);
  });

  test('의료급여/차상위도 화이트리스트 후보로 매핑', () => {
    expect(parseNhisEligibilityText('자격여부\t의료급여 1종').candidateGrade).toBe('medical_aid_1');
    expect(parseNhisEligibilityText('자격여부\t의료급여 2종').candidateGrade).toBe('medical_aid_2');
    expect(parseNhisEligibilityText('자격여부\t차상위 1종').candidateGrade).toBe('low_income_1');
    expect(parseNhisEligibilityText('자격여부\t차상위 2종').candidateGrade).toBe('low_income_2');
  });

  test('[건보조회] = 포털 딥링크 open + 캡처 UI 노출 (EF 死호출 제거)', () => {
    // 단일 choke point 에서 포털 딥링크를 새 창으로 연다
    expect(hookSrc).toMatch(/window\.open\(NHIS_EXTERNAL_URL/);
    // EF fetch(functions/v1/nhis-lookup) 死호출 제거
    expect(hookSrc).not.toContain('functions/v1/nhis-lookup');
    // 버튼 클릭이 단일 트리거를 호출 + 캡처 패널 렌더
    expect(chartSrc).toMatch(/onClick=\{\s*\(\)\s*=>\s*\{\s*void nhisPerformLookup\(false\);\s*\}\s*\}/);
    expect(chartSrc).toContain('<NhisCapturePanel');
    expect(chartSrc).toContain("import { NhisCapturePanel }");
  });

  test('붙여넣기 → 평문 에코 + 증번호 scaffold 자동채움 바인딩 유지', () => {
    // 캡처 패널: 붙여넣기 textarea + 평문 에코
    expect(panelSrc).toContain('data-testid="nhis-capture-textarea"');
    expect(panelSrc).toContain('onPaste');
    expect(panelSrc).toContain('data-testid="nhis-capture-echo"');
    // cert_no scaffold: 파서 결과가 result.cert_no 로 노출 → 기존 증번호칸 바인딩 effect 계속 동작
    expect(hookSrc).toMatch(/cert_no:\s*parsed\.certNo/);
    expect(chartSrc).toMatch(/nhis\.result\?\.cert_no/);
  });

  test('확정 = 기존 sink 재사용(updateInsuranceGrade) + source=hira_lookup + 3구역 재산정 연쇄', () => {
    // InsuranceGradeSelect 에 파서 제안 전달(자동확정 아님 — 사람이 저장)
    expect(chartSrc).toMatch(/suggestedGrade=\{nhis\.parsed\?\.suggestedGrade/);
    expect(chartSrc).toContain('suggestedSource="hira_lookup"');
    // 사람이 [저장] → 기존 updateInsuranceGrade sink
    expect(gradeSelectSrc).toContain('updateInsuranceGrade(customerId, draftGrade, draftSource');
    // 3구역 자동산정 연쇄 유지 (회귀 0)
    expect(chartSrc).toMatch(/setInsuranceGradeRefreshKey\(\(k\) => k \+ 1\)/);
    expect(chartSrc).toMatch(/refreshTrigger=\{insuranceGradeRefreshKey\}/);
  });

  test('제안은 편집 프리필까지만 — 자동 저장하지 않는다(사람이 [저장])', () => {
    // suggestionKey 로 편집모드 진입 + 프리필, save 는 사용자 클릭 핸들러에만 존재
    expect(gradeSelectSrc).toMatch(/appliedSuggestionKey/);
    expect(gradeSelectSrc).toMatch(/setEditing\(true\)/);
    // save() 는 버튼 onClick 에만 연결(effect 내 자동 save 없음)
    expect(gradeSelectSrc).not.toMatch(/appliedSuggestionKey[\s\S]{0,400}\bsave\(\)/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 시나리오 2: 하드가드 엣지 (P0 오청구 방지)
// ──────────────────────────────────────────────────────────────────────
test.describe('시나리오2: 하드가드 엣지', () => {
  test('#1 화이트리스트 외(보훈/특례/경감/무자격/외국인) → 자동저장 안 됨 + 강경고', () => {
    for (const [text, label] of [
      ['자격여부\t국가유공자(보훈)', '보훈'],
      ['자격여부\t산정특례 대상', '산정특례'],
      ['자격여부\t보험료 경감 대상', '경감'],
      ['자격여부\t자격상실(무자격)', '무자격'],
      ['자격여부\t외국인 가입자', '외국인'],
    ] as const) {
      const r = parseAndEvaluate(text, { customerName: null, birthDateDisplay: null }, 1);
      expect(r.suggestedGrade, `${label} 은 제안 없음`).toBeNull();
      expect(r.warnings.some((w) => w.code === 'non_whitelist' && w.level === 'strong'), `${label} 강경고`).toBe(true);
    }
  });

  test('#4 수진자성명 ≠ 차트 환자명 → "다른 환자 결과" 강경고 + 제안 차단', () => {
    const r = parseAndEvaluate(PORTAL_GENERAL, { customerName: '김철수', birthDateDisplay: '1990-05-15' }, 1);
    const w = r.warnings.find((x) => x.code === 'name_mismatch');
    expect(w?.level).toBe('strong');
    expect(w?.message).toContain('다른 환자');
    expect(r.suggestedGrade).toBeNull(); // 오조회로 등급 clobber 방지
  });

  test('#2 6세미만(infant)에 "건강보험" → general 로 덮어쓰지 않음 + 나이모순 경고', () => {
    // 만 3세 (기준시각 2026-07-24)
    const r = parseAndEvaluate(
      PORTAL_GENERAL,
      { customerName: '홍길동', birthDateDisplay: '2023-01-01', asOfMs: Date.parse('2026-07-24') },
      1,
    );
    expect(r.suggestedGrade).toBeNull();
    expect(r.warnings.some((w) => w.code === 'age_grade_conflict')).toBe(true);
  });

  test('#2 65세 이상에 "건강보험" → general 자동제안 억제(정액 등급 확인 유도)', () => {
    const r = parseAndEvaluate(
      PORTAL_GENERAL,
      { customerName: '홍길동', birthDateDisplay: '1955-01-01', asOfMs: Date.parse('2026-07-24') },
      1,
    );
    expect(r.suggestedGrade).toBeNull();
    expect(r.warnings.some((w) => w.code === 'age_grade_conflict')).toBe(true);
  });

  test('ageFromBirthDate 만나이 계산 정확성', () => {
    const asOf = Date.parse('2026-07-24');
    expect(ageFromBirthDate('1990-05-15', asOf)).toBe(36);
    expect(ageFromBirthDate('2020-12-31', asOf)).toBe(5);   // 6세 미만
    expect(ageFromBirthDate('1961-07-25', asOf)).toBe(64);  // 생일 하루 전 → 64
    expect(ageFromBirthDate('1961-07-24', asOf)).toBe(65);
    expect(ageFromBirthDate(null, asOf)).toBeNull();
  });

  test('#3 저장 실패(updateInsuranceGrade error) → 에러 UI 노출 (silent failure 금지)', () => {
    // 0-row/RLS 거부 시 updateInsuranceGrade 가 error 반환 → InsuranceGradeSelect 가 toast.error 노출
    expect(gradeSelectSrc).toMatch(/if \(error\) \{[\s\S]*?toast\.error\(`자격등급 저장 실패/);
  });

  test('#6 소프트게이트: 캡처 UI 는 접수·차트 진행을 차단하지 않음 + stale/미확인 배지 유지', () => {
    // 캡처 패널에 하드블록(모달 오버레이/disable 전체) 없음 — 닫기 가능
    expect(panelSrc).toContain('data-testid="nhis-capture-close"');
    // 미입력 경고 배지(soft) 유지
    expect(chartSrc).toContain('chart-grade-capture-warning');
  });
});

// ──────────────────────────────────────────────────────────────────────
// 하드가드 #5: 조회 감사 SECURITY DEFINER RPC (DA binding 4조건)
// ──────────────────────────────────────────────────────────────────────
test.describe('하드가드#5: 조회 감사 RPC (DA GO_ADDITIVE)', () => {
  const mig = readMigration('20260724140000_foot_nhis_lookup_audit_rpc.sql');
  const rb = readMigration('20260724140000_foot_nhis_lookup_audit_rpc.rollback.sql');

  test('① 신규 감사 테이블 금지 — 기존 phi_access_log INSERT + access_type 신값', () => {
    expect(mig).toContain('INSERT INTO public.phi_access_log');
    expect(mig).toContain("'nhis_eligibility_lookup'");
    expect(mig).not.toMatch(/CREATE TABLE/i); // 신규 테이블 없음
  });

  test('② anti-IDOR: 인자는 p_customer_id 1개, by/role/clinic 서버측 파생', () => {
    expect(mig).toMatch(/log_nhis_eligibility_lookup\(p_customer_id uuid\)/);
    expect(mig).toContain('auth.uid()');
    expect(mig).toContain('current_user_role()');
    expect(mig).toContain('current_user_clinic_id()');
    // caller 가 by/role/clinic 을 인자로 넘기지 않음
    expect(mig).not.toMatch(/p_accessed_by|p_accessed_role|p_clinic_id/);
  });

  test('③ PII 최소화: RRN·증번호·성명·등급값 미저장 (메타만)', () => {
    // 설명 주석(-- ...)은 "RRN 미저장"을 문서화하느라 토큰을 포함할 수 있으므로,
    // 실행 SQL(주석 제거)에서만 PII 컬럼/토큰 부재를 검증한다(주석 오탐 방지).
    const exec = mig
      .split(/\r?\n/)
      .map((l) => l.replace(/--.*$/, '')) // 인라인·전체 라인 주석 제거
      .join('\n');
    expect(exec).not.toMatch(/rrn|cert_no|insurance_grade|patient_name/i);
    // INSERT 컬럼 목록이 메타만(by/role/type/customer_id/clinic_id)임을 명시 확인
    expect(exec).toMatch(/INSERT INTO public\.phi_access_log[\s\S]*accessed_by[\s\S]*customer_id[\s\S]*clinic_id/);
  });

  test('④ §16-4c: REVOKE PUBLIC,anon + GRANT authenticated + search_path 고정', () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.log_nhis_eligibility_lookup\(uuid\) FROM PUBLIC, anon/);
    expect(mig).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.log_nhis_eligibility_lookup\(uuid\) TO authenticated/);
    expect(mig).toContain('SET search_path = public, pg_temp');
    expect(mig).toContain('SECURITY DEFINER');
  });

  test('클라이언트가 조회 개시 시 감사 RPC 호출(비차단)', () => {
    expect(hookSrc).toMatch(/supabase\.rpc\('log_nhis_eligibility_lookup', \{ p_customer_id/);
  });

  test('롤백: 함수만 DROP, phi_access_log 테이블 DROP 금지', () => {
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.log_nhis_eligibility_lookup(uuid)');
    expect(rb).not.toMatch(/DROP TABLE[\s\S]*phi_access_log/i);
  });
});
