/**
 * E2E/logic spec — T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE (P1 bugfix)
 *
 * 배경: 통계>매출통계 탭 실장별 매출 표가 두 축으로 발산. ②'상담실장 티켓팅 실적'과 ⑥일간매출 엑셀만
 *   옛 방문축(check_ins.consultant_id)에 남아 ①③④⑤(assigned_staff_id '2번차트 담당자')와 실장 1인당
 *   최대 268만원 차이 + ② 미귀속 매출 음수(-1,582,200) 붕괴.
 *
 * 이번 수정(전부 FE-only, db_change=false):
 *   FIX-3  결제행 페치+귀속+net 집계를 lib/staffRevenue SSOT 1곳으로 수렴(3벌 복제 제거) — DoD #12.
 *   FIX-2A 상태필터를 status NOT IN ('cancelled','deleted')로 통일(구 'deleted'만 제외) — DoD #7.
 *   FIX-1  ② 전용 dual-axis view-model 신설(방문축 건수 KPI ∪ staff축 매출) — DoD #1/#3/#5/#6/#8/#9/#11.
 *   FIX-H  랭킹 카드 모수 라벨 명시 — DoD #13.
 *
 * 검증 = 순수 함수(데이터/로그인 비의존) + 배선 정적 대조. 형제 foot spec 동형(pure-logic in critical-flow → push CI).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  STAFF_UNASSIGNED,
  aggregateStaffNet,
  bucketNet,
  inRoster,
  type AttributedPayment,
  type StaffMeta,
} from '../../../src/lib/staffRevenue';
import {
  buildConsultantDualAxis,
  reconcileConsultantRevenue,
  consultantOverallUnitPrice,
} from '../../../src/lib/consultantSalesExport';
import type { ConsultantRow } from '../../../src/lib/stats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// FIX-3 — SSOT 집계 코어 (aggregateStaffNet / bucketNet): gross·환불·패키지net·결제고객 성분
// ─────────────────────────────────────────────────────────────────────────────
const row = (o: Partial<AttributedPayment>): AttributedPayment => ({
  staffId: 'A',
  customerId: 'c1',
  amount: 0,
  isRefund: false,
  source: 'single',
  accountingDate: '2026-08-03',
  ...o,
});

test('FIX-3: aggregateStaffNet 이 단건gross/단건환불/패키지net/결제고객을 성분 분리한다', () => {
  const rows: AttributedPayment[] = [
    row({ staffId: 'A', customerId: 'c1', amount: 100000, isRefund: false, source: 'single' }),
    row({ staffId: 'A', customerId: 'c1', amount: 30000, isRefund: true, source: 'single' }),
    row({ staffId: 'A', customerId: 'c2', amount: 50000, isRefund: false, source: 'package' }),
    row({ staffId: 'A', customerId: 'c2', amount: 20000, isRefund: true, source: 'package' }),
    row({ staffId: STAFF_UNASSIGNED, customerId: null, amount: 40000, isRefund: false, source: 'single' }),
  ];
  const buckets = aggregateStaffNet(rows);
  const a = buckets.get('A')!;
  expect(a.singleGross).toBe(100000);
  expect(a.singleRefund).toBe(30000);
  expect(a.pkgNet).toBe(30000); // 50000 − 20000
  // 매출집계>담당실장별(③): 누적(gross)=단건gross+패키지net · 환불금=단건환불 · 총=net.
  expect(a.singleGross + a.pkgNet).toBe(130000); // 누적매출(gross)
  expect(bucketNet(a)).toBe(100000);             // 총매출(net) = 130000 − 30000
  expect(a.customers.size).toBe(2);              // c1, c2 (distinct 결제고객, 환불행 포함)

  // 워크인(customer_id NULL) = STAFF_UNASSIGNED 버킷, 결제고객 0.
  const u = buckets.get(STAFF_UNASSIGNED)!;
  expect(bucketNet(u)).toBe(40000);
  expect(u.customers.size).toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX-3 — 로스터 정책(=인자): 산식 불변, 모수만 인자로 좁힌다(DoD #12)
// ─────────────────────────────────────────────────────────────────────────────
test('FIX-3: inRoster 정책이 all/consultant-all/consultant-active 를 정확히 분기한다', () => {
  const consultant: StaffMeta = { id: 'A', name: '김실장', role: 'consultant', active: true };
  const retired: StaffMeta = { id: 'B', name: '이실장', role: 'consultant', active: false };
  const desk: StaffMeta = { id: 'C', name: '데스크', role: 'coordinator', active: true };

  // 'all' (①③⑤): 미지정 포함 전 버킷.
  expect(inRoster('A', consultant, 'all')).toBe(true);
  expect(inRoster(STAFF_UNASSIGNED, undefined, 'all')).toBe(true);
  expect(inRoster('C', desk, 'all')).toBe(true);

  // 'consultant-active' (④ 랭킹): 재직 상담실장만. 미지정/비상담직/퇴사 제외.
  expect(inRoster('A', consultant, 'consultant-active')).toBe(true);
  expect(inRoster('B', retired, 'consultant-active')).toBe(false);   // 퇴사 제외
  expect(inRoster('C', desk, 'consultant-active')).toBe(false);      // 비상담직 제외
  expect(inRoster(STAFF_UNASSIGNED, undefined, 'consultant-active')).toBe(false); // 미지정 제외

  // 'consultant-all': 퇴사 포함 상담실장. 비상담직/미지정 제외.
  expect(inRoster('B', retired, 'consultant-all')).toBe(true);
  expect(inRoster('C', desk, 'consultant-all')).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX-1 — dual-axis view-model union (방문축 건수 KPI ∪ staff축 매출) — DoD #5/#8
// ─────────────────────────────────────────────────────────────────────────────
const cr = (o: Partial<ConsultantRow>): ConsultantRow => ({
  consultant_id: 'A',
  name: '',
  ticketing_count: 0,
  package_count: 0,
  avg_amount: null,
  ...o,
});

test('FIX-1: buildConsultantDualAxis 가 두 축을 staff.id 로 union(한 축에만 있는 실장도 행 보존)', () => {
  const visit: ConsultantRow[] = [
    cr({ consultant_id: 'A', name: '김실장', ticketing_count: 10, package_count: 4 }),
    cr({ consultant_id: 'B', name: '이실장', ticketing_count: 5, package_count: 1 }), // 방문만
  ];
  const staffRev: ConsultantRow[] = [
    cr({ consultant_id: 'A', name: '김실장', total_amount: 1_000_000, consulted_customer_count: 8, avg_amount: 125000 }),
    cr({ consultant_id: 'C', name: '박실장', total_amount: 500_000, consulted_customer_count: 4, avg_amount: 125000 }), // 매출만
  ];
  const dual = buildConsultantDualAxis(visit, staffRev);
  const byId = new Map(dual.map((r) => [r.staffId, r]));

  // A = 두 축 모두. 티켓팅=방문축, 매출/결제고객/객단가=staff축.
  const a = byId.get('A')!;
  expect(a.ticketingCount).toBe(10);
  expect(a.conversionRate).toBeCloseTo(40, 5); // 4/10
  expect(a.revenue).toBe(1_000_000);
  expect(a.payingCustomers).toBe(8);
  expect(a.avgAmount).toBe(125000);
  expect(a.hasVisit && a.hasRevenue).toBe(true);

  // B = 방문만 → staff축 매출 0 / 객단가 null (DoD #8: 행 보존, union 누락 0).
  const b = byId.get('B')!;
  expect(b.ticketingCount).toBe(5);
  expect(b.revenue).toBe(0);
  expect(b.payingCustomers).toBe(0);
  expect(b.avgAmount).toBeNull();
  expect(b.hasRevenue).toBe(false);

  // C = 매출만(방문 없음) → 티켓팅 0 / 전환율 0. 행 존재(DoD #8).
  const c = byId.get('C')!;
  expect(c.ticketingCount).toBe(0);
  expect(c.conversionRate).toBe(0);
  expect(c.revenue).toBe(500_000);
  expect(c.hasVisit).toBe(false);

  // 객단가 분자·분모 동일 축(staff축): revenue/payingCustomers (DoD #5).
  expect(a.avgAmount).toBe(consultantOverallUnitPrice(a.revenue, a.payingCustomers));
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX-1-D — 미귀속 대사: 실적합(staff축) + 미귀속 = 총매출(순), 음수 소멸 — DoD #6
// ─────────────────────────────────────────────────────────────────────────────
test('FIX-1-D: reconcileConsultantRevenue 항등 성립 + 미귀속 ≥ 0(음수 소멸)', () => {
  const dual = buildConsultantDualAxis(
    [cr({ consultant_id: 'A', name: '김실장', ticketing_count: 10, package_count: 4 })],
    [
      cr({ consultant_id: 'A', name: '김실장', total_amount: 1_000_000, consulted_customer_count: 8, avg_amount: 125000 }),
      cr({ consultant_id: 'C', name: '박실장', total_amount: 500_000, consulted_customer_count: 4, avg_amount: 125000 }),
    ],
  );
  // 총매출(순)=2,000,000 (미지정/비상담직/워크인 = 500,000 잔여).
  const recon = reconcileConsultantRevenue(dual, 2_000_000);
  expect(recon.attributed).toBe(1_500_000);            // Σ staff축 net
  expect(recon.unattributed).toBe(500_000);            // 총 − 실적합
  expect(recon.attributed + recon.unattributed).toBe(recon.total); // 항등
  expect(recon.unattributed).toBeGreaterThanOrEqual(0); // 음수 소멸(구 버그 -1,582,200 재발 방지)
});

test('FIX-1: consultantOverallUnitPrice 결제고객 0 → null(빈칸)', () => {
  expect(consultantOverallUnitPrice(1_000_000, 8)).toBe(125000);
  expect(consultantOverallUnitPrice(1_000_000, 0)).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// 배선 정적 대조 — 산식 SSOT 통합(FIX-3) · 상태필터(FIX-2A) · 역산 제거(FIX-1-E) · 헤더(FIX-1-C) · 랭킹라벨(FIX-H)
// ─────────────────────────────────────────────────────────────────────────────
const SSOT = 'src/lib/staffRevenue.ts';
const STATS = 'src/lib/stats.ts';
const MTM = 'src/lib/mtmSales.ts';
const DOCTAB = 'src/components/sales/SalesDoctorTab.tsx';
const EXPORT = 'src/lib/consultantSalesExport.ts';
const SECTION = 'src/components/stats/ConsultantSection.tsx';
const ASSIGN = 'src/pages/Assignments.tsx';

test('FIX-2A: SSOT 가 status NOT IN (cancelled,deleted) 로 통일(구 deleted-only 교체)', () => {
  const s = read(SSOT);
  expect(s).toMatch(/\.not\(\s*'status',\s*'in',\s*'\(cancelled,deleted\)'\s*\)/);
});

test('FIX-3: ①③④ 세 소비자가 모두 lib/staffRevenue SSOT(fetchAttributedPayments)를 경유(복제 0)', () => {
  for (const f of [STATS, MTM, DOCTAB]) {
    expect(read(f)).toContain('fetchAttributedPayments');
  }
  // 구 인라인 2-소스 net 집계(assigned_staff_id 직접 join+루프)는 세 소비자에서 제거됨:
  //   더 이상 payments 를 직접 accounting_date 로 select 하지 않는다(SSOT 경유).
  expect(read(DOCTAB)).not.toContain("from('payments')");
  expect(read(STATS)).not.toContain("'status', 'eq', 'deleted'"); // ④ 구 필터 제거
});

test('FIX-1-E: consultantRevenue 역산 fallback(avg×ticketing) 제거 — DoD #11', () => {
  const e = read(EXPORT);
  expect(e).not.toMatch(/avg_amount\s*\?\?\s*0\)\s*\*\s*r\.ticketing_count/);
  // ⑥ 엑셀·② 화면이 동일 dual-axis view-model 소비.
  expect(e).toContain('ConsultantDualAxisRow');
  expect(e).toContain('buildConsultantDualAxis');
});

test('FIX-1-C: ② 헤더 [상담고객] → [결제고객](실제 분모명칭) — DoD #9', () => {
  const s = read(SECTION);
  expect(s).toContain('결제고객');
  expect(s).toContain('ConsultantDualAxisRow');
  // dual-axis 안내 문구 노출.
  expect(s).toContain('consultant-dualaxis-note');
});

test('FIX-H: 랭킹 카드 모수 라벨 "재직 상담실장만 · 미지정/비상담직 제외" 명시 — DoD #13', () => {
  expect(read(ASSIGN)).toContain('재직 상담실장만 · 미지정/비상담직 제외');
});
