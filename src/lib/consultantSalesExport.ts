/**
 * T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE
 * 통계 > 매출통계 탭 "일간매출보고" 다운로드 유틸리티.
 *
 * 배경: 매출집계(Sales.tsx) 의 raw 25컬럼 다운로드(salesExport.downloadSalesExcel)와
 *       양식이 다르다(실장별 요약). 또한 AGG 다운로드 경로(fetchSalesRawRows)의
 *       버그 전파를 막기 위해 데이터 소스(foot_stats_consultant RPC)·코드 경로를
 *       완전히 분리한다. (의존 티켓: T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR)
 *
 * 양식(리포터 김주연 운영총괄 확정): 실장별 {매출, 상담건수, 상담객단가} + 총 일간 매출액.
 *   합계행에 총 매출액·총 상담건수·전체 객단가.
 *
 * T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM: 상담객단가 분모를 상담'건수'(ticketing_count)
 *   → distinct 상담(내원)고객수(consulted_customer_count) 로 통일. 화면 배포본(실장별 실적) 객단가와
 *   1-byte 동일 기준. 재집계 금지 — RPC(foot_stats_consultant) canonical 을 그대로 소비:
 *     · 실장별 객단가 = RPC avg_amount (= ROUND(total_amount / NULLIF(consulted_customer_count,0)))
 *       를 그대로 표시(FE 재계산 X). 화면이 표시하는 값과 완전 동일. 분모=0 → RPC NULL → 빈칸.
 *     · 합계 객단가 = Σ매출 / Σconsulted_customer_count (전체 상담고객 분모, 반올림). 분모=0 → 빈칸.
 *   ※ '상담건수' 컬럼은 기존대로 ticketing_count(방문횟수) 표시 — 컬럼구조·헤더 불변, 객단가 값만 재정의.
 *   ※ 분자(매출)=RPC total_amount(net·accounting_date), 화면 canonical 과 동일소스(무변경).
 * 라이브러리: xlsx (devDependencies, Vite 번들 포함 — 신규 의존성 0).
 */

import * as XLSX from 'xlsx';
import type { ConsultantRow } from '@/lib/stats';

/**
 * 실장별 매출액 = staff축(customers.assigned_staff_id) net 매출(total_amount).
 * T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE (FIX-1-E, DoD #11):
 *   구 `avg_amount × ticketing_count` 역산 fallback 제거. avg_amount 분모가 상담'건수'→'고객수'로
 *   재정의된 뒤 역산식은 이미 무효(dead-path)였고, 현재 매출은 staff축 net(total_amount)에서만
 *   읽는다(방문축 avg_amount 와 무관). total_amount 미반환 시 0(집계 대상 아님).
 */
export function consultantRevenue(r: Pick<ConsultantRow, 'total_amount'>): number {
  return r.total_amount ?? 0;
}

/**
 * 합계행 전체 객단가: Σ매출 ÷ Σ상담고객수 (반올림). 상담고객 0 → null(빈칸).
 * T-20260718: 화면 객단가와 동일하게 분모=상담(내원)고객수(consulted_customer_count) 로 통일.
 *   실장별 행은 RPC avg_amount 를 직접 소비(재계산 X)하므로, 이 함수는 합계행 전용.
 */
export function consultantOverallUnitPrice(totalRevenue: number, totalCustomers: number): number | null {
  return totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE (FIX-1) — '상담실장 티켓팅 실적' dual-axis view-model
//
// 문제(현장): ② '상담실장 티켓팅 실적'의 [총매출액]·[객단가]가 옛 방문축(check_ins.consultant_id,
//   foot_stats_consultant RPC total_amount)에 남아 ① '실장별 일별 매출'(assigned_staff_id)과
//   실장 1인당 최대 268만원 발산. 미귀속 대사도 음수(-1,582,200)로 붕괴.
//
// 해법: '두 열 교체'가 아니라 ② 전용 view-model 을 신설해 두 축을 명시적으로 union 한다.
//   · 방문축(무접촉): [티켓팅건수]·[패키지전환율] = foot_stats_consultant RPC (건수 KPI 정본).
//   · staff축(교정):  [총매출액]·[결제고객]·[객단가] = customers.assigned_staff_id net 매출
//        (fetchConsultantPerfByAssignedStaff, ①③④⑤ 와 동일 SSOT 축 = 담당실장 net).
//   · union: 어느 한 축에만 존재하는 실장도 행 보존(행 universe 누락 0, DoD #8).
//        - 방문 있으나 staff축 매출 0 → revenue 0 / avg null.
//        - staff축 매출 있으나 방문 없음 → ticketing 0 / conversion 0.
//   객단가 분모 = 결제고객(staff축 distinct 결제고객) — 분자(net)와 동일 축(DoD #5).
// ─────────────────────────────────────────────────────────────────────────
export interface ConsultantDualAxisRow {
  /** staff.id (방문축 consultant_id == staff축 assigned_staff_id, 동일 staff 식별자). */
  staffId: string;
  name: string;
  // ── 방문축 (foot_stats_consultant RPC — 건수 KPI, 무접촉) ──
  /** 티켓팅 건수(방문/상담 건수). */
  ticketingCount: number;
  /** 패키지 결제 전환 건수. */
  packageCount: number;
  /** 패키지 전환율(%) = package/ticketing. ticketing=0 → 0. */
  conversionRate: number;
  // ── staff축 (customers.assigned_staff_id net — ①③④⑤ 동일 SSOT) ──
  /** 총매출액 = staff축 net(환불 차감). */
  revenue: number;
  /** 결제고객 수 = staff축 distinct 결제고객(객단가 분모). */
  payingCustomers: number;
  /** 객단가 = net / 결제고객 (staff축, 분자·분모 동일 축). 결제고객 0 → null('-'). */
  avgAmount: number | null;
  // ── provenance(어느 축에서 유래했는지 — union 누락 방어/디버그) ──
  hasVisit: boolean;
  hasRevenue: boolean;
}

/**
 * ② dual-axis view-model 빌더. 방문축 RPC 행 + staff축 매출 행을 staff.id 로 union.
 * ⑥ 일간매출보고 엑셀(downloadConsultantSalesReport)과 ② 화면(ConsultantSection)이 이 동일 view-model 을
 * 소비해 두 표면이 항상 같은 숫자를 보이도록 한다(DoD #3).
 *
 * @param visitRows 방문축 = fetchConsultantPerf (foot_stats_consultant RPC, 재직 상담실장 read-side 필터 적용됨)
 * @param staffRevRows staff축 = fetchConsultantPerfByAssignedStaff (assigned_staff_id net, consultant-active 로스터)
 */
export function buildConsultantDualAxis(
  visitRows: ConsultantRow[],
  staffRevRows: ConsultantRow[],
): ConsultantDualAxisRow[] {
  const byId = new Map<string, ConsultantDualAxisRow>();
  const ensure = (staffId: string, name: string): ConsultantDualAxisRow => {
    let row = byId.get(staffId);
    if (!row) {
      row = {
        staffId,
        name: name || '미지정',
        ticketingCount: 0,
        packageCount: 0,
        conversionRate: 0,
        revenue: 0,
        payingCustomers: 0,
        avgAmount: null,
        hasVisit: false,
        hasRevenue: false,
      };
      byId.set(staffId, row);
    }
    return row;
  };

  // 방문축(건수 KPI) — 무접촉 소비.
  for (const v of visitRows) {
    const row = ensure(v.consultant_id, v.name);
    row.ticketingCount = v.ticketing_count;
    row.packageCount = v.package_count;
    row.conversionRate = v.ticketing_count > 0 ? (v.package_count / v.ticketing_count) * 100 : 0;
    row.hasVisit = true;
    if (v.name && (row.name === '미지정')) row.name = v.name;
  }

  // staff축(매출) — [총매출액]·[결제고객]·[객단가] 교정 소스.
  for (const s of staffRevRows) {
    const row = ensure(s.consultant_id, s.name);
    row.revenue = s.total_amount ?? 0;
    row.payingCustomers = s.consulted_customer_count ?? 0;
    row.avgAmount = s.avg_amount ?? null;
    row.hasRevenue = true;
    if (s.name) row.name = s.name; // staff축 이름을 canonical 로(방문축 라벨이 미지정일 수 있음)
  }

  return [...byId.values()];
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260723-foot-CONSULTANT-TKTREV-LABEL-RECONCILE — 일마감 대사 표시(표시계층 only)
//
// 부모 RCA(T-20260723-foot-CONSULTANT-TKTREV-DAYCLOSE-RECONCILE, done) 결론:
//   '상담실장 티켓팅 실적'(View B / foot_stats_consultant) = 상담실장에게 귀속된 매출만
//   집계(BINDING-3). 일마감(전체 결제)과의 차액 Δ = 미귀속분(상담이력 없는 결제 + 비상담직군).
//   수학적으로 View B ⊂ 전체결제 → 두 값이 같아지는 건 by-design 상 불가(회귀·버그 아님).
//
// 본 헬퍼는 그 by-design 차이를 화면에서 "대사 가능"하게 만드는 순수 표시 파생이다:
//   실적합(attributed) = Σ staff축 net(dual-axis row.revenue)    ← ①③④⑤ 동일 SSOT 축(재직 상담실장)
//   미귀속(unattributed) = 총매출(순) − 실적합                    ← 미지정·워크인·비상담직·퇴사실장 잔여
//   ∴ attributed + unattributed ≡ total (항등, 반올림 오차 없이 성립)
//
// ★ T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE (FIX-1-D, DoD #6):
//   구 attributed = Σ 방문축 total_amount(check_ins.consultant_id) 라 총매출(assigned_staff_id 축)과
//   축이 달라 미귀속이 음수(-1,582,200)로 붕괴했다. attributed 를 staff축 net(dual-axis) 로 바꾸면
//   실적합 ⊂ 총매출(순) 이 성립 → 미귀속 ≥ 0(음수 소멸). 차액 = 미지정+워크인+비상담직+퇴사 상담실장.
//
// ⚠ 순수 read-only. 집계 산식·RPC·DB 무접촉. totalNetRevenue = 매출통계 '총 매출(순)'
//   (= pkg+single−refund, net·accounting_date)로 staff축 net 과 동일 축이라 차감이 유효하다.
//   unattributed 를 clamp 하지 않는다 — 항등(실적합+미귀속=총매출)이 화면에서 정확히 성립해야 함.
// ─────────────────────────────────────────────────────────────────────────
export interface ConsultantRevenueReconciliation {
  attributed: number;    // 상담실장(staff축) 귀속 매출 합계(실적합)
  unattributed: number;  // 미귀속 매출 (총매출 − 실적합). staff축 subset 이라 ≥ 0.
  total: number;         // 총 매출(순) = 일마감 전체 결제 대사 기준
}

export function reconcileConsultantRevenue(
  rows: Pick<ConsultantDualAxisRow, 'revenue'>[],
  totalNetRevenue: number,
): ConsultantRevenueReconciliation {
  const attributed = rows.reduce((s, r) => s + r.revenue, 0);
  return {
    attributed,
    unattributed: totalNetRevenue - attributed,
    total: totalNetRevenue,
  };
}

const REPORT_HEADERS = ['실장명', '매출', '상담건수', '상담객단가'] as const;

/**
 * 매출통계 탭 일간매출보고 xlsx 다운로드.
 * T-20260810-foot-CONSULTANT-REVENUE-AXIS-RECONCILE (FIX-1-E, DoD #3):
 *   ② 화면과 '같은' dual-axis view-model 을 소비 → 엑셀 [매출] == ② [총매출액](staff축) 항상 일치.
 * @param rows ConsultantDualAxisRow[] (Stats 화면이 build 한 dual-axis 실장별 실적)
 * @param from 기간 시작 (YYYY-MM-DD)
 * @param to   기간 종료 (YYYY-MM-DD)
 */
export function downloadConsultantSalesReport(
  rows: ConsultantDualAxisRow[],
  from: string,
  to: string,
): void {
  // 매출 내림차순 (보고서 가독성).
  //   revenue(매출)  = staff축 net(② [총매출액]와 동일)         · count(상담건수) = 방문축 ticketing(무접촉)
  //   customers(합계 분모) = staff축 결제고객(payingCustomers)   · unit(객단가) = staff축 avgAmount(net/결제고객)
  const ordered = [...rows]
    .map((r) => ({
      name: r.name,
      revenue: r.revenue,
      count: r.ticketingCount,
      customers: r.payingCustomers,
      unit: r.avgAmount, // number | null (결제고객 0 → NULL)
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = ordered.reduce((s, r) => s + r.revenue, 0);
  const totalCount = ordered.reduce((s, r) => s + r.count, 0);
  const totalCustomers = ordered.reduce((s, r) => s + r.customers, 0);
  const overallUnit = consultantOverallUnitPrice(totalRevenue, totalCustomers);

  // 객단가 NULL(상담고객 0) → 빈 문자열 셀(빈칸). 화면 '-' 와 동일 의미.
  const cell = (v: number | null): string | number => (v == null ? '' : v);

  const aoa: (string | number)[][] = [
    [REPORT_HEADERS as unknown as string].flat(),
    ...ordered.map((r) => [r.name, r.revenue, r.count, cell(r.unit)]),
    ['합계', totalRevenue, totalCount, cell(overallUnit)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 금액·건수 컬럼 숫자 형식 (B=매출, C=상담건수, D=객단가 → col 1,2,3).
  // 객단가 빈칸('')은 숫자 셀이 아니므로 서식 미적용(typeof number 가드).
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let R = 1; R <= range.e.r; R++) {
    for (const C of [1, 2, 3]) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr] && typeof ws[addr].v === 'number') {
        ws[addr].t = 'n';
        ws[addr].z = '#,##0';
      }
    }
  }

  ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '일간매출보고');

  const fname = `일간매출보고_실장별_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}`;
  XLSX.writeFile(wb, `${fname}.xlsx`);
}
