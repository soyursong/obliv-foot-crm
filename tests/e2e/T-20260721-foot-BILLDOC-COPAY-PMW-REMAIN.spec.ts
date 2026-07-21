/**
 * E2E Spec — T-20260721-foot-BILLDOC-COPAY-PMW-REMAIN (P1, foot)
 *
 * ⚠ SCOPE-NARROW (SUPERSEDES): 범위 = Item ② (PMW 처치/검사 항목분해) 단독.
 *   Item ①(공단부담금 값 표시 = DocumentPrintPanel unknownGradeCopay:'general_default' 배선)은
 *   canon-gate HOLD → GONGDAN-ROUND-2DOC 트랙으로 반환됨. 본 스펙은 Item ① 를 검증하지 않으며,
 *   오히려 DPP 에 Item ① 가 (재)유입되지 않았음을 가드한다(HOLD 보호).
 *
 * Item ② — 처치/검사 항목분해(PMW 경로):
 *   현상 = 결제미니창(PaymentMiniWindow, PATH-4) 인쇄 시 처치/검사 항목 공란. 서류탭(DPP)은 정상.
 *   RC   = applyBillReceiptNewCategoryTokens 가 DocumentPrintPanel 로컬 정의만 존재 →
 *          PMW handleDocPrint / 출력+수납 경로에서 호출 없음(proc_noncov 주입 전무).
 *   단계 A = applyBillReceiptNewCategoryTokens 를 footBilling.ts SSOT 로 승격(export).
 *   단계 B = PMW 두 발행 경로에서 DPP 와 동일 인자로 호출.
 *
 * AC:
 *   1) PMW정상  — 결제미니창 단독 발행 시 처치/검사 항목 정상 표시(서류탭과 동일 파생).
 *   2) DPP회귀0 — 서류탭 처치/검사 분해 불변 + Item ①(unknownGradeCopay) 미유입(HOLD 보호).
 *   3) 등급고객회귀0 — 등급 있는 고객도 비급여 category 분해 정상(등급과 직교).
 *
 * 실행: npx playwright test T-20260721-foot-BILLDOC-COPAY-PMW-REMAIN.spec.ts
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeFootBilling,
  buildFootBillDetailItems,
  applyBillReceiptNewCategoryTokens,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, hira_category: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

type Item = FootBillingItem;

// ── 현장 재현: 급여방문 + 비급여 처치/검사/기타 혼재 ─────────────────────────────
//   급여(covered) = 초진진찰료 18,840 + KOH검사 10,540 = 29,380
//   비급여 처치(풋케어→처치및수술료) 50,000 / 비급여 검사(검사→검사료) 3,000 / 비급여 화장품(기타) 2,000
const G_CHIN = svc({ id: 'g-chin', name: '초진진찰료-의원', is_insurance_covered: true, category_label: '기본', price: 18840 });
const G_KOH  = svc({ id: 'g-koh', name: '일반진균검사-KOH도말', is_insurance_covered: true, category_label: '검사', price: 10540 });
const NC_PROC = svc({ id: 'nc-proc', name: '비급여 레이저(풋케어)', is_insurance_covered: false, category_label: '풋케어', price: 50000 });
const NC_EXAM = svc({ id: 'nc-exam', name: '비급여 추가검사', is_insurance_covered: false, category_label: '검사', price: 3000 });
const NC_ETC  = svc({ id: 'nc-etc', name: '풋 화장품', is_insurance_covered: false, category_label: '풋화장품', price: 2000 });

const VISIT: Item[] = [
  { service: G_CHIN, qty: 1, unitPrice: 18840 },
  { service: G_KOH, qty: 1, unitPrice: 10540 },
  { service: NC_PROC, qty: 1, unitPrice: 50000 },
  { service: NC_EXAM, qty: 1, unitPrice: 3000 },
  { service: NC_ETC, qty: 1, unitPrice: 2000 },
];

/**
 * 발행 경로가 공유하는 처치/검사 비급여 category 토큰 파생.
 *   PMW(단계 B)와 DPP 는 동일 함수(applyBillReceiptNewCategoryTokens)를 동일 인자로 호출하므로,
 *   순수 파생 결과가 곧 두 경로의 출력이다(경로 대칭 = 값 동일).
 */
function docTokens(grade: Parameters<typeof computeFootBilling>[1]): Record<string, string> {
  const fb = computeFootBilling(VISIT, grade);
  const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-21', {
    insuranceGrade: grade,
    copaymentTotal: fb.copaymentTotal,
  });
  const values: Record<string, string> = {};
  applyBillReceiptNewCategoryTokens(values, billItems);
  return values;
}

const parse = (s: string) => Number((s || '0').replace(/[^0-9.-]/g, ''));

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — PMW정상 : 결제미니창 단독 발행 시 처치/검사 항목 정상 표시
//   (PMW 단계 B = 서류탭과 동일 파생 → 동일 값. RC 재발 = proc_noncov 미주입 시 공란)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T-20260721 AC1 — PMW 처치/검사 항목분해 정상 (공란 해소)', () => {
  test('결제미니창 단독발행: proc_noncov=50,000 / exam_noncov=3,000 / etc_noncov=2,000 (공란 아님)', () => {
    const t = docTokens(null);
    expect(t.proc_noncov).toBe('50,000'); // 풋케어 → 처치및수술료
    expect(t.exam_noncov).toBe('3,000');  // 검사(비급여) → 검사료
    expect(t.etc_noncov).toBe('2,000');   // 풋화장품 → 기타
    // 공란 방지 회귀 가드: 3버킷 모두 채워짐.
    expect(t.proc_noncov).not.toBe('');
    expect(t.exam_noncov).not.toBe('');
    expect(t.etc_noncov).not.toBe('');
  });

  test('RC 재발 방지: applyBillReceiptNewCategoryTokens 미주입이면 3토큰 전부 undefined (구 PMW 공란)', () => {
    // 종전 PMW handleDocPrint 는 이 함수를 호출하지 않아 values 에 토큰이 아예 없었다 → 인쇄 시 공란.
    const values: Record<string, string> = {};
    expect(values.proc_noncov).toBeUndefined();
    expect(values.exam_noncov).toBeUndefined();
    // 수정본(주입 후)은 명시적으로 채워져야 한다.
    expect(docTokens(null).proc_noncov).toBe('50,000');
  });

  test('3버킷 합 = non_covered(④ 합계) 정합 (표시 전용, 집계 grain 불변)', () => {
    const fb = computeFootBilling(VISIT, null);
    const t = docTokens(null);
    const sum = parse(t.proc_noncov) + parse(t.exam_noncov) + parse(t.etc_noncov);
    expect(sum).toBe(fb.nonCoveredTotal); // 55,000
    expect(sum).toBe(55000);
  });

  test('급여분 미분해(중복표기 방지): covered 항목은 3버킷 어디에도 안 들어감', () => {
    // 급여 29,380(진찰료+KOH)은 진찰료 행 aggregate 유지 → proc/exam/etc 합에서 제외.
    const t = docTokens(null);
    const sum = parse(t.proc_noncov) + parse(t.exam_noncov) + parse(t.etc_noncov);
    expect(sum).toBe(55000); // 급여 29,380 이 새어들어오면 84,380 → 방지
  });

  test('비급여 없음(무파괴): 급여만이면 3토큰 전부 공란', () => {
    const coveredOnly: Item[] = [
      { service: G_CHIN, qty: 1, unitPrice: 18840 },
      { service: G_KOH, qty: 1, unitPrice: 10540 },
    ];
    const fb = computeFootBilling(coveredOnly, null);
    const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-21', {
      insuranceGrade: null, copaymentTotal: fb.copaymentTotal,
    });
    const values: Record<string, string> = {};
    applyBillReceiptNewCategoryTokens(values, billItems);
    expect(values.proc_noncov).toBe('');
    expect(values.exam_noncov).toBe('');
    expect(values.etc_noncov).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 등급고객회귀0 : 등급 있는 고객도 비급여 category 분해 정상(등급과 직교)
//   비급여 category 분해는 급여 등급/본인부담률과 무관 → 등급 유무로 값이 흔들리면 안 됨.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T-20260721 AC3 — 등급 고객 회귀 0', () => {
  test('grade=general 도 처치/검사/기타 분해 동일(null 케이스와 값 일치)', () => {
    const g = docTokens('general');
    const n = docTokens(null);
    expect(g.proc_noncov).toBe(n.proc_noncov);
    expect(g.exam_noncov).toBe(n.exam_noncov);
    expect(g.etc_noncov).toBe(n.etc_noncov);
    expect(g.proc_noncov).toBe('50,000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — DPP회귀0 + 소스 와이어링 가드
//   (단계 A 승격 정합 / PMW 단계 B 호출 / Item ① HOLD 보호)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('T-20260721 소스 와이어링 가드', () => {
  const root = path.resolve(process.cwd(), 'src');
  const dpp = fs.readFileSync(path.join(root, 'components/DocumentPrintPanel.tsx'), 'utf8');
  const pmw = fs.readFileSync(path.join(root, 'components/PaymentMiniWindow.tsx'), 'utf8');
  const lib = fs.readFileSync(path.join(root, 'lib/footBilling.ts'), 'utf8');

  test('단계 A: applyBillReceiptNewCategoryTokens 는 footBilling SSOT 로 승격(export)됨', () => {
    expect(lib).toContain('export function applyBillReceiptNewCategoryTokens');
    // DPP 로컬 정의 제거 확인(중복 정의 없음).
    expect(dpp).not.toMatch(/function applyBillReceiptNewCategoryTokens/);
    // DPP 는 import 로 소비(회귀 0).
    expect(dpp).toContain('applyBillReceiptNewCategoryTokens');
  });

  test('단계 B: PaymentMiniWindow 두 발행 경로 모두 applyBillReceiptNewCategoryTokens 호출', () => {
    const calls = pmw.match(/applyBillReceiptNewCategoryTokens\(autoValues,/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2); // handleDocPrint + 출력+수납
    expect(pmw).toContain("from '@/lib/footBilling'");
  });

  test('Item ① HOLD 보호: DPP 에 unknownGradeCopay 배선이 유입되지 않았다 (canon-gate)', () => {
    // Item ①(공단부담금 값 표시)은 GONGDAN-ROUND-2DOC 트랙 canon-gate HOLD.
    //   본 티켓 범위 밖 → DPP computeFootBilling 콜사이트에 재유입 금지.
    expect(dpp).not.toContain('unknownGradeCopay');
  });
});
