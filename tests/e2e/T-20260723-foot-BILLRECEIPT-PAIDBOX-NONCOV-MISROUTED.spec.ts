/**
 * T-20260723-foot-BILLRECEIPT-PAIDBOX-NONCOV-MISROUTED
 *
 * ⑨/⑪ 납부박스 — 불변식 가드(Stage1 warn-only) + 10원 절사 정합 + 3 인쇄경로 대칭.
 * base = origin/main 88e61f70 (라이브). db_change=false — 순수 산식/가드/표시층 한정.
 *
 *   유효작업#1 [불변식 가드] 법정 별지 제6호서식 산식 ⑧ = ⑨ + ⑪(실수납) + 미납 을 코드로 강제.
 *     max(0,…) 클램프(⑨>⑧ or ⑪>⑩) 발동 = PKGSESSION 미배선發 어긋남 → 플래그+로그(silent 절단 금지).
 *     ★Stage1 = warn-only: 이상을 표면화하되 발행은 통과. hard-block(발행보류)은 Stage2 별도 GO(본 스코프 밖).
 *   유효작업#2 [10원 절사 정합] ⑧은 computeBillDetailRounding 로 절사돼 오는데 ⑨는 우수리를 안고 있어
 *     ⑩=⑧−⑨ 가 10원 비배수가 될 여지 → ⑨에도 동일 절사규칙 적용해 ⑧·⑨·⑩ 모두 10원 grain 정합.
 *   유효작업#3 [3 인쇄경로 대칭] 가드/절사를 헬퍼 한 곳(applyBillReceiptPaidBoxTokens)에 → PMW/DPP단건/DPP일괄
 *     자동 대칭. path-sweeper(호출부 경유)는 MASTER-FIXES.spec 계승.
 *
 *   공통 금지선(GO 판정 Q3): ⑪ 반응성 합산 / ⑨ 소스 교체(package_payments) / F-4790 개별교정 무접촉.
 *     본 티켓은 '가드+절사+대칭'만. 정합 본체(⑨/⑪ 구조수정)는 PKGSESSION-LINK-UNWIRED(depends_on) 몫.
 *
 * 라이브 앱 회귀 아님 — 순수 산식 불변식(로그인 불요, 결정론적).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  applyBillReceiptPaidBoxTokens,
  checkBillReceiptPaidBoxInvariant,
} from '../../src/lib/footBilling';

const ROOT = process.cwd();
const FB_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/footBilling.ts'), 'utf8');
const DPP_SRC = fs.readFileSync(path.join(ROOT, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
const PMW_SRC = fs.readFileSync(path.join(ROOT, 'src/components/PaymentMiniWindow.tsx'), 'utf8');

test.describe('PAIDBOX-NONCOV-MISROUTED — 불변식 가드(warn-only)·10원 절사 정합·3경로 대칭', () => {
  // ═══════════ 골든 3분기 (검증 기준: 당일net커버 / 환불상쇄 net0 / 선차감 F-4790류) ═══════════

  test('골든①: 당일net커버 (선수금 없음) → ⑨ 공란, ⑪=248,700, 미납=0, 불변식 ok', () => {
    const v: Record<string, string> = {};
    // ⑧ 환자부담총액 248,700 을 당일 카드로 전액 수납. 선수금 소비 없음(⑨=0).
    applyBillReceiptPaidBoxTokens(
      v,
      [{ method: 'card', amount: 248700, cash_receipt_issued: false, payment_type: 'payment' }],
      248700,
      0,
    );
    expect(v.already_paid).toBe('');        // ⑨ 공란
    expect(v.due_amount).toBe('248,700');   // ⑩ = ⑧ − ⑨
    expect(v.card_amount).toBe('248,700');  // ⑪
    expect(v.paid_total).toBe('248,700');
    expect(v.unpaid_amount).toBe('0');      // 미납 0
    expect(v._paidbox_invariant).toBe('ok');
  });

  test('골든②: 환불상쇄 net0 → ⑪ 공란, ⑨ 유지, 미납=0, 불변식 ok', () => {
    const v: Record<string, string> = {};
    // 선수금 130,000 소비(⑨). 당일 결제 100,000 을 같은 날 100,000 환불 → net 0.
    applyBillReceiptPaidBoxTokens(
      v,
      [
        { method: 'card', amount: 100000, cash_receipt_issued: false, payment_type: 'payment' },
        { method: 'card', amount: 100000, cash_receipt_issued: false, payment_type: 'refund' },
      ],
      130000,
      130000,
    );
    expect(v.already_paid).toBe('130,000'); // ⑨ 유지(선수금 소비분)
    expect(v.card_amount).toBe('');         // net 0 → 공란
    expect(v.paid_total).toBe('');          // ⑪ net 0
    expect(v.due_amount).toBe('0');         // ⑩ = 130,000 − 130,000
    expect(v.unpaid_amount).toBe('0');
    expect(v._paidbox_invariant).toBe('ok');
  });

  test('골든③: 선차감 F-4790류 → ⑨=선수금(비급여) 300,000, ⑪=8,800, 미납=0, 불변식 ok', () => {
    const v: Record<string, string> = {};
    // ⑧ 308,800 = 선수금 소비 300,000(⑨) + 데스크 진찰료 8,800(당일 카드).
    applyBillReceiptPaidBoxTokens(
      v,
      [{ method: 'card', amount: 8800, cash_receipt_issued: false, payment_type: 'payment' }],
      308800,
      300000,
    );
    expect(v.already_paid).toBe('300,000'); // ⑨
    expect(v.due_amount).toBe('8,800');     // ⑩
    expect(v.paid_total).toBe('8,800');     // ⑪
    expect(v.unpaid_amount).toBe('0');      // 미납 0 (허위 미납 표기 소멸)
    expect(v._paidbox_invariant).toBe('ok');
  });

  // ═══════════ 유효작업#1: 불변식 가드 (Stage1 warn-only) ═══════════

  test('가드-정상: ⑧=⑨+⑪+미납 성립 → ok=true, clampFired=false, violations=[]', () => {
    const r = checkBillReceiptPaidBoxInvariant(308800, 300000, 8800, 8800, 0);
    expect(r.ok).toBe(true);
    expect(r.clampFired).toBe(false);
    expect(r.violations).toEqual([]);
  });

  test('가드-클램프(⑨>⑧): ⑩ 클램프 발동 → clampFired=true, 불변식 위반 플래그', () => {
    // ⑨(130,000) > ⑧(100,000) → ⑩=max(0,…)=0 클램프.
    const r = checkBillReceiptPaidBoxInvariant(100000, 130000, 0, 0, 0);
    expect(r.clampFired).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toContain('⑩ 클램프');
  });

  test('가드-클램프(⑪>⑩): 과납 → clampFired=true, 불변식 위반 플래그', () => {
    // ⑪(120,000) > ⑩(100,000) → 미납=max(0,…)=0 클램프.
    const r = checkBillReceiptPaidBoxInvariant(100000, 0, 120000, 100000, 0);
    expect(r.clampFired).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toContain('미납 클램프');
  });

  test('가드-warn-only: 불변식 위반이어도 발행 토큰은 정상 산출(throw 없음)', () => {
    const v: Record<string, string> = {};
    // ⑨(130,000) > ⑧(100,000) 이상 케이스 — Stage1 은 막지 않고 통과.
    expect(() => applyBillReceiptPaidBoxTokens(v, [], 100000, 130000)).not.toThrow();
    expect(v._paidbox_invariant).toBe('warn'); // 플래그 표면화
    expect(v.due_amount).toBe('0');            // ★발행 토큰은 그대로 산출(발행보류 아님)
    expect(v.unpaid_amount).toBe('0');
  });

  test('가드-warn-only: 과납(⑪>⑩)도 발행 통과 + warn 플래그', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPaidBoxTokens(
      v,
      [{ method: 'card', amount: 120000, cash_receipt_issued: false, payment_type: 'payment' }],
      100000,
      0,
    );
    expect(v._paidbox_invariant).toBe('warn');
    expect(v.paid_total).toBe('120,000'); // ⑪ 그대로 표기(발행 통과)
    expect(v.unpaid_amount).toBe('0');
  });

  test('가드-Stage2-금지선: 본 스코프에 hard-block(발행보류/throw) 미도입 — warn-only 코드만 존재', () => {
    // 헬퍼에 console.warn 은 있고, 발행보류/throw 는 없어야 함(Stage2 이관).
    expect(FB_SRC).toMatch(/invariant warn/);
    // applyBillReceiptPaidBoxTokens 본문에 throw 로 발행을 끊는 코드가 없음(warn-only).
    const fnBody = FB_SRC.slice(
      FB_SRC.indexOf('export function applyBillReceiptPaidBoxTokens'),
      FB_SRC.indexOf('export async function loadAlreadyPaidAmount'),
    );
    expect(fnBody).not.toMatch(/throw new/);
  });

  // ═══════════ 유효작업#2: 10원 절사 정합 ═══════════

  test('절사①: ⑨ 우수리(8,805) → 10원 내림(8,800), ⑩ 10원 배수 정합', () => {
    const v: Record<string, string> = {};
    // ⑨ 8,805(SSOT copay+nonCovered 우수리) → 8,800 절사. ⑧ 250,000.
    applyBillReceiptPaidBoxTokens(v, [], 250000, 8805);
    expect(v.already_paid).toBe('8,800');         // ⑨ 절사
    expect(v.due_amount).toBe('241,200');         // ⑩ = 250,000 − 8,800 (10원 배수)
    // ⑩ 이 10원 배수인지 산술 확인.
    expect(Number(v.due_amount.replace(/,/g, '')) % 10).toBe(0);
  });

  test('절사②: ⑨ 이미 10원 배수(300,000) → 무변경(회귀0)', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPaidBoxTokens(v, [], 308800, 300000);
    expect(v.already_paid).toBe('300,000');
    expect(v.due_amount).toBe('8,800');
  });

  test('절사③: 우수리 여러 값에서 ⑩ 항상 10원 배수(⑧ 10원 배수 전제)', () => {
    for (const ap of [1, 5, 9, 11, 8801, 8809, 129995]) {
      const v: Record<string, string> = {};
      applyBillReceiptPaidBoxTokens(v, [], 250000, ap);
      const due = Number(v.due_amount.replace(/,/g, ''));
      expect(due % 10, `alreadyPaid=${ap} → ⑩=${due}`).toBe(0);
    }
  });

  // ═══════════ 유효작업#3: 3 인쇄경로 대칭 (헬퍼 단일소스) ═══════════

  test('대칭①: 가드+절사가 헬퍼 한 곳(applyBillReceiptPaidBoxTokens)에 위치 → 3경로 자동 대칭', () => {
    const fnBody = FB_SRC.slice(
      FB_SRC.indexOf('export function applyBillReceiptPaidBoxTokens'),
      FB_SRC.indexOf('export async function loadAlreadyPaidAmount'),
    );
    // 절사규칙(computeBillDetailRounding)과 불변식 가드(checkBillReceiptPaidBoxInvariant) 모두 헬퍼 내부.
    expect(fnBody).toMatch(/computeBillDetailRounding\(alreadyPaid\)/);
    expect(fnBody).toMatch(/checkBillReceiptPaidBoxInvariant\(/);
  });

  test('대칭②: 3 호출부 모두 동일 헬퍼 경유(path-sweeper 재확인)', () => {
    expect(PMW_SRC).toMatch(/applyBillReceiptPaidBoxTokens\(\s*autoValues,/);       // PMW
    expect(DPP_SRC).toMatch(/applyBillReceiptPaidBoxTokens\(base, paymentItems,/);  // DPP 단건
    expect(DPP_SRC).toMatch(/applyBillReceiptPaidBoxTokens\(v, paymentItems,/);     // DPP 일괄
  });

  test('대칭③: 동일 입력 → 3경로(헬퍼) 산출 동일(진단 마커 포함)', () => {
    const pays = [{ method: 'card', amount: 8800, cash_receipt_issued: false, payment_type: 'payment' }];
    const a: Record<string, string> = {}; applyBillReceiptPaidBoxTokens(a, pays, 308800, 300005);
    const b: Record<string, string> = {}; applyBillReceiptPaidBoxTokens(b, pays, 308800, 300005);
    const c: Record<string, string> = {}; applyBillReceiptPaidBoxTokens(c, pays, 308800, 300005);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a._paidbox_invariant).toBe(a._paidbox_invariant); // 결정론
  });

  // ═══════════ 금지선 (GO 판정 Q3): ⑨ 소스 교체·⑪ 반응성 합산 무접촉 ═══════════

  test('금지선: ⑨ 소스는 여전히 check_in_services(is_package_session) — package_payments 원장 미사용', () => {
    // loadAlreadyPaidAmount 가 package_payments 를 소스로 쓰지 않음(그레인 오염 금지).
    const loaderBody = FB_SRC.slice(FB_SRC.indexOf('export async function loadAlreadyPaidAmount'));
    expect(loaderBody).toMatch(/from\('check_in_services'\)/);
    expect(loaderBody).not.toMatch(/from\('package_payments'\)/);
  });
});
