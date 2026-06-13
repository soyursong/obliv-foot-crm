/**
 * E2E spec — T-20260612-foot-MEDLAW22-B-GATE
 *
 * 의료법 제22조 진료기록 작성 강제 게이트 — 급여(보험) 방문 한정 하드차단.
 *
 * 결정(문지은 대표원장 2026-06-13, MSG-20260613-171308-kdvj):
 *   - 강도 = 하드차단(완전차단): 진료기록 없으면 수납/완료 불가. 사유 우회 없음.
 *   - 범위 = 급여(보험)차트 한정: 방문 내 급여코드 1개↑ → 게이트. 비급여만 → 미적용.
 *
 * AC(티켓 §2):
 *   AC-1 급여 방문 하드차단: 미작성이면 수납/완료 불가, 기록(+서명) 있으면 정상 진행.
 *   AC-2 비급여 면제: 비급여만 방문은 진료기록 무관 정상 완료(게이트 노출 X).
 *   AC-3 급여/비급여 판정 정확성: 방문 내 급여코드 1개↑ 여부로 분기. 판정=footBilling SSOT(getTaxClass).
 *   AC-4 레거시 면제: 게이트 도입 전 미작성 누적 급여 건 일괄차단 금지(액션 시점 평가만).
 *
 * 검증 전략:
 *   (A) AC-3 판정 로직 단위검증 — footBilling.getTaxClass 를 직접 호출해 급여/비급여 분기 정확성 확인.
 *       (게이트 1차 판정이 결제창 분류와 동일 SSOT 임을 회귀 고정.)
 *   (B) 게이트 lib(medicalRecordGate) 정적 가드 — 2단 검사 순서·서명조건·과차단방지·액션시점 평가.
 *   (C) 3개 수납/완료 진입점(PaymentMiniWindow.handleSettle / Dashboard 완료드래그 /
 *       PaymentDialog payment_waiting→done) 배선 가드 — 우회경로 누락 방지.
 *
 * 스타일: 판정은 SSOT 단위검증, 배선·정책은 소스 정적 가드(auth/DB 라이브 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getTaxClass } from '../../src/lib/footBilling';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const GATE = () => SRC('lib/medicalRecordGate.ts');
const PMW = () => SRC('components/PaymentMiniWindow.tsx');
const DASH = () => SRC('pages/Dashboard.tsx');
const PAYDLG = () => SRC('components/PaymentDialog.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// (A) AC-3 — 급여/비급여 판정 정확성 (footBilling.getTaxClass SSOT 단위검증)
//     게이트 1차 판정이 의존하는 분류 로직이 "급여코드 1개↑"를 정확히 급여로 분기하는지.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 급여/비급여 판정 정확성 (SSOT)', () => {
  test('건보 유효등급 + hira_code 보유 항목 → 급여', () => {
    const svc = { id: 's1', name: '체외충격파', hira_code: 'NZ001', is_insurance_covered: false, vat_type: 'none' as const };
    expect(getTaxClass(svc, 'general')).toBe('급여');
  });

  test('is_insurance_covered=true 항목 → 급여 (등급 무관)', () => {
    const svc = { id: 's2', name: '진찰료', hira_code: null, is_insurance_covered: true, vat_type: 'none' as const };
    expect(getTaxClass(svc, null)).toBe('급여');
    expect(getTaxClass(svc, 'unverified')).toBe('급여');
  });

  test('비급여(자부담)만 — hira_code 없고 미보장 → 급여 아님 (과차단 방지 핵심)', () => {
    const cosmetic = { id: 's3', name: '풋화장품', hira_code: null, is_insurance_covered: false, vat_type: 'exclusive' as const };
    expect(getTaxClass(cosmetic, 'general')).not.toBe('급여');
    expect(getTaxClass(cosmetic, 'general')).toBe('비급여(과세)');
    const exempt = { id: 's4', name: '풋케어', hira_code: null, is_insurance_covered: false, vat_type: 'none' as const };
    expect(getTaxClass(exempt, 'general')).toBe('비급여(면세)');
  });

  test('미보장 등급(foreigner) + hira_code 만으로는 급여 아님 — 오판정(비급여→급여) 방지', () => {
    const svc = { id: 's5', name: '체외충격파', hira_code: 'NZ001', is_insurance_covered: false, vat_type: 'none' as const };
    // foreigner 는 COVERED_GRADES 미포함 → hira_code 보유라도 급여로 과분류하지 않음.
    expect(getTaxClass(svc, 'foreigner')).not.toBe('급여');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) 게이트 lib 정책 가드 — 2단 검사·서명조건·과차단방지·액션시점
// ─────────────────────────────────────────────────────────────────────────────
test.describe('게이트 lib(medicalRecordGate) 정책', () => {
  test('1차 판정 = check_in_services + getTaxClass(footBilling SSOT) — 분류 재구현 금지', () => {
    const src = GATE();
    expect(src).toMatch(/loadFootBillingItems/);
    expect(src).toMatch(/loadCustomerInsuranceGrade/);
    expect(src).toMatch(/getTaxClass\(/);
    expect(src).toMatch(/from '\.\/footBilling'/);
    // 급여 판정 = 항목 중 '급여' 1개라도 (some)
    expect(src).toMatch(/\.some\(.*getTaxClass.*===\s*'급여'\)/s);
  });

  test('AC-2 — 비급여(isCovered=false)면 즉시 통과(blocked:false), 차트 조회 안 함', () => {
    const src = GATE();
    // isCovered 거짓이면 medical_charts 조회 전에 early return
    expect(src).toMatch(/if\s*\(!isCovered\)\s*\{\s*return\s*\{\s*blocked:\s*false/s);
  });

  test('AC-1 (2차) — 급여면 해당 내원일 medical_charts + 서명 진료의(signing_doctor_id NOT NULL) 존재 확인', () => {
    const src = GATE();
    expect(src).toMatch(/from\(['"]medical_charts['"]\)/);
    expect(src).toMatch(/\.eq\(['"]visit_date['"]/);
    expect(src).toMatch(/\.not\(['"]signing_doctor_id['"],\s*['"]is['"],\s*null\)/);
    // 급여 + 기록없음 → blocked:true
    expect(src).toMatch(/blocked:\s*true/);
  });

  test('내원일 매칭 = 체크인 KST 날짜(checked_in_at) 기준, fallback 오늘(서울)', () => {
    const src = GATE();
    expect(src).toMatch(/seoulISODate\(checkIn\.checked_in_at\)/);
    expect(src).toMatch(/todaySeoulISODate\(\)/);
  });

  test('과차단 방지 — 고객 미연결/조회오류 시 비차단(blocked:false)', () => {
    const src = GATE();
    // customer_id 없으면 통과
    expect(src).toMatch(/if\s*\(!checkIn\.customer_id\)\s*\{\s*return\s*\{\s*blocked:\s*false/s);
    // 조회 error 시 비차단
    expect(src).toMatch(/if\s*\(error\)\s*\{\s*return\s*\{\s*blocked:\s*false/s);
  });

  test('하드차단 — 사유 입력/우회 옵션 없음 (reason은 안내문구일 뿐, override 인자 부재)', () => {
    const src = GATE();
    // evaluate 함수 시그니처에 bypass/override/force 류 파라미터 없음
    expect(src).not.toMatch(/bypass|override|allowSkip|forceComplete/i);
    expect(src).toMatch(/export const MEDLAW22_BLOCK_MESSAGE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (C) 3개 수납/완료 진입점 배선 — 우회경로 누락 방지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('수납/완료 진입점 배선 (3경로)', () => {
  test('경로1 PaymentMiniWindow.handleSettle — 수납 직전 게이트 재평가 + blocked 시 abort', () => {
    const src = PMW();
    expect(src).toMatch(/from '@\/lib\/medicalRecordGate'/);
    // handleSettle 내 평가 + blocked 시 toast + return (executeAutoDone 도달 전)
    const settleIdx = src.indexOf('const handleSettle');
    const execIdx = src.indexOf('await executeAutoDone');
    expect(settleIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(settleIdx);
    const settleBody = src.slice(settleIdx, execIdx);
    expect(settleBody).toMatch(/evaluateMedicalRecordGate\(checkIn\)/);
    expect(settleBody).toMatch(/gate\.blocked/);
  });

  test('경로1 UX — 급여+미작성 시 [수납] 버튼 비활성 + 차단 배너', () => {
    const src = PMW();
    expect(src).toMatch(/medGateBlocked/);
    // 버튼 disabled 에 medGateBlocked 포함
    expect(src).toMatch(/disabled=\{submitting \|\| medGateBlocked\}/);
    // 차단 배너 testid
    expect(src).toMatch(/data-testid="medlaw22-block-banner"/);
    // saved 후에만 평가 (check_in_services 영속 상태 기준)
    expect(src).toMatch(/if\s*\(!checkIn \|\| !saved\)/);
  });

  test('경로2 Dashboard 완료 드래그 — newStatus==="done" 분기에서 게이트 평가 + abort', () => {
    const src = DASH();
    expect(src).toMatch(/from '@\/lib\/medicalRecordGate'/);
    // done 이동 시 평가
    expect(src).toMatch(/if\s*\(newStatus === 'done'\)\s*\{[\s\S]*evaluateMedicalRecordGate\(row\)/);
    // blocked 시 return (낙관적 업데이트 전 abort)
    expect(src).toMatch(/gate\.blocked[\s\S]*?return;/);
  });

  test('경로3 PaymentDialog — payment_waiting→done 수납 완료 전 게이트(방어적)', () => {
    const src = PAYDLG();
    expect(src).toMatch(/from '@\/lib\/medicalRecordGate'/);
    expect(src).toMatch(/checkIn\.status === 'payment_waiting'/);
    expect(src).toMatch(/evaluateMedicalRecordGate\(checkIn\)/);
    expect(src).toMatch(/gate\.blocked/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (D) 회귀 가드 — 비급여 경로 무변경 / 범위(급여한정) foot 한정
// ─────────────────────────────────────────────────────────────────────────────
test.describe('회귀 가드', () => {
  test('비급여 경로 무변경 — 게이트는 isCovered=true 일 때만 차단 분기 진입', () => {
    const src = GATE();
    // blocked:true 는 isCovered 통과 이후(2차)에서만 — !isCovered early return 이 선행
    const earlyReturn = src.indexOf('if (!isCovered)');
    const blockTrue = src.indexOf('blocked: true');
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(blockTrue).toBeGreaterThan(earlyReturn);
  });

  test('범위 주의 주석 — derm/body 전파 금지 명시(현장 결정 격리)', () => {
    expect(GATE()).toMatch(/derm\/body/);
  });
});
