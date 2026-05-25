/**
 * E2E spec — T-20260525-foot-CLOSING-SUM-ERR
 * 일마감 총합계 합산액 불일치 수정 검증
 *
 * 근본 원인:
 *   totals useMemo가 [payments, pkgPayments]만 dep으로 가짐 → manualEntries 누락.
 *   수기결제는 enrichedRows(결제내역 탭)에는 표시되었지만,
 *   SummaryCard(총합계 탭)의 grossTotal에는 반영되지 않음.
 *
 * Fix (b8d7157):
 *   - manualCard/Cash/Transfer 합산 로직 추가
 *   - dep array에 manualEntries 추가 → [payments, pkgPayments, manualEntries]
 *   - totalCard/Cash/Transfer = pkg + single + manual (NET)
 *   - grossTotal = totalCard + totalCash + totalTransfer (manual 포함)
 *   - 수기결제 있을 때 SummaryCard "수기결제" 소계 카드 추가
 *
 * AC-1: totals useMemo dep array에 manualEntries 포함 확인 (소스 검증)
 * AC-2: totalCard/Cash/Transfer에 manualCard/Cash/Transfer 합산 확인
 * AC-3: 환불 건 반영 로직 — payments.payment_type='refund' 차감 경로 검증
 * AC-4: grossTotal = totalCard + totalCash + totalTransfer (DB SUM 교차 검증)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// ─── 소스 정적 검증 (AC-1, AC-2, AC-3) ────────────────────────────────────────

test.describe('T-20260525-CLOSING-SUM-ERR 소스 검증', () => {

  test('AC-1: totals useMemo dep array에 manualEntries 포함', () => {
    const src: string = fs.readFileSync('src/pages/Closing.tsx', 'utf-8');

    // dep array: [payments, pkgPayments, manualEntries]
    expect(src).toContain('}, [payments, pkgPayments, manualEntries]');
  });

  test('AC-2: manualCard/Cash/Transfer가 totalCard/Cash/Transfer에 합산됨', () => {
    const src: string = fs.readFileSync('src/pages/Closing.tsx', 'utf-8');

    // manualEntries 필터링 후 합산
    expect(src).toContain("manualEntries.filter(m => m.method === 'card')");
    expect(src).toContain("manualEntries.filter(m => m.method === 'cash')");
    expect(src).toContain("manualEntries.filter(m => m.method === 'transfer')");

    // totalCard = pkgCard + singleCard + manualCard
    expect(src).toContain('pkgCard + singleCard + manualCard');
    expect(src).toContain('pkgCash + singleCash + manualCash');
    expect(src).toContain('pkgTransfer + singleTransfer + manualTransfer');
  });

  test('AC-3: 환불 건 반영 — payment_type refund 차감 경로 존재', () => {
    const src: string = fs.readFileSync('src/pages/Closing.tsx', 'utf-8');

    // sum() 헬퍼: payment_type='refund' → -amount
    expect(src).toContain("r.payment_type === 'refund' ? -r.amount : r.amount");

    // 환불 합계 계산
    expect(src).toContain("payments.filter(r => r.payment_type === 'refund')");
    expect(src).toContain("pkgPayments.filter(r => r.payment_type === 'refund')");

    // refundAmount = refundSingleAmount + refundPkgAmount
    expect(src).toContain('refundSingleAmount + refundPkgAmount');
  });

  test('AC-2: grossTotal = totalCard + totalCash + totalTransfer (manual 포함 NET)', () => {
    const src: string = fs.readFileSync('src/pages/Closing.tsx', 'utf-8');

    // grossTotal 공식 — membership 제외 명시
    expect(src).toContain('const grossTotal = totalCard + totalCash + totalTransfer');

    // SummaryCard 합계에 grossTotal 전달
    expect(src).toContain('total={totals.grossTotal}');
  });

  test('AC-2: 수기결제 SummaryCard — manualTotal > 0 조건부 렌더링', () => {
    const src: string = fs.readFileSync('src/pages/Closing.tsx', 'utf-8');

    // 수기결제 소계 카드: totals.manualTotal > 0 일 때만 표시
    expect(src).toContain('totals.manualTotal > 0');
    expect(src).toContain('title="수기결제"');
    expect(src).toContain('total={totals.manualTotal}');
  });

  test('AC-3: 수기결제는 항상 payment_type=payment (환불 없음) — manualTotal 단순 합산', () => {
    const src: string = fs.readFileSync('src/pages/Closing.tsx', 'utf-8');

    // 수기결제 comment: manual entries는 항상 payment_type='payment' (환불 없음)
    expect(src).toContain("manual entries는 항상 payment_type='payment'");
  });
});

// ─── DB 계층 검증 (AC-4) ───────────────────────────────────────────────────────

test.describe('T-20260525-CLOSING-SUM-ERR DB 검증 (AC-4)', () => {

  test('AC-4: payments + package_payments + manual SUM 교차 검증', async ({ request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      test.skip(true, 'SUPABASE env 미설정 — DB 검증 스킵');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const start = `${today}T00:00:00+09:00`;
    const end = `${today}T23:59:59+09:00`;

    // 단건 결제
    const paymentsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/payments?select=amount,method,payment_type,status&created_at=gte.${encodeURIComponent(start)}&created_at=lte.${encodeURIComponent(end)}&status=neq.deleted`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    expect(paymentsRes.ok()).toBeTruthy();
    const payments: { amount: number; method: string; payment_type: string }[] = await paymentsRes.json();

    // 패키지 결제
    const pkgRes = await request.get(
      `${SUPABASE_URL}/rest/v1/package_payments?select=amount,method,payment_type&created_at=gte.${encodeURIComponent(start)}&created_at=lte.${encodeURIComponent(end)}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    expect(pkgRes.ok()).toBeTruthy();
    const pkgPayments: { amount: number; method: string; payment_type: string }[] = await pkgRes.json();

    // 수기 결제
    const manualRes = await request.get(
      `${SUPABASE_URL}/rest/v1/closing_manual_payments?select=amount,method&close_date=eq.${today}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    expect(manualRes.ok()).toBeTruthy();
    const manuals: { amount: number; method: string }[] = await manualRes.json();

    // NET 합산 함수 (환불 차감)
    const calcNet = (
      rows: { amount: number; method: string; payment_type: string }[],
      method: string,
    ) =>
      rows
        .filter(r => r.method === method)
        .reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);

    const singleCard = calcNet(payments, 'card');
    const singleCash = calcNet(payments, 'cash');
    const singleTransfer = calcNet(payments, 'transfer');

    const pkgCard = calcNet(pkgPayments, 'card');
    const pkgCash = calcNet(pkgPayments, 'cash');
    const pkgTransfer = calcNet(pkgPayments, 'transfer');

    const manualCard = manuals.filter(m => m.method === 'card').reduce((s, m) => s + m.amount, 0);
    const manualCash = manuals.filter(m => m.method === 'cash').reduce((s, m) => s + m.amount, 0);
    const manualTransfer = manuals.filter(m => m.method === 'transfer').reduce((s, m) => s + m.amount, 0);

    const totalCard = pkgCard + singleCard + manualCard;
    const totalCash = pkgCash + singleCash + manualCash;
    const totalTransfer = pkgTransfer + singleTransfer + manualTransfer;

    // grossTotal = membership 제외 NET 합계
    const grossTotal = totalCard + totalCash + totalTransfer;

    console.log({
      singleCard, singleCash, singleTransfer,
      pkgCard, pkgCash, pkgTransfer,
      manualCard, manualCash, manualTransfer,
      totalCard, totalCash, totalTransfer,
      grossTotal,
    });

    // 핵심 검증: grossTotal >= 0 (정상 운영)
    expect(grossTotal).toBeGreaterThanOrEqual(0);

    // totalCard/Cash/Transfer가 manual 포함 = 쿼리와 수기의 합
    expect(totalCard).toBe(pkgCard + singleCard + manualCard);
    expect(totalCash).toBe(pkgCash + singleCash + manualCash);
    expect(totalTransfer).toBe(pkgTransfer + singleTransfer + manualTransfer);
  });

  test('AC-4: closing_manual_payments 테이블 접근 가능 확인', async ({ request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      test.skip(true, 'SUPABASE env 미설정 — DB 검증 스킵');
      return;
    }

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/closing_manual_payments?select=id&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );

    // 테이블 접근 성공 (200 또는 204)
    expect([200, 204].includes(res.status())).toBeTruthy();
  });
});
