/**
 * E2E spec — T-20260725-foot-SALESTAB-TREATMENT-6BUCKET-WHITELIST
 * 매출집계(/admin/sales) "시술 종류별 매출" 탭 — 6버킷 화이트리스트 + 분류 이원화 제거.
 *
 * 본 티켓 핵심: SalesTreatmentTab.resolveBucket 이 자체 키워드 판정을 재작성하지 않고
 *   결제창(PaymentMiniWindow)의 분류 SSOT(isCosmeticService / prepaidSessionType)를 직접 재사용한다.
 *   → 결제창과 매출탭의 항목 귀속이 어긋나지 않음(단일 분류 소스).
 *
 * 검증 구성:
 *   AC-SSOT1 (순수함수): resolveBucket 결과가 PaymentMiniWindow SSOT 판정과 정합.
 *                        (화장품=isCosmeticService, 레이저/포돌로게=prepaidSessionType)
 *   AC-SSOT2 (순수함수): service_code 코드우선 매칭(SZ035-30/35·BC1300MB08) — 이름 없이도 버킷 귀속.
 *   AC-WL   (순수함수): 6버킷 외(수액·처방약·상병 등) → null(표시 제외).
 *   AC-DISP (UI mock) : 탭에 6버킷만 노출 + 수액 제외 + 상단 합계=6버킷 합산 (현장 시나리오1).
 *   AC-SRC  (소스가드): resolveBucket 이 PaymentMiniWindow 로부터 분류 SSOT 를 import 한다(회귀 가드).
 *
 * READ-ONLY — DB 변경 없음.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { resolveBucket, BUCKETS } from '../../src/components/sales/SalesTreatmentTab';
import { isCosmeticService, prepaidSessionType } from '../../src/components/PaymentMiniWindow';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const SALES_URL = `${BASE_URL}/admin/sales`;

// 테스트용 서비스 헬퍼 — SalesTreatmentTab.CheckInService['services'] 형태
type Svc = {
  name: string | null;
  category: string | null;
  category_label: string | null;
  service_code: string | null;
};
const svc = (p: Partial<Svc>): Svc => ({
  name: null,
  category: null,
  category_label: null,
  service_code: null,
  ...p,
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-SSOT1: PaymentMiniWindow 분류 SSOT 와 정합(이원화 없음)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-SSOT1: resolveBucket ↔ PaymentMiniWindow 분류 SSOT 정합', () => {
  test('화장품 = isCosmeticService 판정과 일치 → cosmetic 버킷', () => {
    // category / category_label 어느 쪽이든 풋화장품
    const byCat = svc({ name: '발각질크림', category: '풋화장품' });
    const byLabel = svc({ name: '풋샴푸', category_label: '풋화장품' });
    for (const s of [byCat, byLabel]) {
      expect(isCosmeticService(s)).toBe(true); // SSOT
      expect(resolveBucket(s)).toBe('cosmetic'); // 매출탭이 SSOT 를 따른다
    }
    // '발각질크림'은 '각질' 명칭이지만 category=풋화장품 → Reborn 아닌 화장품 우선(SSOT 순서 계승)
    expect(resolveBucket(byCat)).toBe('cosmetic');
  });

  test('레이저/포돌로게 = prepaidSessionType 판정과 일치', () => {
    const cases: { s: Svc; expect: string }[] = [
      { s: svc({ name: '비가열레이저 - 아톰', category: '풋케어' }), expect: 'unheated' },
      { s: svc({ name: '가열성 진균증 레이저 치료', category: '풋케어' }), expect: 'heated' },
      { s: svc({ name: '포돌로게(내성발톱)', category: '풋케어' }), expect: 'podologue' },
    ];
    const map: Record<string, string> = {
      unheated_laser: 'unheated',
      heated_laser: 'heated',
      podologue: 'podologue',
    };
    for (const c of cases) {
      const pt = prepaidSessionType(c.s); // SSOT
      expect(pt && map[pt]).toBe(c.expect);
      expect(resolveBucket(c.s)).toBe(c.expect); // 매출탭이 SSOT 를 따른다
    }
  });

  test("'비가열'이 '가열'보다 먼저 판정(상위집합 순서 규약 SSOT 계승)", () => {
    // 이름에 '비가열' 포함 → heated 로 잘못 매칭되면 안 됨
    const s = svc({ name: '비가열레이저 패키지', category: '풋케어' });
    expect(prepaidSessionType(s)).toBe('unheated_laser');
    expect(resolveBucket(s)).toBe('unheated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-SSOT2: service_code 코드우선 매칭 (이름 없이도 SSOT 코드로 귀속)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-SSOT2: service_code 코드우선 매칭', () => {
  test('코드만으로 레이저/포돌로게 버킷 귀속 (이름 비어도)', () => {
    expect(resolveBucket(svc({ name: '내부명칭', service_code: 'SZ035-30' }))).toBe('unheated');
    expect(resolveBucket(svc({ name: '내부명칭', service_code: 'SZ035-35' }))).toBe('heated');
    expect(resolveBucket(svc({ name: '내부명칭', service_code: 'BC1300MB08' }))).toBe('podologue');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-WL: 6버킷 외 항목 제외 + 진찰료/Reborn 로컬 판정
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-WL: 화이트리스트 경계', () => {
  test('진찰료(기본/제증명/검사) → consult, Reborn(리본/각질) → reborn', () => {
    expect(resolveBucket(svc({ name: '초진진찰료-의원', category_label: '기본' }))).toBe('consult');
    expect(resolveBucket(svc({ name: '진단서', category_label: '제증명' }))).toBe('consult');
    expect(resolveBucket(svc({ name: '균검사', category_label: '검사' }))).toBe('consult');
    expect(resolveBucket(svc({ name: '리본 에센셜(각질)', category: '풋케어' }))).toBe('reborn');
  });

  test('6버킷 외(수액·처방약·상병·null) → null(표시 제외)', () => {
    expect(resolveBucket(svc({ name: '재생수액', category: '수액' }))).toBeNull();
    expect(resolveBucket(svc({ name: '테르비나핀정', category: '처방약' }))).toBeNull();
    expect(resolveBucket(svc({ name: '감염 상병', category: '상병' }))).toBeNull();
    expect(resolveBucket(null)).toBeNull();
    // 수액은 prepaidSessionType='iv' 이지만 6버킷 밖 → 반드시 제외
    expect(prepaidSessionType(svc({ name: '수액', category: '수액' }))).toBe('iv');
    expect(resolveBucket(svc({ name: '수액', category: '수액' }))).toBeNull();
  });

  test('BUCKETS = 6개 고정 순서/표시명', () => {
    expect(BUCKETS.map((b) => b.id)).toEqual([
      'unheated',
      'heated',
      'podologue',
      'reborn',
      'cosmetic',
      'consult',
    ]);
    expect(BUCKETS.map((b) => b.label)).toEqual([
      '비가열레이저',
      '가열레이저',
      '포돌로게(내성)',
      'Reborn(각질)',
      '풋화장품',
      '진찰료(기본/서류/검사비)',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-DISP: 현장 시나리오1 — 탭에 6버킷만 + 수액 제외 + 합계=6버킷 합산 (UI mock)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-DISP: 시술 종류별 탭 표시 (현장 시나리오1)', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  const mk = (id: string, amount: number, s: Partial<Svc>) => ({
    id,
    amount,
    payment_type: 'payment',
    status: 'completed',
    accounting_date: '2026-05-15',
    check_ins: {
      check_in_services: [{ price: amount, services: svc(s) }],
    },
  });

  const payments = [
    mk('d-01', 100000, { name: '비가열레이저', category: '풋케어', service_code: 'SZ035-30' }),
    mk('d-02', 90000, { name: '가열레이저', category: '풋케어', service_code: 'SZ035-35' }),
    mk('d-03', 80000, { name: '포돌로게', category: '풋케어', service_code: 'BC1300MB08' }),
    mk('d-04', 70000, { name: '리본 에센셜(각질)', category: '풋케어' }),
    mk('d-05', 60000, { name: '풋샴푸', category: '풋화장품', category_label: '풋화장품' }),
    mk('d-06', 50000, { name: '초진진찰료-의원', category: '기본', category_label: '기본' }),
    // 화이트리스트 외 — 표기 금지
    mk('d-ex', 40000, { name: '재생수액', category: '수액', category_label: '수액' }),
  ];

  test('6버킷만 노출 + 수액 제외 + 합계=450,000(수액 40k 제외)', async ({ page }) => {
    await page.route('**/rest/v1/payments**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payments),
      }),
    );
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /시술별/ }).click();
    await page.waitForLoadState('networkidle');

    const tab = page.getByTestId('sales-treatment-tab');
    await expect(tab).toBeVisible({ timeout: 5000 });

    // 정확히 6개 버킷 헤더
    await expect(
      tab.locator('[data-testid^="sales-treatment-category-btn-"]'),
    ).toHaveCount(6);

    // 수액 미표기
    await expect(tab).not.toContainText('재생수액');
    await expect(tab).not.toContainText('수액');

    // 상단 합계 = 6버킷 합산 (수액 40k 제외 → 450,000)
    await expect(page.getByTestId('sales-treatment-total')).toContainText('450,000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-SRC: 분류 SSOT import 회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test('AC-SRC: SalesTreatmentTab 이 PaymentMiniWindow 분류 SSOT 를 import 한다', () => {
  const SRC = fs.readFileSync(
    path.resolve('src/components/sales/SalesTreatmentTab.tsx'),
    'utf-8',
  );
  // 자체 재작성이 아니라 SSOT import 재사용
  expect(SRC).toMatch(/import\s*\{[^}]*isCosmeticService[^}]*prepaidSessionType[^}]*\}\s*from\s*'@\/components\/PaymentMiniWindow'/);
  expect(SRC).toContain('isCosmeticService(svc)');
  expect(SRC).toContain('prepaidSessionType(svc)');
});
