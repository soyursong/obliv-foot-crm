/**
 * T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-FIX — 회수1 패키지 phantom 미수 systemic 치유 (R1)
 *
 * 배경 (DIAG: T-20260717-foot-PKGPAY-RECEIPT-MISSING-SYSTEMIC-DIAG):
 *   파생 미수(pkg_due)를 package_payments 만으로 산출하면, package_payments 를 **의도적으로**
 *   만들지 않는 회수1 단건(PKGCLASS-SESSION1-SINGLE)·양도 승계(PACKAGE-TRIPLE-DEFECT) 결제가
 *   반영되지 않아 phantom 미수가 뜬다(완납했는데 미수 O원 표시). TIGHT 대상 = 40 pkg / ₩1,698,000.
 *
 * 수정 (R1 채택 — write-path UNCHANGED, db_change=false, 백필 0행):
 *   footBilling.effectiveNetPaid(pkg, rows) 헬퍼로 net-paid 산출을 중앙화. 결제행이 비었을 때
 *   회수1/양도 패키지는 paid_amount 를 net-paid 소스로 사용 → phantom 미수 자동 치유.
 *   pkg_due 파생 8콜러(loadCustomerOutstanding SSOT + PaymentDialog + CustomerChartPage×2 +
 *   Packages 상세)가 동일 헬퍼 채택.
 *
 * 검증 (순수 로직 불변식 — auth/server/page 불요, unit 프로젝트):
 *   AC1) 회수1 완납 phantom 소멸: total_sessions≤1 ∩ paid_amount==total ∩ package_payments empty
 *        → effectiveNetPaid=paid_amount → 미수 due=0 (완납). (SNAPSHOT 40건 대표 케이스 변환)
 *   AC2) 회귀 0: 회수≥2·정상 package_payments 보유 패키지의 미수 산출 불변(기존 netPaidFromPayments).
 *   AC3) 매출 split 불변: effectiveNetPaid 는 미수 파생에만 관여 — netPaidFromPayments SSOT 자체 무변경.
 *   +) F-4857 archive 가드: effectiveNetPaid 는 값만 계산(포함여부는 콜러 status 필터) — 회수1이라도
 *      결제행이 있으면 폴백 미개입.
 *
 * READ-ONLY — DB 변경 없음.
 */

import { test, expect } from '@playwright/test';
import {
  effectiveNetPaid,
  computeOutstanding,
  balanceStatus,
  netPaidFromPayments,
  isSinglePaymentByCount,
  type PackagePaymentRow,
} from '../../src/lib/footBilling';

// DIAG SNAPSHOT L2 TIGHT 대표 케이스(무좀체험권 10,000 / 오니코레이저 260,000 / RB2 500,000=F-4857).
// 전건 공통 지문: total_sessions=1 · paid_amount==total_amount · package_payments empty.
const TIGHT_CASES = [
  { name: '무좀체험권', total_sessions: 1, total_amount: 10000, paid_amount: 10000 },
  { name: '오니코레이저', total_sessions: 1, total_amount: 260000, paid_amount: 260000 },
  { name: 'RB2(에센셜)/F-4857', total_sessions: 1, total_amount: 500000, paid_amount: 500000 },
  { name: '회수0 degenerate', total_sessions: 0, total_amount: 30000, paid_amount: 30000 },
];

test.describe('AC1 — 회수1 완납 phantom 미수 소멸 (paid_amount 폴백)', () => {
  for (const c of TIGHT_CASES) {
    test(`${c.name}: package_payments empty·완납 → 미수 0(완납)`, () => {
      const rows: PackagePaymentRow[] = []; // package_payments 미생성(버그 서명 경로)
      const netPaid = effectiveNetPaid(c, rows);
      const due = computeOutstanding(c.total_amount, netPaid);
      expect(netPaid).toBe(c.paid_amount);          // paid_amount 를 net-paid 로 채택
      expect(due).toBe(0);                           // phantom 미수 소멸
      expect(balanceStatus(due)).toBe('paid');       // '완납'
    });
  }

  test('회수1 부분납(paid<total) → 미수 = 잔액 정확 표시 (거짓 완납 아님)', () => {
    const pkg = { total_sessions: 1, total_amount: 500000, paid_amount: 200000 };
    const due = computeOutstanding(pkg.total_amount, effectiveNetPaid(pkg, []));
    expect(due).toBe(300000);
    expect(balanceStatus(due)).toBe('due');
  });
});

test.describe('AC2 — 회귀 0 (회수≥2·정상 package_payments 보유 미수 불변)', () => {
  test('회수5 분할결제 진행중(package_payments 有): 기존 netPaidFromPayments 와 동일', () => {
    const pkg = { total_sessions: 5, total_amount: 500000, paid_amount: 300000 };
    const rows: PackagePaymentRow[] = [
      { amount: 200000, payment_type: 'payment', fee_kind: 'package' },
      { amount: 100000, payment_type: 'payment', fee_kind: 'package' },
    ];
    // 폴백 미개입 → 결제행 SSOT 그대로
    expect(effectiveNetPaid(pkg, rows)).toBe(netPaidFromPayments(rows, 'package'));
    const due = computeOutstanding(pkg.total_amount, effectiveNetPaid(pkg, rows));
    expect(due).toBe(200000); // 500,000 − 300,000
    expect(balanceStatus(due)).toBe('due');
  });

  test('회수≥2 미납(package_payments empty·미양도): phantom 아님 — 정말 미납은 그대로 미수', () => {
    const pkg = { total_sessions: 3, total_amount: 300000, paid_amount: 0 };
    // 회수≥2 + 비양도 → 폴백 미개입 → netPaidFromPayments([])=0 → 실미수 유지
    expect(effectiveNetPaid(pkg, [])).toBe(0);
    expect(computeOutstanding(pkg.total_amount, effectiveNetPaid(pkg, []))).toBe(300000);
  });

  test('환불 부호(refund) 반영 불변: 회수≥2 결제−환불 = 순납부', () => {
    const pkg = { total_sessions: 4, total_amount: 400000, paid_amount: 100000 };
    const rows: PackagePaymentRow[] = [
      { amount: 200000, payment_type: 'payment', fee_kind: 'package' },
      { amount: 100000, payment_type: 'refund', fee_kind: 'package' },
    ];
    expect(effectiveNetPaid(pkg, rows)).toBe(100000);
    expect(computeOutstanding(pkg.total_amount, effectiveNetPaid(pkg, rows))).toBe(300000);
  });

  test('fee_kind 분리 불변: consultation 결제는 패키지 net-paid 에 미포함', () => {
    const pkg = { total_sessions: 5, total_amount: 500000, paid_amount: 0 };
    const rows: PackagePaymentRow[] = [
      { amount: 50000, payment_type: 'payment', fee_kind: 'consultation' },
    ];
    // package net-paid 는 consultation 행 제외 → 0
    expect(effectiveNetPaid(pkg, rows)).toBe(0);
  });
});

test.describe('AC3 — 매출 split 불변 (effectiveNetPaid 는 미수 파생 전용)', () => {
  test('netPaidFromPayments SSOT 자체는 무변경 (매출·결제분류 소스 불변)', () => {
    const rows: PackagePaymentRow[] = [
      { amount: 100000, payment_type: 'payment', fee_kind: 'package' },
      { amount: 30000, payment_type: 'payment', fee_kind: 'consultation' },
    ];
    expect(netPaidFromPayments(rows, 'package')).toBe(100000);
    expect(netPaidFromPayments(rows, 'consultation')).toBe(30000);
  });

  test('회수1 단건은 매출-이중계상 방지(package_payments 미생성) 규칙과 정합 — 폴백은 미수만', () => {
    // 단건 패키지: 결제행이 없어도 effectiveNetPaid 가 paid_amount 로 완납 처리하되,
    // package_payments 를 만들지 않으므로 매출 집계(netPaidFromPayments)에는 계상되지 않는다.
    const pkg = { total_sessions: 1, total_amount: 260000, paid_amount: 260000 };
    expect(effectiveNetPaid(pkg, [])).toBe(260000);           // 미수 파생 = 완납
    expect(netPaidFromPayments([], 'package')).toBe(0);       // 매출(패키지)엔 미계상 (단건=payments 귀속)
  });
});

test.describe('F-4857 archive 가드 + 경계', () => {
  test('회수1이라도 package_payments 가 있으면 폴백 미개입 (결제행 권위)', () => {
    const pkg = { total_sessions: 1, total_amount: 100000, paid_amount: 999999 };
    const rows: PackagePaymentRow[] = [
      { amount: 100000, payment_type: 'payment', fee_kind: 'package' },
    ];
    // rows 비어있지 않음 → paid_amount(오염 가능값) 미채택, 결제행 사용
    expect(effectiveNetPaid(pkg, rows)).toBe(100000);
  });

  test('양도 승계(transferred_from·결제행 empty) → paid_amount 폴백 (PACKAGE-TRIPLE-DEFECT 정합)', () => {
    const pkg = { total_sessions: 10, total_amount: 500000, paid_amount: 500000, transferred_from: 'prev-pkg-id' };
    expect(effectiveNetPaid(pkg, [])).toBe(500000);
    expect(computeOutstanding(pkg.total_amount, effectiveNetPaid(pkg, []))).toBe(0);
  });

  test('isSinglePaymentByCount 경계: 0·1=단건 / 2↑=패키지', () => {
    expect(isSinglePaymentByCount(0)).toBe(true);
    expect(isSinglePaymentByCount(1)).toBe(true);
    expect(isSinglePaymentByCount(2)).toBe(false);
    expect(isSinglePaymentByCount(null)).toBe(true); // degenerate → 단건 안전측
  });
});
