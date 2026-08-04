/**
 * E2E Spec — T-20260804-foot-PAYCOMPLETE-CONFIRM-GUARD
 *
 * [P2·foot] 결제완료 버튼 오클릭 안전장치 — '정말 결제완료 처리하시겠습니까?' 확인 팝업.
 *   원 사건: 2026-08-03 19:36 마태민 고객 결제건이 '결제완료' 버튼 오클릭으로 결제완료 처리됨(소급 롤백=별도 P0).
 *   본 티켓 = forward 재발방지. 결제완료 처리 로직 자체는 무변경, 앞단 confirm 게이트만 삽입.
 *   요청자: 최필경 총괄(풋센터, U05L6HE7QF6). (중복발주 CONFIRM-POPUP 취소 → 본 GUARD 단일 티켓으로 통일)
 *
 * 가드 대상 = '결제완료(수납) 처리' 트리거 2경로(둘 다 payment_waiting → done 완료 처리):
 *   ① PaymentMiniWindow [수납] 버튼(btn-settle → handleSettle) — 현장 주 동선(대시보드 [결제하기]→미니창).
 *   ② PaymentDialog '결제 완료' 버튼(btn-payment-submit → handleSubmit) — 마감/미수 딥링크 경유.
 * ★코밴 CAT 직결결제(CbandPayEntryButton '결제 요청' btn-cband-approve)는 별도 컴포넌트/버튼 →
 *   이 게이트 무접촉(이중 팝업·경로 충돌 없음. CBAND는 자체 동시결제 confirm 보유).
 *
 * NOTE: PaymentMiniWindow/PaymentDialog 는 대형 컴포넌트 + auth/seed 필요(브라우저 E2E 비결정론) →
 *   기존 repo 표준(정적 소스 가드, 예: NIGHTHOLIDAY-PMW-UNWIRED)대로 confirm-게이트 불변식을 소스레벨로 락한다.
 *   실 UI 관측(3종 현장 클릭 시나리오)은 supervisor field-soak 로 확인.
 *
 * 시나리오 매핑(현장 클릭 → 소스 불변식):
 *   시나리오1(확인→정상완료): 버튼 클릭 = 확인모달 open, [확인]에서만 기존 handleSettle/handleSubmit 호출.
 *   시나리오2(취소→상태무변경): [취소] = setShow*(false)만, 처리함수 미호출.
 *   시나리오3(바깥/ESC 닫힘): onOpenChange close-only = setShow*(false)만, 처리함수 미호출.
 *
 * 실행: npx playwright test --project=unit T-20260804-foot-PAYCOMPLETE-CONFIRM-GUARD.spec.ts
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../', rel), 'utf-8');

const PMW_SRC = read('src/components/PaymentMiniWindow.tsx');
const PAYDLG_SRC = read('src/components/PaymentDialog.tsx');
const CBAND_SRC = read('src/components/CbandPayEntryButton.tsx');

function occurrences(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

const CONFIRM_TITLE = '정말 결제완료 처리하시겠습니까?';

test.describe('① PaymentMiniWindow [수납] 버튼 — 결제완료 확인 게이트', () => {
  test('AC-1: [수납] 클릭 시 즉시 handleSettle 하지 않고 확인모달을 연다(setShowSettleConfirm)', () => {
    // 종전 직접호출 onClick={handleSettle} 제거 → 확인모달 open 으로 교체
    expect(PMW_SRC, 'btn-settle 이 여전히 handleSettle 직접호출이면 오클릭 가드 미작동').not.toContain(
      'onClick={handleSettle}',
    );
    expect(PMW_SRC, '[수납] 클릭 → 확인모달 open 배선 누락').toContain('onClick={() => setShowSettleConfirm(true)}');
    expect(PMW_SRC).toContain('const [showSettleConfirm, setShowSettleConfirm] = useState(false)');
  });

  test('AC-1: 확인모달 표시(문구 "정말 결제완료 처리하시겠습니까?", 취소/확인 2버튼)', () => {
    expect(PMW_SRC).toContain('data-testid="settle-complete-confirm"');
    expect(PMW_SRC).toContain(CONFIRM_TITLE);
    expect(PMW_SRC).toContain('data-testid="btn-settle-complete-cancel"');
    expect(PMW_SRC).toContain('data-testid="btn-settle-complete-confirm"');
  });

  test('시나리오1(확인→정상완료): [확인]에서만 기존 handleSettle 호출', () => {
    // handleSettle() 실호출은 확인 버튼 onClick 단 1곳(정의부 const handleSettle = 제외).
    expect(PMW_SRC).toContain('onClick={() => { setShowSettleConfirm(false); handleSettle(); }}');
    // 로직 무변경 역가드: handleSettle 정의 자체는 존치(결제완료 처리 경로 그대로).
    expect(PMW_SRC).toContain('const handleSettle = async () =>');
  });

  test('시나리오2(취소→상태무변경): [취소]는 setShowSettleConfirm(false)만, 처리함수 미호출', () => {
    // 취소 버튼 onClick = 모달 닫기 전용
    expect(PMW_SRC).toContain(
      'data-testid="btn-settle-complete-cancel"',
    );
    // 취소 경로가 handleSettle 을 부르지 않음(확인 경로에만 존재) — handleSettle() 실호출 onClick 1곳뿐
    expect(
      occurrences(PMW_SRC, 'setShowSettleConfirm(false); handleSettle(); }}'),
      '확인 경로 외에서 handleSettle 이 호출되면 취소=무처리 불변식 깨짐',
    ).toBe(1);
  });

  test('시나리오3(바깥/ESC): onOpenChange 는 close-only(setShowSettleConfirm(false)) — 처리 없음', () => {
    expect(PMW_SRC).toContain(
      'onOpenChange={(o) => { if (!o) setShowSettleConfirm(false); }}',
    );
  });
});

test.describe('② PaymentDialog "결제 완료" 버튼 — 결제완료 확인 게이트', () => {
  test('AC-1: "결제 완료"(btn-payment-submit) 클릭 시 즉시 handleSubmit 하지 않고 확인모달을 연다', () => {
    expect(PAYDLG_SRC, 'btn-payment-submit 이 여전히 handleSubmit 직접호출이면 오클릭 가드 미작동').not.toContain(
      'onClick={handleSubmit}',
    );
    expect(PAYDLG_SRC).toContain('onClick={() => setShowCompleteConfirm(true)}');
    expect(PAYDLG_SRC).toContain('const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)');
  });

  test('AC-1: 확인모달 표시(동일 문구, 취소/확인 2버튼)', () => {
    expect(PAYDLG_SRC).toContain('data-testid="payment-complete-confirm"');
    expect(PAYDLG_SRC).toContain(CONFIRM_TITLE);
    expect(PAYDLG_SRC).toContain('data-testid="btn-payment-complete-cancel"');
    expect(PAYDLG_SRC).toContain('data-testid="btn-payment-complete-confirm"');
  });

  test('시나리오1(확인→정상완료): [확인]에서만 기존 handleSubmit 호출', () => {
    expect(PAYDLG_SRC).toContain('onClick={() => { setShowCompleteConfirm(false); handleSubmit(); }}');
    expect(PAYDLG_SRC).toContain('const handleSubmit = async () =>');
  });

  test('시나리오2(취소→상태무변경): 확인 경로 외에서 handleSubmit 미호출', () => {
    expect(
      occurrences(PAYDLG_SRC, 'setShowCompleteConfirm(false); handleSubmit(); }}'),
      '확인 경로 외에서 handleSubmit 이 호출되면 취소=무처리 불변식 깨짐',
    ).toBe(1);
  });

  test('시나리오3(바깥/ESC): onOpenChange close-only(setShowCompleteConfirm(false)) — 처리 없음', () => {
    expect(PAYDLG_SRC).toContain(
      'onOpenChange={(o) => { if (!o) setShowCompleteConfirm(false); }}',
    );
  });
});

test.describe('③ CBAND 직접결제 무충돌 + AC-3/AC-4 회귀 가드', () => {
  test('CBAND 결제 버튼(btn-cband-approve/onApprove)은 별도 컴포넌트 → 이 게이트 무접촉(이중팝업 없음)', () => {
    // CbandPayEntryButton 은 자체 '결제 요청' 버튼·자체 동시결제 confirm 보유. 본 티켓 게이트 미주입.
    expect(CBAND_SRC).toContain('data-testid="btn-cband-approve"');
    expect(CBAND_SRC, 'CBAND 컴포넌트에 결제완료 게이트가 주입되면 이중 팝업 위험').not.toContain('showSettleConfirm');
    expect(CBAND_SRC).not.toContain('showCompleteConfirm');
  });

  test('AC-3: 결제완료 처리 로직(payments insert / status 전이)은 무변경 — 정의부 존치', () => {
    // PaymentDialog payments insert 경로 존치
    expect(PAYDLG_SRC).toContain("supabase.from('payments').insert");
    // PMW 수납 완료 전이 경로 존치(handleSettle → 완료 처리) — 함수 정의 유지
    expect(PMW_SRC).toContain('const handleSettle = async () =>');
  });

  test('AC-4(회귀 0): 확인 게이트는 결제완료 트리거 2버튼에만 — 각 컴포넌트 확인모달 1개', () => {
    expect(occurrences(PMW_SRC, 'data-testid="settle-complete-confirm"')).toBe(1);
    expect(occurrences(PAYDLG_SRC, 'data-testid="payment-complete-confirm"')).toBe(1);
  });
});
