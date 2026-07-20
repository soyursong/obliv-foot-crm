/**
 * T-20260713-foot-PAYMINI-ITEMSEDITOR-REVERT
 * PaymentMiniWindow 항목별 명세 에디터(PaymentItemsEditor) 순수 revert → lump-sum(총액 1칸) 원복.
 *
 * ── 배경 ──
 * 37544ed8(T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY P1 FIX)에서 PaymentItemsEditor 를
 * 현장 정본 결제 표면 PaymentMiniWindow 에 탑재했으나, 현장(김주연 총괄) 판단으로 미니결제창은
 * 37544ed8 이전 lump-sum(총액 한 칸) known-good 상태로 순수 revert 한다.
 *   - 신규 레이아웃 창작·좌표 추측 금지 = 기지(known-good) 원복만.
 *   - payment_items DB 테이블·데이터는 존치(DROP/DELETE 금지). FE(PaymentMiniWindow)에서만 숨김.
 *   - PaymentItemsEditor 컴포넌트 자체는 존치(PaymentDialog 에서 계속 사용).
 *   - 결제수단 분할 등 기존 lump-sum 기능 유지.
 *
 * 검증축:
 *   L0 (revert source-guard, auth-free): PaymentMiniWindow 가 PaymentItemsEditor 를 더 이상
 *       import/render 하지 않고, insertPaymentItems / payment_items insert 경로가 소스에서 제거됐는지.
 *   존치 (retain-guard, auth-free): PaymentItemsEditor.tsx 컴포넌트 + PaymentDialog 탑재 존치.
 *   lump-sum 유지 (auth-free): 분할결제(splitMode) 등 기존 lump-sum 기능 소스 잔존.
 *   AC (DB 계약, service_role): payment_items 테이블·스키마 존치 + lump-sum 수납 회귀 0.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.resolve(__dirname_, '../../', rel), 'utf-8');

// ════════════════════════════════════════════════════════════════════════════
// L0 — revert source-guard (auth-free, 결정적). PaymentMiniWindow lump-sum 원복.
// ════════════════════════════════════════════════════════════════════════════
test.describe('L0 revert — PaymentMiniWindow 에서 PaymentItemsEditor 언마운트(lump-sum 원복)', () => {
  test('PaymentMiniWindow 소스에 PaymentItemsEditor import/render 부재', () => {
    const s = src('src/components/PaymentMiniWindow.tsx');
    expect(s, 'PaymentItemsEditor import 제거').not.toMatch(
      /import\s*\{[^}]*PaymentItemsEditor[^}]*\}\s*from\s*'@\/components\/PaymentItemsEditor'/,
    );
    expect(s, 'PaymentItemsEditor JSX 렌더 제거').not.toContain('<PaymentItemsEditor');
    expect(s, 'PaymentItemDraft 타입 참조 제거').not.toContain('PaymentItemDraft');
    expect(s, 'draftFromService 참조 제거').not.toContain('draftFromService');
  });

  test('PaymentMiniWindow 소스에 payment_items write 경로(insertPaymentItems) 부재', () => {
    const s = src('src/components/PaymentMiniWindow.tsx');
    expect(s, 'insertPaymentItems 헬퍼 제거').not.toContain('insertPaymentItems');
    expect(s, "payment_items insert 경로 제거").not.toMatch(/from\('payment_items'\)/);
    expect(s, 'lineItems 상태 제거').not.toContain('lineItems');
    // payments insert 는 lump-sum known-good 형태(.select('id') 없이 error 만 destructure)로 원복
    expect(s, 'payments insert lump-sum 원복').toMatch(
      /const\s*\{\s*error:\s*payErr\s*\}\s*=\s*await\s+supabase\.from\('payments'\)\.insert\(payRows\)/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 존치 — PaymentItemsEditor 컴포넌트 + PaymentDialog 탑재 존치(FE에서만 PMW 숨김).
// ════════════════════════════════════════════════════════════════════════════
test.describe('존치 — PaymentItemsEditor 컴포넌트·PaymentDialog 탑재 유지', () => {
  test('PaymentItemsEditor.tsx 컴포넌트 존치(삭제 금지)', () => {
    const s = src('src/components/PaymentItemsEditor.tsx');
    expect(s, 'PaymentItemsEditor export 존치').toMatch(/export\s+(function|const)\s+PaymentItemsEditor/);
    expect(s).toContain('data-testid="btn-add-payment-item"');
  });

  test('PaymentDialog 는 PaymentItemsEditor 를 계속 탑재(revert 대상 아님)', () => {
    const s = src('src/components/PaymentDialog.tsx');
    expect(s, 'PaymentDialog PaymentItemsEditor import 존치').toMatch(
      /import\s*\{[^}]*PaymentItemsEditor[^}]*\}\s*from\s*'@\/components\/PaymentItemsEditor'/,
    );
    expect(s, 'PaymentDialog PaymentItemsEditor JSX 존치').toContain('<PaymentItemsEditor');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// lump-sum 유지 — 분할결제 등 기존 lump-sum 기능 잔존.
// ════════════════════════════════════════════════════════════════════════════
test.describe('lump-sum 유지 — 결제수단 분할 등 기존 기능 회귀 0', () => {
  test('PaymentMiniWindow 분할결제(splitMode)·grandTotal lump-sum 로직 잔존', () => {
    const s = src('src/components/PaymentMiniWindow.tsx');
    expect(s, '분할결제 splitMode 잔존').toContain('splitMode');
    expect(s, 'grandTotal(총액) 산정 잔존').toContain('grandTotal');
    expect(s, '수납 확정 버튼(btn-settle) 잔존').toContain('btn-settle');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC (DB 계약, 보조) — payment_items 테이블 존치 + lump-sum 수납 회귀 0.
// ════════════════════════════════════════════════════════════════════════════
test.describe('AC — payment_items 테이블 존치 + lump-sum 회귀', () => {
  test('payment_items 테이블·스키마 존치(데이터 계약 유지, DROP 안 됨)', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    // 테이블이 존치하면 select 가 에러 없이 반환(관계 부재면 42P01 에러).
    const { error } = await sb.from('payment_items').select('id').limit(1);
    expect(error, 'payment_items 테이블 존치(select 정상)').toBeNull();
  });

  test('lump-sum 회귀 0 — 항목 없는 총액 단독 수납 저장·조회 정상', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const phone = `DUMMY-${Date.now()}`;
    let customerId: string | null = null;
    let paymentId: string | null = null;
    try {
      const { data: customer } = await sb.from('customers')
        .insert({ clinic_id: CLINIC_ID, name: `revert-lump-${Date.now()}`, phone, visit_type: 'new' })
        .select().single();
      customerId = customer!.id;
      const { data: pay, error } = await sb.from('payments')
        .insert({ clinic_id: CLINIC_ID, customer_id: customerId, amount: 80000, method: 'transfer', payment_type: 'payment' })
        .select('id, amount').single();
      expect(error, 'lump-sum payments insert 정상').toBeNull();
      paymentId = pay!.id;
      expect(pay!.amount).toBe(80000);
      // 항목 명세 없이 수납 = payment_items 0행(회귀 0)
      const { data: items } = await sb.from('payment_items').select('id').eq('payment_id', paymentId);
      expect(items ?? [], 'lump-sum 수납은 payment_items 0행').toHaveLength(0);
    } finally {
      if (paymentId) await sb.from('payments').delete().eq('id', paymentId);
      if (customerId) await sb.from('customers').delete().eq('id', customerId);
    }
  });
});
