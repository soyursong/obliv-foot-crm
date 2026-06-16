/**
 * E2E spec — T-20260616-foot-PAYDLG-INSURANCE-PANEL-ROLLBACK
 *
 * [P0 HOTFIX] 라이브 수납 전면 차단 → 결제 미니창 상단
 *   '급여 진료비 미리보기 (건강보험)' 패널(InsuranceCopaymentPanel) 렌더 롤백.
 *
 * 결정: 패널 컴포넌트/보험 청구 기능은 보존(파일 삭제 금지), PaymentDialog 의
 *       렌더 + import 만 주석 처리하여 수납 흐름 복구.
 *
 * AC(티켓):
 *   AC-1 건강보험 환자 수납 시 결제 미니창 상단 급여 미리보기 패널 미표시.
 *        → PaymentDialog 의 활성(코드) 영역에 InsuranceCopaymentPanel 사용 0건.
 *   AC-2 건강보험 환자 수납 버튼/처리 흐름 정상 (회귀 0).
 *        → 결제 모드 토글·결제 처리 로직·MEDLAW22 게이트 배선 무변경 가드.
 *   AC-3 자보/산재 안내 배너가 수납 흐름을 막는지 점검 → PaymentDialog 결제 흐름에
 *        자보/산재 차단 배너는 존재하지 않음(차단 요인 아님)을 회귀 고정.
 *   제약 보존: InsuranceCopaymentPanel.tsx 파일/보험 기능 보존.
 *
 * 스타일: 본 변경은 JSX 렌더 제거(롤백)이므로 소스 정적 가드로 검증.
 *         (auth/DB 라이브 비의존 — 동일 레포 T-20260612-MEDLAW22-B-GATE 패턴 계승.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PAYDLG_PATH = path.join(__dirname, '..', '..', 'src', 'components', 'PaymentDialog.tsx');
const PAYDLG = () => SRC('components/PaymentDialog.tsx');
const PANEL_PATH = path.join(__dirname, '..', '..', 'src', 'components', 'insurance', 'InsuranceCopaymentPanel.tsx');

// /* */ 블록주석 + // 라인주석 제거 → "활성(코드) 영역"만 남긴다.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 블록주석
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 라인주석 (http:// 등 보호 위해 직전 1글자 검사)
}

test.describe('AC-1 — 급여 미리보기 패널 렌더 롤백', () => {
  test('PaymentDialog 활성 코드에 InsuranceCopaymentPanel 사용 0건 (주석 영역 제외)', () => {
    const active = stripComments(PAYDLG());
    expect(active).not.toMatch(/InsuranceCopaymentPanel/);
  });

  test('롤백 마커 주석 존재 — 복원 경로 명시', () => {
    const src = PAYDLG();
    expect(src).toMatch(/T-20260616-foot-PAYDLG-INSURANCE-PANEL-ROLLBACK/);
  });

  test('import 도 비활성(주석) — noUnusedLocals 빌드 안전', () => {
    const src = PAYDLG();
    // 활성 import 문이 없어야 함 (주석 처리된 import 텍스트는 허용)
    const active = stripComments(src);
    expect(active).not.toMatch(/import\s*\{\s*InsuranceCopaymentPanel\s*\}/);
  });
});

test.describe('AC-2 — 수납 처리 흐름 회귀 0 (결제 로직 무변경)', () => {
  const active = () => stripComments(PAYDLG());

  test('단건/패키지 결제 모드 토글 보존', () => {
    expect(active()).toMatch(/setPaymentMode\(/);
    expect(active()).toMatch(/패키지/);
  });

  test('결제 처리 로직 보존 — footBilling / 상태 전이 / 방문유형 승격 import 무변경', () => {
    const a = active();
    expect(a).toMatch(/from '@\/lib\/footBilling'/);
    expect(a).toMatch(/applyStatusFlagTransition/);
    expect(a).toMatch(/promoteVisitTypeToReturning/);
  });

  test('MEDLAW22 급여 진료기록 게이트 배선 보존 (수납 직전 평가 무영향)', () => {
    const a = active();
    expect(a).toMatch(/from '@\/lib\/medicalRecordGate'/);
    expect(a).toMatch(/evaluateMedicalRecordGate\(checkIn\)/);
    expect(a).toMatch(/checkIn\.status === 'payment_waiting'/);
  });
});

test.describe('AC-3 — 자보/산재 안내 배너 차단 요인 부재', () => {
  test('PaymentDialog 결제 흐름에 자보/산재 차단 배너 없음', () => {
    const src = PAYDLG();
    // 자보/산재 안내 배너 자체가 PaymentDialog 에 존재하지 않음 → 수납 차단 요인 아님.
    expect(src).not.toMatch(/자동차보험|산재보험/);
    expect(src).not.toMatch(/자보\s*안내|산재\s*안내/);
  });
});

test.describe('제약 보존 — 보험 기능 컴포넌트 유지', () => {
  test('InsuranceCopaymentPanel.tsx 파일 보존 + export 유지 (삭제 금지)', () => {
    expect(existsSync(PANEL_PATH)).toBe(true);
    const panel = readFileSync(PANEL_PATH, 'utf8');
    expect(panel).toMatch(/export function InsuranceCopaymentPanel/);
  });

  test('PaymentDialog.tsx 파일 존재 (구조 무파괴)', () => {
    expect(existsSync(PAYDLG_PATH)).toBe(true);
  });
});
