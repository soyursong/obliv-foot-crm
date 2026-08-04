import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveCbandDefaultAmount } from '../../src/lib/cband/prefillAmount';
import { formatAmountDisplay } from '../../src/components/ui/AmountInput';

/**
 * T-20260804-foot-CBAND-PAYMODAL-AMOUNT-AUTOFILL — 코밴 CAT 직결결제 팝업 금액칸 default=미납잔액 자동세팅
 * ────────────────────────────────────────────────────────────────────────────
 * 요구(최필경 총괄, foot): 코밴 CAT 단말 직결결제 팝업이 열릴 때 금액 입력칸에 해당 수납의
 *   미납잔액(수납잔액)을 default value 로 자동 세팅 → 수동 타이핑 오기입('불필요·위험') 제거.
 *
 * 스펙:
 *   · 팝업 open 시 금액칸 default = 미납잔액(수납잔액). 소스 = PMW displayAmount(수납잔액 SSOT) 재사용.
 *   · 편집(override) 허용 — readonly/disabled 금지(전송 중 제외).
 *   · 잔액 ≤ 0 → default 세팅 스킵(자동입력 안 함).
 *   · 결제 실행·payments write·method 로직 무변경 — 입력칸 초기값만.
 *
 * 검증 방식: 자동입력 default 파생은 순수 함수(resolveCbandDefaultAmount) SSOT 로 추출됨 →
 *   결정론 unit + 컴포넌트/부모 배선 정적 소스 가드. (실 팝업 렌더/편집 = flag-ON 후 field-soak.)
 *   auth/server/browser 불요. db_change=false.
 *
 * E2E 3시나리오(티켓 본문):
 *   ① 정상 자동입력  — 잔액 278,800 → 금액칸 default '278800'(표시 '278,800')
 *   ② 편집 override — default 세팅 후에도 입력칸 편집 가능(readonly/disabled 아님)
 *   ③ 잔액0·음수 가드 — 잔액 ≤ 0(또는 미전달) → 자동입력 스킵(빈칸)
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// ── ① 정상 자동입력 ──────────────────────────────────────────────────────────
test.describe('① 정상 자동입력 — 미납잔액 → 금액칸 default', () => {
  test('잔액 278,800 → raw 정수문자열 "278800" (AmountInput 표시 "278,800")', () => {
    const raw = resolveCbandDefaultAmount(278800);
    expect(raw).toBe('278800');
    // amount state(raw)를 AmountInput 이 천단위 콤마 표시로 포맷 — 현장이 보는 값.
    expect(formatAmountDisplay(raw)).toBe('278,800');
  });

  test('임의 양수 다수 — 정수부만, 쉼표 없는 raw 문자열', () => {
    const cases: Array<[number, string]> = [
      [1002, '1002'],
      [150000, '150000'],
      [1, '1'],
      [278800.9, '278800'], // 소수부 버림(원 단위 정수)
      [99999999, '99999999'],
    ];
    for (const [input, expected] of cases) {
      expect(resolveCbandDefaultAmount(input)).toBe(expected);
      // 파생된 raw 는 다시 순수 숫자만 — 콤마/부호 오염 없음.
      expect(resolveCbandDefaultAmount(input)).toMatch(/^\d+$/);
    }
  });

  test('부모(PaymentMiniWindow) 가 수납잔액 SSOT(displayAmount) 를 defaultAmount 로 전달', () => {
    const src = readSrc('src/components/PaymentMiniWindow.tsx');
    // 코밴 진입 버튼에 defaultAmount={displayAmount} 배선(신규 산출 아님, 기존 수납잔액 재사용).
    expect(src).toMatch(/<CbandPayEntryButton[\s\S]*?defaultAmount=\{displayAmount\}[\s\S]*?\/>/);
    // displayAmount = 수납잔액 SSOT(deductMode ? deductAmount : payableTotalWithSurcharge).
    expect(src).toContain('const displayAmount = deductMode ? deductAmount : payableTotalWithSurcharge');
  });
});

// ── ② 편집 override ─────────────────────────────────────────────────────────
test.describe('② 편집 override — default 후에도 금액칸 편집 가능', () => {
  const src = readSrc('src/components/CbandPayEntryButton.tsx');

  test('default 는 amount state 초기값일 뿐 — 편집을 막지 않음(reset 이 default 세팅)', () => {
    // reset()이 setAmount(defaultAmountStr) 로 초기값을 주입(빈 '' 하드코딩 아님).
    expect(src).toMatch(/setAmount\(defaultAmountStr\)/);
    // 파생은 순수 헬퍼 SSOT 경유(컴포넌트 인라인 재계산 금지).
    expect(src).toContain('resolveCbandDefaultAmount(defaultAmount)');
  });

  test('금액칸(AmountInput) 은 readOnly 아님 · disabled 는 전송중(sending)에만', () => {
    // 입력칸 블록 추출.
    const m = src.match(/<AmountInput[\s\S]*?data-testid="cband-amount-input"[\s\S]*?\/>/);
    expect(m).not.toBeNull();
    const input = m![0];
    // 편집 허용: readonly/disabled 상시 부여 금지. disabled 는 오직 ui==='sending'.
    expect(input).not.toContain('readOnly');
    expect(input).toContain("disabled={ui === 'sending'}");
    // onChange={setAmount} — 사용자 입력이 amount state 를 그대로 갱신(override).
    expect(input).toContain('onChange={setAmount}');
  });

  test('결제 실행/전문/payments write 무접촉 — onApprove 는 편집된 amount 사용', () => {
    // 승인 금액은 입력칸 최종값(amount) 파싱 — default 여부와 무관하게 편집값 반영.
    expect(src).toContain("parseInt(parseAmountRaw(amount) || '0', 10)");
    // approve() 호출 인자 amount 는 amountNum(편집 반영값).
    expect(src).toMatch(/approve\(\s*\{[\s\S]*?amount:\s*amountNum/);
  });
});

// ── ③ 잔액0·음수 가드 ───────────────────────────────────────────────────────
test.describe('③ 잔액0·음수 가드 — 자동입력 스킵(빈칸)', () => {
  test('0 / 음수 / null / undefined / NaN / Infinity → 빈 문자열', () => {
    expect(resolveCbandDefaultAmount(0)).toBe('');
    expect(resolveCbandDefaultAmount(-1)).toBe('');
    expect(resolveCbandDefaultAmount(-278800)).toBe('');
    expect(resolveCbandDefaultAmount(null)).toBe('');
    expect(resolveCbandDefaultAmount(undefined)).toBe('');
    expect(resolveCbandDefaultAmount(NaN)).toBe('');
    expect(resolveCbandDefaultAmount(Infinity)).toBe('');
    expect(resolveCbandDefaultAmount(-Infinity)).toBe('');
  });

  test('빈 문자열은 AmountInput placeholder(0) 자연 표시 — 강제 0 입력 아님', () => {
    // formatAmountDisplay('') === '' → placeholder '0' 노출(자동입력 안 함 = 빈칸).
    expect(formatAmountDisplay(resolveCbandDefaultAmount(0))).toBe('');
    expect(formatAmountDisplay(resolveCbandDefaultAmount(undefined))).toBe('');
  });

  test('canPay 게이트 불변 — 자동입력 스킵(빈칸)이면 결제요청 비활성(회귀0)', () => {
    const src = readSrc('src/components/CbandPayEntryButton.tsx');
    // amountNum>0 여야 결제요청 활성 — 빈칸(잔액0 스킵) 시 종전대로 결제 불가.
    expect(src).toContain('const canPay = amountNum > 0');
  });
});
