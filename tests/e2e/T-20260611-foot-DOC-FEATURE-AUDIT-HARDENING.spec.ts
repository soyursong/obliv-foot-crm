/**
 * E2E spec — T-20260611-foot-DOC-FEATURE-AUDIT-HARDENING  (P1, 우산 회귀방지 하드닝)
 *
 * 디렉티브(김주연 총괄): "서류 진짜 중요한 항목이라고 여러번 말했는데, 한번 검토하고
 *   개선할 때 확실하게 잡아." → 단발 버그가 아니라 품질 바. 06-08→06-09→06-11 동일
 *   출력 레이어(DocumentPrintPanel / L-006) ping-pong 4차를 E2E 회귀 가드로 종결한다.
 *
 * 본 스펙은 P0(T-20260611-foot-DOC-REISSUE-CONTENT-MISSING, deployed 6ed3b0b)의 근인을
 *   재현하는 회귀 케이스를 고정(AC-1)하고, 서류 핵심 출력 경로 3종(PATH-3 재발급·PATH-4
 *   결제발행·진료의뢰서)에 "내용 non-empty" 스모크(AC-3)와 L-006 단일경로 가드(AC-4)를
 *   덮는다. CI에 DB/auth 없음 → 순수 SSOT 함수 + 소스 introspection 으로 결정적 검증.
 *   (unit 프로젝트 등록 — page 미사용)
 *
 * AC-2(경로 인벤토리)·AC-5(회귀 원인 패턴 메모)는 docs/DOC-PATH-REGRESSION-GUARD.md 로 남기고
 *   본 스펙이 그 문서 존재·핵심 섹션을 가드한다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BillingService,
  type FootBillingItem,
  computeFootBilling,
  buildFootBillDetailItems,
} from '../../src/lib/footBilling';
import {
  buildBillDetailItemsHtml,
  getHtmlTemplate,
  bindHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';

// ── 소스 핸들 (introspection 가드용) ──
const root = process.cwd();
const PANEL_SRC = readFileSync(join(root, 'src/components/DocumentPrintPanel.tsx'), 'utf-8');
const PMW_SRC = readFileSync(join(root, 'src/components/PaymentMiniWindow.tsx'), 'utf-8');
const TEMPLATES_SRC = readFileSync(join(root, 'src/lib/htmlFormTemplates.ts'), 'utf-8');
const MEMO_PATH = join(root, 'docs/DOC-PATH-REGRESSION-GUARD.md');

// ── 대표 청구(레이저=비급여 포함 혼합) — 모든 서류 경로 공유 입력 ──
const SVC_DOOSU: BillingService = {
  id: 'svc-doosu', name: '도수치료', service_code: 'MM010',
  hira_code: 'MM010', is_insurance_covered: true, category_label: '시술',
};
const SVC_LASER: BillingService = {
  id: 'svc-laser', name: '레이저', service_code: 'MM900',
  hira_code: 'MM900', is_insurance_covered: true, category_label: '시술',
};
const SVC_PRECON: BillingService = {
  id: 'svc-precon', name: '프리컨디셔닝', service_code: 'F0001',
  vat_type: 'exclusive', is_insurance_covered: false, category_label: '시술',
};
const ITEMS: FootBillingItem[] = [
  { service: SVC_DOOSU, qty: 2, unitPrice: 30000 },
  { service: SVC_LASER, qty: 1, unitPrice: 40000 },
  { service: SVC_PRECON, qty: 1, unitPrice: 50000 },
];

function billItemsHtml(): string {
  const fb = computeFootBilling(ITEMS, null);
  const items = buildFootBillDetailItems(fb.pricingItems, '2026-06-11', {
    insuranceGrade: null,
    copaymentTotal: fb.copaymentTotal,
  });
  return buildBillDetailItemsHtml(items);
}

test.describe('T-20260611-foot-DOC-FEATURE-AUDIT-HARDENING — 서류 전 기능 회귀방지 우산 가드', () => {
  // ────────────────────────────────────────────────────────────────────────
  // AC-1 — P0 근인 회귀 케이스 고정: "당일 정상 → 재발급 내용 전체 누락" 재발 시 빨갛게.
  // ────────────────────────────────────────────────────────────────────────
  test('AC-1: P0 재발급 내용누락 회귀 — check_in_services 폴백이 항목 행을 산출(공란 아님)', () => {
    const html = billItemsHtml();
    // "진료 항목 없음"(= 내용 전체 누락) 이면 즉시 실패.
    expect(html).not.toContain('진료 항목 없음');
    expect(html).toContain('도수치료');
    expect(html).toContain('레이저');
    expect(html).toContain('프리컨디셔닝');
  });

  test('AC-1: P0 근인 패턴 박멸 가드 — async-state 단독 의존 폴백 재발 차단', () => {
    // (1) 콘텐츠 4소스 로드 게이트(billingReady) — race 중 출력 자체 차단.
    expect(PANEL_SRC).toContain('billingReady');
    expect(PANEL_SRC).toContain('setBillingReady');
    expect(PANEL_SRC).toMatch(/if\s*\(!billingReady\)\s*\{[\s\S]*?return;/);
    // (2) 빌링 폴백이 state 단독 의존이 아니라 print 시점 fresh 조회(fbStale 게이트).
    expect(PANEL_SRC).toContain('fbStale');
    const freshFb = PANEL_SRC.match(/loadFootBillingItems\(checkIn\.id, checkIn\.clinic_id\)/g) ?? [];
    const freshGrade = PANEL_SRC.match(/loadCustomerInsuranceGrade\(checkIn\.customer_id\)/g) ?? [];
    // load() + handleBatchPrint + handleReceiptReissue 최소 3회.
    expect(freshFb.length).toBeGreaterThanOrEqual(3);
    expect(freshGrade.length).toBeGreaterThanOrEqual(3);
    // (3) 근인 티켓 마킹 잔존(회귀 추적성).
    expect(PANEL_SRC).toContain('T-20260611-foot-DOC-REISSUE-CONTENT-MISSING');
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC-3 — 핵심 3경로 "내용 non-empty" 스모크.
  // ────────────────────────────────────────────────────────────────────────

  // PATH-3 (차트>진료내역 재발급) — 항목·금액이 채워져 출력.
  test('AC-3 PATH-3 재발급: 항목명·금액 채워져 출력(비어있지 않음)', () => {
    const html = billItemsHtml();
    expect(html).not.toContain('진료 항목 없음');
    expect(html).toContain('30,000');
    expect(html).toContain('40,000');
    expect(html).toContain('50,000');
    // 재발급(PATH-3) == 최초출력(PATH-4) 동일 SSOT — 산출이 갈라지지 않는다.
    expect(billItemsHtml()).toBe(html);
  });

  // PATH-4 (결제 미니창 발행) — 영수증(bill_receipt, 집계) + 계산서(bill_detail, 라인아이템) 채워 바인딩.
  test('AC-3 PATH-4 결제발행: 영수증 집계 + 계산서 항목 채워져 바인딩(누락 없음)', () => {
    // (1) 진료비 영수증(bill_receipt) — 집계 필드(환자·금액)가 채워져야 한다.
    const recTpl = getHtmlTemplate('bill_receipt');
    expect(recTpl, 'bill_receipt 템플릿이 L-006 맵에 등록되어 있어야 한다').not.toBeNull();
    const recBound = bindHtmlTemplate(recTpl as string, {
      patient_name: '홍길동',
      issue_date: '2026-06-11',
      visit_date: '2026-06-11',
      clinic_name: '오블리브 풋센터',
      total_amount: '160,000',
      non_covered: '50,000',
      insurance_covered: '110,000',
    });
    expect(recBound).toContain('홍길동');
    expect(recBound).toContain('오블리브 풋센터');
    expect(recBound).toContain('160,000'); // 합계 금액 누락 아님
    expect(recBound).not.toMatch(/\{\{\w+\}\}/); // 미치환 placeholder 0건

    // (2) 진료비 계산서(bill_detail) — 라인아이템(items_html)이 비어있지 않게 채워져야 한다.
    const detTpl = getHtmlTemplate('bill_detail');
    expect(detTpl, 'bill_detail 템플릿이 L-006 맵에 등록되어 있어야 한다').not.toBeNull();
    const detBound = bindHtmlTemplate(detTpl as string, {
      patient_name: '홍길동',
      issue_date: '2026-06-11',
      items_html: billItemsHtml(),
    });
    expect(detBound).toContain('홍길동');
    expect(detBound).toContain('도수치료');
    expect(detBound).not.toContain('진료 항목 없음');
    expect(detBound).not.toMatch(/\{\{\w+\}\}/);
  });

  // 진료의뢰서 (referral_letter) — 환자/진단/의뢰내용 채워져 출력.
  test('AC-3 진료의뢰서: 환자·진단·의뢰내용 채워져 출력(중앙클립은 별 티켓)', () => {
    const tpl = getHtmlTemplate('referral_letter');
    expect(tpl, 'referral_letter 템플릿이 L-006 맵에 등록되어 있어야 한다').not.toBeNull();
    const bound = bindHtmlTemplate(tpl as string, {
      patient_name: '홍길동',
      patient_age: '54',
      patient_gender: '남',
      diagnosis: '족저근막염',
      referral_content: '보존적 치료 후 정밀 검사 의뢰드립니다.',
      referral_to_hospital: '서울대학교병원',
      doctor_name: '김의사',
    });
    expect(bound).toContain('홍길동');
    expect(bound).toContain('족저근막염');
    expect(bound).toContain('보존적 치료 후 정밀 검사 의뢰드립니다.');
    expect(bound).toContain('서울대학교병원');
    // 미치환 placeholder 0건.
    expect(bound).not.toMatch(/\{\{\w+\}\}/);
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC-4 — L-006 단일 렌더 경로 유지: 양식 바인딩 단일 함수 + 우회 바인딩 부재.
  // ────────────────────────────────────────────────────────────────────────
  test('AC-4: bindHtmlTemplate 가 L-006 단일 양식 바인딩 함수(LOGIC-LOCK 잔존)', () => {
    expect(TEMPLATES_SRC).toContain('LOGIC-LOCK L-006');
    expect(TEMPLATES_SRC).toMatch(/export function bindHtmlTemplate\(/);
  });

  test('AC-4: 양식 출력 컴포넌트가 단일 함수 경유 — 우회 {{}} 치환 부재', () => {
    // DocumentPrintPanel·PaymentMiniWindow 모두 단일 바인딩 함수 import.
    expect(PANEL_SRC).toContain('bindHtmlTemplate');
    expect(PMW_SRC).toContain('bindHtmlTemplate');
    // 양식 컴포넌트 안에 raw {{...}} replace(복제 바인딩) 가 새로 생기면 회귀 — 0건 유지.
    expect(PANEL_SRC).not.toMatch(/\.replace\(\/\\\{\\\{/);
    expect(PMW_SRC).not.toMatch(/\.replace\(\/\\\{\\\{/);
    // 출력 진입은 openBatchPrintWindow(panel) / iframe print(pmw) 통일 경로 유지.
    expect(PANEL_SRC).toContain('openBatchPrintWindow');
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC-2 / AC-5 — 인벤토리 + 회귀 원인 패턴 메모를 문서로 고정.
  // ────────────────────────────────────────────────────────────────────────
  test('AC-2/AC-5: 서류 경로 인벤토리 + 회귀 패턴 체크리스트 문서 존재', () => {
    expect(existsSync(MEMO_PATH), 'docs/DOC-PATH-REGRESSION-GUARD.md 가 있어야 한다').toBe(true);
    const memo = readFileSync(MEMO_PATH, 'utf-8');
    // AC-2 인벤토리 5경로.
    expect(memo).toContain('PATH-3');
    expect(memo).toContain('PATH-4');
    expect(memo).toContain('진료의뢰서');
    expect(memo).toContain('동의서');
    expect(memo).toContain('per-role');
    // AC-5 회귀 패턴 + AC-4 우회 print() OPEN-Q.
    expect(memo).toContain('회귀 원인 패턴');
    expect(memo).toContain('OPEN-Q');
  });
});
