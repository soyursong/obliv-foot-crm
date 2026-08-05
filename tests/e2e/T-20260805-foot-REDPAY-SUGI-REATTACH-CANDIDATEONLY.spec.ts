/**
 * Contract spec — T-20260805-foot-REDPAY-SUGI-REATTACH-CANDIDATEONLY
 *
 * 목적: 승인번호-NULL 수기수납이 4키 자동재부착을 우회하는 논리구멍 봉합의 불변식을 소스검증.
 *   2-case 분기: Case A(승인번호 有)=기존 4키 자동매칭 무접촉 / Case B(승인번호 無 수기)=후보검색만→
 *   자동연결 절대금지→후보카드 표시→담당자 confirm 후 '기존 수기행'에 승인번호 채움(신규행 X).
 *
 *   ★핵심 로직(Case 분류·후보검색·candidate-only·confirm 재검증)의 값-수준 전수검증은
 *     supabase/functions/_shared/reattachCandidate.test.ts (deno test 18 PASS)가 담당.
 *     본 spec 은 write-경로 불변식·게이트·db_change=false 를 소스계약으로 고정한다.
 *
 * 계약(I1~I8):
 *  I1. 순수 모듈이 candidate-only — 후보 1건이어도 자동확정('선택')하지 않는다.
 *  I2. list action = read-only(payment write 0). auto_write:0 명시.
 *  I3. confirm = 기존행 UPDATE(신규 payment INSERT 없음) + external_approval_no IS NULL 멱등가드.
 *  I4. confirm = claim-first(raw.matched_payment_id IS NULL, rows-affected=1) 직렬화점 + 실패 시 rollback.
 *  I5. confirm 재검증(validateConfirmPair) — 후보 집합 밖 raw 로는 채우지 않음(fabricate 차단).
 *  I6. Case A(승인번호 有) 무접촉 — isCaseBReceipt 가 external_approval_no≠NULL 을 제외.
 *  I7. db_change=false — EF/순수모듈이 신규 컬럼/테이블/enum 을 도입하지 않음(旣존재 컬럼만).
 *  I8. FE 는 기능플래그(VITE_PAYMENT_PLANB) OFF 시 미노출 + 담당자 클릭으로만 confirm.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';

const PURE = 'supabase/functions/_shared/reattachCandidate.ts';
const EF = 'supabase/functions/redpay-reattach-candidates/index.ts';
const FE_LIB = 'src/lib/redpayReattachCandidates.ts';
const FE_CARD = 'src/components/redpay/RedpayReattachCandidateCard.tsx';
const RECON_TAB = 'src/components/closing/RedpayReconcileTab.tsx';
const EF_REG = 'src/lib/externalServices.ts';

const pure = fs.readFileSync(PURE, 'utf-8');
const ef = fs.readFileSync(EF, 'utf-8');
const feLib = fs.readFileSync(FE_LIB, 'utf-8');
const feCard = fs.readFileSync(FE_CARD, 'utf-8');
const reconTab = fs.readFileSync(RECON_TAB, 'utf-8');
const efReg = fs.readFileSync(EF_REG, 'utf-8');

// ─── I1: candidate-only (자동확정 없음) ────────────────────────────────────────
test.describe('I1 candidate-only', () => {
  test('selectReattachCandidates 는 배열을 반환(단건 선택 아님)', () => {
    expect(pure).toMatch(/export function selectReattachCandidates\([\s\S]*?\): CandidateRaw\[\]/);
  });
  test('1건 auto-pick 하지 않음 — reverseMatch 와 대비 주석 명시', () => {
    expect(pure).toContain('후보가 정확히 1건이어도 자동확정하지 않는다');
  });
});

// ─── I2: list read-only (payment write 0) ─────────────────────────────────────
test.describe('I2 list read-only', () => {
  test('list 응답 auto_write:0 명시', () => {
    expect(ef).toContain('auto_write: 0');
  });
  test('handleList 는 payments/raw 에 update/insert 를 하지 않음', () => {
    const listBlock = ef.slice(ef.indexOf('async function handleList'), ef.indexOf('async function handleConfirm'));
    expect(listBlock).not.toMatch(/\.update\(/);
    expect(listBlock).not.toMatch(/\.insert\(/);
  });
});

// ─── I3: confirm = 기존행 UPDATE, 신규행 없음 ──────────────────────────────────
test.describe('I3 기존행 UPDATE (신규행 X)', () => {
  const confirmBlock = ef.slice(ef.indexOf('async function handleConfirm'));
  test('payments 는 UPDATE 만(INSERT 금지)', () => {
    expect(confirmBlock).toMatch(/from\("payments"\)\s*\.update\(/);
    // confirm 블록에서 payments.insert 는 존재하지 않아야 한다(신규 결제행 생성 금지).
    expect(confirmBlock).not.toMatch(/from\("payments"\)\s*\.insert\(/);
  });
  test('new_row_created:0 불변식 응답', () => {
    expect(confirmBlock).toContain('new_row_created: 0');
  });
  test('external_approval_no IS NULL 멱등가드(중복 confirm 방어)', () => {
    expect(confirmBlock).toMatch(/\.is\("external_approval_no", null\)/);
  });
});

// ─── I4: claim-first 직렬화점 + rollback ───────────────────────────────────────
test.describe('I4 claim-first', () => {
  const confirmBlock = ef.slice(ef.indexOf('async function handleConfirm'));
  test('raw claim WHERE matched_payment_id IS NULL + rows-affected=1', () => {
    expect(confirmBlock).toMatch(/from\("redpay_raw_transactions"\)[\s\S]*?\.is\("matched_payment_id", null\)/);
    expect(confirmBlock).toContain('claimed.length !== 1');
  });
  test('payment UPDATE 실패 시 raw claim rollback(payment 삭제/신규 없음)', () => {
    expect(confirmBlock).toContain('buildReverseClaimRollback()');
    expect(confirmBlock).toContain('payment_update_failed');
  });
});

// ─── I5: confirm 재검증(fabricate 차단) ────────────────────────────────────────
test.describe('I5 confirm 재검증', () => {
  test('validateConfirmPair 로 후보 집합 재확인 후에만 write', () => {
    expect(ef).toContain('validateConfirmPair(receipt, rawId, raws)');
    expect(ef).toContain('invalid_candidate');
  });
  test('순수모듈 validateConfirmPair 는 후보 밖 raw 에 null 반환', () => {
    expect(pure).toMatch(/export function validateConfirmPair[\s\S]*?candidates\.find\(\(r\) => r\.id === chosenRawId\) \?\? null/);
  });
});

// ─── I6: Case A(승인번호 有) 무접촉 ────────────────────────────────────────────
test.describe('I6 Case A 무접촉', () => {
  test('isCaseBReceipt 가 external_approval_no≠NULL 을 제외', () => {
    expect(pure).toMatch(/receipt\.external_approval_no == null/);
  });
  test('confirm 은 not_case_b 로 Case A 를 거부', () => {
    expect(ef).toContain('not_case_b');
    expect(ef).toContain('if (!isCaseBReceipt(receipt))');
  });
});

// ─── I7: db_change=false (스키마 무접촉) ───────────────────────────────────────
test.describe('I7 db_change=false', () => {
  test('EF 는 신규 마이그를 요구하지 않음 — 旣존재 컬럼만 사용 선언', () => {
    expect(ef).toContain('db_change=false');
    expect(ef).toContain('신규 컬럼/테이블/enum 0');
  });
  test('신규 마이그 파일이 이 티켓으로 추가되지 않음', () => {
    const migs = fs.readdirSync('supabase/migrations').filter((f) => f.includes('SUGI-REATTACH') || f.includes('reattach_candidate'));
    expect(migs).toEqual([]);
  });
});

// ─── I8: FE 플래그 게이트 + 클릭 게이트 ────────────────────────────────────────
test.describe('I8 FE 게이트', () => {
  test('EDGE_FUNCTIONS 레지스트리에 등재(하드코딩 금지)', () => {
    expect(efReg).toContain("REDPAY_REATTACH_CANDIDATES: 'redpay-reattach-candidates'");
    expect(feLib).toContain('EDGE_FUNCTIONS.REDPAY_REATTACH_CANDIDATES');
  });
  test('플래그 OFF 시 null 렌더', () => {
    expect(feCard).toContain('if (!enabled) return null');
    expect(feCard).toContain('isPaymentPlanbEnabled()');
  });
  test('confirm 은 담당자 클릭(onClick)으로만 — 자동 호출 없음', () => {
    expect(feCard).toMatch(/onClick=\{\(\) => handleConfirm\(rc\.payment_id, c\.raw_id\)\}/);
    // 렌더/이펙트에서 confirmReattach 를 자동 호출하지 않는다(핸들러 안에서만).
    const autoCall = /useEffect\([\s\S]*?confirmReattach/.test(feCard);
    expect(autoCall).toBe(false);
  });
  test('reconcile 탭에 마운트', () => {
    expect(reconTab).toContain('<RedpayReattachCandidateCard clinicId={clinicId} />');
  });
});
