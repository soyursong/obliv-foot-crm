/**
 * T-20260515-foot-SALES-TAB-STAFF
 * 매출집계 탭5 — 담당치료사별 정산 (구 담당직원별, T-20260605 표기 정비)
 *
 * AC-1: check_ins.therapist_id / technician_id 기준 그룹
 * AC-2: 시술 건수 + 실적 금액 + 환불 차감액
 * AC-3: 소급 방지 환불 차감 엔진 — 당월(accounting_date) 마이너스 표출
 * AC-4: 글로벌 필터(기간·검색) + 엑셀 — Sales.tsx 공통 레이어 사용
 * T-20260522-foot-DESIGNATED-THERAPIST AC-4: 치료사별 지정환자수 컬럼
 *
 * T-20260605-foot-SALES-STAFF-DEDUCT-BASIS — 귀속 기준 전환
 *   기존(수납기준): payments → check_ins.therapist/technician, accounting_date.
 *   신규(차감기준): package_sessions(status='used') → performed_by(차감 치료사),
 *                   unit_price 스냅샷 합, session_date 기준.
 *   두 기준을 토글로 공존(별도 신규 view, 기존 payments 비파괴 / AC-2).
 *   field 결정값은 아래 DEDUCT_* 상수로 토글(AC-3/4/5). DECISION-REQUEST 회신 후 반영.
 *
 * T-20260724-foot-COSMETIC-SELLER-ATTRIB (A-3) — 화장품(풋화장품) 매출 별도 컬럼(A안, 합산 X).
 *   버킷 = COALESCE(check_in_services.seller_staff_id, check_ins.therapist_id). NULL='미상' 집계제외.
 *   double-count single-attribution 불변식: 화장품 라인은 실장의 치료 매출 컬럼에 얹지 않는다
 *   (수납기준은 담당 therapist 귀속분을 치료 매출에서 차감, 차감기준은 package_sessions 가 화장품 미포함).
 *
 * READ-ONLY. DB 변경 없음(집계 조회만).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  getSimulationCustomerIds,
  excludeSimulationPaymentRows,
} from '@/lib/simulationFilter';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount, chartNoBadge } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useChart } from '@/lib/chartContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';

interface Props {
  filter: SalesFilterState;
}

// ── T-20260605 field 결정 기본값 (DECISION-REQUEST 회신 시 변경) ───────────────
// AC-3 금액기준: 'snapshot'(권장·불변 = package_sessions.unit_price)
//              | 'current'(packages.{type}_unit_price 현재 설정값)
const DEDUCT_AMOUNT_BASIS: 'snapshot' | 'current' = 'snapshot';
// AC-4 추가금(surcharge) 포함 여부 — 기본 미포함
const DEDUCT_INCLUDE_SURCHARGE = false;
// AC-4 환불/취소 세션은 쿼리에서 status='used'만 조회 → 자동 제외 (기본)
// AC-5 소급: session_date 범위 기반이라 performed_by 기록된 과거 차감건 자연 포함 (기본 true)

type StaffBasis = 'payment' | 'deduction';

// ── 수납기준(기존) 타입 ────────────────────────────────────────────────────────
interface StaffPayRow {
  id: string;
  amount: number;
  payment_type: string | null;
  accounting_date: string | null;
  parent_payment_id: string | null;
  /** 매출 방어필터용 — T-20260709-foot-SALES-SIMULATION-FILTER-DEFENSE */
  customer_id: string | null;
  check_ins: {
    therapist: { id: string; name: string } | null;
    technician: { id: string; name: string } | null;
  } | null;
}

interface StaffStat {
  staffId: string;
  staffName: string;
  role: 'therapist' | 'technician';
  count: number;
  revenue: number;
  refundAmount: number;
  /** T-20260522-foot-DESIGNATED-THERAPIST AC-4: 지정환자수 */
  designatedCount: number;
}

// ── T-20260725-foot-THERAPIST-DESIGNATED-CUSTLIST-DRILLDOWN ──────────────────────
//   '지정 수' 클릭 시 나열할 지정 고객 1인 정보. 명단·카운트를 동일 소스(1쿼리)에서
//   파생하므로 AC2(명단 인원 == 지정 수) 정합이 구조적으로 보장된다.
interface DesignatedCustomer {
  id: string;
  name: string;
  chart_number: string | null;
  designated_therapist_id: string | null;
}

// ── 차감기준(신규) 타입 ────────────────────────────────────────────────────────
interface DeductSessionRow {
  id: string;
  unit_price: number | null;
  surcharge: number | null;
  session_date: string | null;
  status: string | null;
  session_type: string | null;
  performed_by: string | null;
  packages: {
    clinic_id: string;
    heated_unit_price: number | null;
    unheated_unit_price: number | null;
    iv_unit_price: number | null;
    podologe_unit_price: number | null;
    trial_unit_price: number | null;
    reborn_unit_price: number | null;
  } | null;
  performer: { id: string; name: string } | null;
}

interface DeductStat {
  staffId: string;
  staffName: string;
  count: number;
  revenue: number;
  designatedCount: number;
}

// ── T-20260724-foot-COSMETIC-SELLER-ATTRIB (A-3): 화장품(풋화장품) 매출 별도 컬럼 ─────────────
//   check_in_services 화장품 라인 + check_ins 귀속(therapist_id·일자·고객)을 조인.
//   버킷 = COALESCE(seller_staff_id, check_ins.therapist_id). NULL='미상' 집계제외(백필 금지 원칙).
interface CosmeticLineRow {
  price: number | null;
  seller_staff_id: string | null;
  service_id: string | null;
  /** 판매 시점 스냅샷 제품명 (T-20260731 드릴다운 팝업 표시용) */
  service_name: string | null;
  check_ins: {
    therapist_id: string | null;
    clinic_id: string | null;
    checked_in_at: string | null;
    customer_id: string | null;
    /** T-20260731 드릴다운: 고객성함·차트번호 표시(기존 담당치료사별 화면 권한 범위 내) */
    customers: { name: string | null; chart_number: string | null } | null;
  } | null;
}

interface CosmeticStat {
  amount: number;
  count: number;
}

// ── T-20260731-foot-COSMETIC-SALES-DETAIL-POPUP: 화장품 매출 칸 클릭 → 판매내역 드릴다운 ──
//   팝업 행은 집계(cosmeticBySeller)와 **동일한 cosmeticLines 배열·동일 버킷 로직**에서 파생한다.
//   → Σ(팝업 행 금액) === 칸 표시금액(AC3 불변식)이 구조적으로 보장됨(별도 쿼리 신설 금지).
interface CosmeticDetailRow {
  key: string;
  customerName: string;
  chartNumber: string | null;
  productName: string;
  amount: number;
  /** 판매일자 (KST, YYYY-MM-DD) — 현장 대조 편의 */
  saleDate: string | null;
}

/** 치료 매출 + 화장품 매출을 병기하는 행 (별도 컬럼 A안, 합산 X). */
type PayRowWithCosmetic = StaffStat & { treatmentRevenue: number; cosmeticRevenue: number };
type DeductRowWithCosmetic = DeductStat & { cosmeticRevenue: number };

/** session_type → packages 현재 단가 컬럼 (AC-3 'current' 기준 / preconditioning은 스냅샷 fallback) */
function currentUnitPrice(row: DeductSessionRow): number {
  const pkg = row.packages;
  const snap = row.unit_price ?? 0;
  if (!pkg) return snap;
  switch (row.session_type) {
    case 'heated_laser':
      return pkg.heated_unit_price ?? snap;
    case 'unheated_laser':
      return pkg.unheated_unit_price ?? snap;
    case 'iv':
      return pkg.iv_unit_price ?? snap;
    case 'podologue':
    case 'podologe':
      return pkg.podologe_unit_price ?? snap;
    case 'trial':
      return pkg.trial_unit_price ?? snap;
    case 'reborn':
      return pkg.reborn_unit_price ?? snap;
    // preconditioning 등 대응 컬럼 없는 타입은 스냅샷 fallback
    default:
      return snap;
  }
}

export function SalesStaffTab({ filter }: Props) {
  const clinic = useClinic();
  const { from, to } = filter.dateRange;
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  // T-20260605: 귀속 기준 토글 (기본 = 차감기준 = 총괄 요청 표시값)
  const [basis, setBasis] = useState<StaffBasis>('deduction');

  // T-20260725-foot-THERAPIST-DESIGNATED-CUSTLIST-DRILLDOWN:
  //   '지정 수' 클릭 → 지정 고객 명단 팝업(Dialog). 명단 고객 클릭 → 2번차트 이동.
  //   2번차트 라우팅은 기존 자산(useChart().openChart) 재사용 — 신규 라우팅 신설 금지(AC3).
  const { openChart } = useChart();
  const [designatedDialog, setDesignatedDialog] = useState<{
    staffId: string;
    staffName: string;
  } | null>(null);

  // T-20260731-foot-COSMETIC-SALES-DETAIL-POPUP: 화장품 매출 칸 클릭 → 판매내역 드릴다운 팝업.
  const [cosmeticDialog, setCosmeticDialog] = useState<{
    staffId: string;
    staffName: string;
  } | null>(null);

  // accounting_date 기준 조회 — 소급 방지의 핵심 (AC-3) / 수납기준
  const { data: payments = [], isLoading: payLoading } = useQuery<StaffPayRow[]>({
    queryKey: ['sales-staff', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, amount, payment_type, accounting_date, parent_payment_id, customer_id,
          check_ins(
            therapist:staff!check_ins_therapist_id_fkey(id, name),
            technician:staff!check_ins_technician_id_fkey(id, name)
          )
        `)
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to);
      if (error) throw error;
      // 방어필터: is_simulation=true 고객 결제 제외 (워크인 NULL 보존)
      const simIds = await getSimulationCustomerIds(clinic!.id);
      return excludeSimulationPaymentRows(
        data as unknown as StaffPayRow[],
        simIds,
      );
    },
  });

  // T-20260605 차감기준 조회 — package_sessions(status='used') → performed_by, session_date
  const { data: deductSessions = [], isLoading: deductLoading } = useQuery<DeductSessionRow[]>({
    queryKey: ['sales-staff-deduct', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('package_sessions')
        .select(`
          id, unit_price, surcharge, session_date, status, session_type, performed_by,
          packages!inner(
            clinic_id,
            heated_unit_price, unheated_unit_price, iv_unit_price,
            podologe_unit_price, trial_unit_price, reborn_unit_price
          ),
          performer:staff!performed_by(id, name)
        `)
        .eq('packages.clinic_id', clinic!.id)
        .eq('status', 'used')          // AC-4: cancelled/refunded 제외
        .not('performed_by', 'is', null)
        .gte('session_date', from)     // AC-1: session_date(차감일) 기준
        .lte('session_date', to);
      if (error) throw error;
      return data as unknown as DeductSessionRow[];
    },
  });

  // T-20260522-foot-DESIGNATED-THERAPIST AC-4: 치료사별 지정환자수 (원본 명단)
  // T-20260725-foot-THERAPIST-DESIGNATED-CUSTLIST-DRILLDOWN: 카운트뿐 아니라 지정 고객
  //   명단(id/name/chart_number)까지 동일 쿼리로 가져와, '지정 수' 클릭 → 명단 drill-down의
  //   단일 소스로 삼는다. 카운트-명단 정합(AC2)이 파생 시점에서 구조적으로 보장됨.
  const { data: designatedCustomers = [] } = useQuery<DesignatedCustomer[]>({
    queryKey: ['sales-staff-designated', clinic?.id],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, chart_number, designated_therapist_id')
        .eq('clinic_id', clinic!.id)
        .not('designated_therapist_id', 'is', null);
      if (error) throw error;
      return (data ?? []) as DesignatedCustomer[];
    },
  });

  // 치료사 id → 지정 고객 명단. 명단은 이름 오름차순.
  const designatedListByTherapist = useMemo<Map<string, DesignatedCustomer[]>>(() => {
    const m = new Map<string, DesignatedCustomer[]>();
    for (const c of designatedCustomers) {
      if (!c.designated_therapist_id) continue;
      const arr = m.get(c.designated_therapist_id) ?? [];
      arr.push(c);
      m.set(c.designated_therapist_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ko'));
    }
    return m;
  }, [designatedCustomers]);

  // 카운트 맵은 명단 length 에서 파생 (기존 designatedMap 소비부 호환 유지).
  const designatedMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const [k, arr] of designatedListByTherapist) map[k] = arr.length;
    return map;
  }, [designatedListByTherapist]);

  // ── T-20260724-foot-COSMETIC-SELLER-ATTRIB (A-3): staff id→name (화장품 seller 표시명) ──
  const { data: staffNames = {} } = useQuery<Record<string, string>>({
    queryKey: ['sales-staff-names', clinic?.id],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, name')
        .eq('clinic_id', clinic!.id);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const s of (data ?? []) as { id: string; name: string }[]) map[s.id] = s.name;
      return map;
    },
  });

  // ── T-20260724-foot-COSMETIC-SELLER-ATTRIB (A-3): 화장품(풋화장품) 라인 조회 ──
  //   1) clinic 의 화장품 service_id 집합 → 2) 그 라인 + check_ins 귀속을 조인.
  //   기간 필터 = check_ins.checked_in_at(KST 바운드). sim 고객 결제 제외(표시매출 방어).
  const { data: cosmeticLines = [], isLoading: cosmeticLoading } = useQuery<CosmeticLineRow[]>({
    queryKey: ['sales-staff-cosmetic', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data: svcRows, error: svcErr } = await supabase
        .from('services')
        .select('id')
        .eq('clinic_id', clinic!.id)
        .or('category.eq.풋화장품,category_label.eq.풋화장품');
      if (svcErr) throw svcErr;
      const cosmeticIds = (svcRows ?? []).map((s: { id: string }) => s.id);
      if (cosmeticIds.length === 0) return [];

      const { data, error } = await supabase
        .from('check_in_services')
        .select(`
          price, seller_staff_id, service_id, service_name,
          check_ins!inner(
            therapist_id, clinic_id, checked_in_at, customer_id,
            customers(name, chart_number)
          )
        `)
        .in('service_id', cosmeticIds)
        .eq('check_ins.clinic_id', clinic!.id)
        .gte('check_ins.checked_in_at', `${from}T00:00:00+09:00`)
        .lte('check_ins.checked_in_at', `${to}T23:59:59+09:00`)
        // T-20260804-foot-COSMETIC-CORRECTION-CRM (Tier-C): 비진성(net cash-in 0) soft-void 라인 제외.
        //   DA-20260805-foot-COSMETIC-VOID-SEMANTIC read-path 계약 = AND NOT COALESCE(void,false) ≡ voided_at IS NULL.
        //   ⚠ DDL(check_in_services.voided_at ADD)→FE 원자 co-deploy 선행(MIG-GATE). 미배포 시 PostgREST column-not-exist.
        .is('voided_at', null)
        .gt('price', 0);
      if (error) throw error;

      // sim 고객 제외 (표시매출 방어 — customer_id 는 check_ins 경로).
      const simIds = await getSimulationCustomerIds(clinic!.id);
      const rows = data as unknown as CosmeticLineRow[];
      if (simIds.size === 0) return rows;
      return rows.filter(
        (r) => !r.check_ins?.customer_id || !simIds.has(r.check_ins.customer_id),
      );
    },
  });

  // 화장품 매출 버킷: COALESCE(seller_staff_id, therapist_id). NULL='미상' 집계제외.
  const cosmeticBySeller = useMemo<Map<string, CosmeticStat>>(() => {
    const m = new Map<string, CosmeticStat>();
    for (const r of cosmeticLines) {
      const bucket = r.seller_staff_id ?? r.check_ins?.therapist_id ?? null;
      if (!bucket) continue; // 미상(seller·therapist 모두 없음) → 집계 제외
      const e = m.get(bucket) ?? { amount: 0, count: 0 };
      e.amount += r.price ?? 0;
      e.count += 1;
      m.set(bucket, e);
    }
    return m;
  }, [cosmeticLines]);

  // ── T-20260731 드릴다운: 버킷별 판매 건 목록 ─────────────────────────────────────
  //   cosmeticBySeller 와 동일 소스(cosmeticLines)·동일 버킷 로직으로 파생 →
  //   Σ(목록 금액) === cosmeticBySeller.amount === 칸 표시금액(AC3) 구조 보장.
  const cosmeticDetailBySeller = useMemo<Map<string, CosmeticDetailRow[]>>(() => {
    const m = new Map<string, CosmeticDetailRow[]>();
    cosmeticLines.forEach((r, idx) => {
      const bucket = r.seller_staff_id ?? r.check_ins?.therapist_id ?? null;
      if (!bucket) return; // 미상 → 집계·목록 모두 제외 (칸과 동일 기준)
      const arr = m.get(bucket) ?? [];
      const at = r.check_ins?.checked_in_at ?? null;
      arr.push({
        key: `${r.service_id ?? 'svc'}-${r.check_ins?.customer_id ?? 'walkin'}-${idx}`,
        customerName: r.check_ins?.customers?.name ?? '(비회원/워크인)',
        chartNumber: r.check_ins?.customers?.chart_number ?? null,
        productName: r.service_name ?? '(제품명 없음)',
        amount: r.price ?? 0,
        // checked_in_at 은 KST(+09:00) 바운드로 조회됨 → 앞 10자리(YYYY-MM-DD)만 표시
        saleDate: at ? at.slice(0, 10) : null,
      });
      // ★ T-20260731 REOPEN 버그픽스: 새 버킷 배열을 맵에 반드시 커밋해야 한다.
      //   m.set 누락 시 arr(=m.get(bucket)??[])는 매 iteration 새 빈 배열이라 push 후 버려져
      //   cosmeticDetailBySeller 가 영구히 빈 Map → 모든 화장품 칸 클릭이 "판매 내역 없음"으로 렌더됐음.
      //   cosmeticBySeller(집계)는 m.set 이 있어 칸 금액은 정상 → 칸 금액 vs 팝업 divergence 재현.
      m.set(bucket, arr);
    });
    // 판매일자 → 금액 내림차순 정렬(표시 편의, 합계 불변)
    for (const arr of m.values()) {
      arr.sort((a, b) => (b.saleDate ?? '').localeCompare(a.saleDate ?? '') || b.amount - a.amount);
    }
    return m;
  }, [cosmeticLines]);

  // 수납기준 치료 매출에서 차감할 화장품 금액(= 결제 lump 이 귀속됐던 담당 therapist_id 기준).
  //   double-count single-attribution 불변식: 화장품 라인은 실장의 치료 매출 컬럼에 얹지 않는다.
  const cosmeticByTherapist = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const r of cosmeticLines) {
      const t = r.check_ins?.therapist_id;
      if (!t) continue;
      m.set(t, (m.get(t) ?? 0) + (r.price ?? 0));
    }
    return m;
  }, [cosmeticLines]);

  // ── 수납기준 집계 (AC-1 · AC-2 · AC-3) ──────────────────────────────────────
  const payStats = useMemo<StaffStat[]>(() => {
    const map = new Map<string, StaffStat>();

    const upsert = (
      staffId: string,
      staffName: string,
      role: 'therapist' | 'technician',
      netAmt: number,
    ) => {
      const key = `${role}:${staffId}`;
      const existing = map.get(key) ?? {
        staffId,
        staffName,
        role,
        count: 0,
        revenue: 0,
        refundAmount: 0,
        designatedCount: designatedMap[staffId] ?? 0,
      };
      if (netAmt < 0) {
        existing.refundAmount += Math.abs(netAmt);
      } else {
        existing.count += 1;
        existing.revenue += netAmt;
      }
      map.set(key, existing);
    };

    for (const p of payments) {
      const netAmt = p.payment_type === 'refund' ? -p.amount : p.amount;
      const therapist = p.check_ins?.therapist;
      const technician = p.check_ins?.technician;

      if (therapist?.id) upsert(therapist.id, therapist.name, 'therapist', netAmt);
      if (technician?.id) upsert(technician.id, technician.name, 'technician', netAmt);
    }

    return Array.from(map.values()).sort((a, b) => {
      const ra = a.revenue - a.refundAmount;
      const rb = b.revenue - b.refundAmount;
      return rb - ra;
    });
  }, [payments, designatedMap]);

  // ── 차감기준 집계 (T-20260605 AC-1) ─────────────────────────────────────────
  // performed_by(차감 치료사) 그룹 → unit_price 스냅샷 합(AC-3) + surcharge 옵션(AC-4).
  const deductStats = useMemo<DeductStat[]>(() => {
    const map = new Map<string, DeductStat>();
    for (const s of deductSessions) {
      const perf = s.performer;
      if (!perf?.id) continue;
      const base =
        DEDUCT_AMOUNT_BASIS === 'current' ? currentUnitPrice(s) : (s.unit_price ?? 0);
      const amt = base + (DEDUCT_INCLUDE_SURCHARGE ? (s.surcharge ?? 0) : 0);
      const existing = map.get(perf.id) ?? {
        staffId: perf.id,
        staffName: perf.name,
        count: 0,
        revenue: 0,
        designatedCount: designatedMap[perf.id] ?? 0,
      };
      existing.count += 1;
      existing.revenue += amt;
      map.set(perf.id, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [deductSessions, designatedMap]);

  // 검색 필터 — 직원 이름 (글로벌 필터 공통 레이어)
  const filteredPay = useMemo<StaffStat[]>(() => {
    if (!searchQuery) return payStats;
    return payStats.filter((s) => s.staffName.toLowerCase().includes(searchQuery));
  }, [payStats, searchQuery]);

  const filteredDeduct = useMemo<DeductStat[]>(() => {
    if (!searchQuery) return deductStats;
    return deductStats.filter((s) => s.staffName.toLowerCase().includes(searchQuery));
  }, [deductStats, searchQuery]);

  const payTotals = useMemo(
    () => ({
      count: filteredPay.reduce((s, x) => s + x.count, 0),
      revenue: filteredPay.reduce((s, x) => s + x.revenue, 0),
      refund: filteredPay.reduce((s, x) => s + x.refundAmount, 0),
    }),
    [filteredPay],
  );

  const deductTotals = useMemo(
    () => ({
      count: filteredDeduct.reduce((s, x) => s + x.count, 0),
      revenue: filteredDeduct.reduce((s, x) => s + x.revenue, 0),
    }),
    [filteredDeduct],
  );

  // ── T-20260724-foot-COSMETIC-SELLER-ATTRIB (A-3): 별도 컬럼용 augmented 행 ──────────────
  //   수납기준: 치료 매출 = 기존 revenue − 화장품(담당 therapist 귀속분) 차감(이중산입 방지),
  //             화장품 매출 = COALESCE(seller, therapist) 버킷. 화장품만 판 seller 는 별도 행 append.
  const payRowsWithCosmetic = useMemo<PayRowWithCosmetic[]>(() => {
    const rows: PayRowWithCosmetic[] = filteredPay.map((s) => {
      const isTher = s.role === 'therapist';
      const cosmeticRevenue = isTher ? (cosmeticBySeller.get(s.staffId)?.amount ?? 0) : 0;
      const cosmeticDeducted = isTher ? (cosmeticByTherapist.get(s.staffId) ?? 0) : 0;
      return {
        ...s,
        treatmentRevenue: Math.max(0, s.revenue - cosmeticDeducted),
        cosmeticRevenue,
      };
    });
    const presentTher = new Set(
      filteredPay.filter((s) => s.role === 'therapist').map((s) => s.staffId),
    );
    for (const [staffId, c] of cosmeticBySeller) {
      if (presentTher.has(staffId)) continue;
      const name = staffNames[staffId] ?? '(미등록)';
      if (searchQuery && !name.toLowerCase().includes(searchQuery)) continue;
      rows.push({
        staffId,
        staffName: name,
        role: 'therapist',
        count: 0,
        revenue: 0,
        refundAmount: 0,
        designatedCount: designatedMap[staffId] ?? 0,
        treatmentRevenue: 0,
        cosmeticRevenue: c.amount,
      });
    }
    return rows;
  }, [filteredPay, cosmeticBySeller, cosmeticByTherapist, staffNames, designatedMap, searchQuery]);

  //   차감기준: package_sessions 는 화장품 미포함 → 치료 매출 무회귀, 화장품 매출만 additive.
  const deductRowsWithCosmetic = useMemo<DeductRowWithCosmetic[]>(() => {
    const rows: DeductRowWithCosmetic[] = filteredDeduct.map((s) => ({
      ...s,
      cosmeticRevenue: cosmeticBySeller.get(s.staffId)?.amount ?? 0,
    }));
    const present = new Set(filteredDeduct.map((s) => s.staffId));
    for (const [staffId, c] of cosmeticBySeller) {
      if (present.has(staffId)) continue;
      const name = staffNames[staffId] ?? '(미등록)';
      if (searchQuery && !name.toLowerCase().includes(searchQuery)) continue;
      rows.push({
        staffId,
        staffName: name,
        count: 0,
        revenue: 0,
        designatedCount: designatedMap[staffId] ?? 0,
        cosmeticRevenue: c.amount,
      });
    }
    return rows;
  }, [filteredDeduct, cosmeticBySeller, staffNames, designatedMap, searchQuery]);

  const payDisplayTotals = useMemo(
    () => ({
      treatment: payRowsWithCosmetic.reduce((s, r) => s + r.treatmentRevenue, 0),
      cosmetic: payRowsWithCosmetic.reduce((s, r) => s + r.cosmeticRevenue, 0),
    }),
    [payRowsWithCosmetic],
  );

  const deductCosmeticTotal = useMemo(
    () => deductRowsWithCosmetic.reduce((s, r) => s + r.cosmeticRevenue, 0),
    [deductRowsWithCosmetic],
  );

  const isLoading =
    (basis === 'payment' ? payLoading : deductLoading) || cosmeticLoading;

  // ── 기준 토글 바 ────────────────────────────────────────────────────────────
  const BasisToggle = (
    <div
      data-testid="sales-staff-basis-toggle"
      className="mb-2 flex items-center gap-2 text-xs"
    >
      <span className="text-muted-foreground">귀속 기준</span>
      <div className="inline-flex overflow-hidden rounded-md border">
        <button
          data-testid="sales-staff-basis-deduction"
          onClick={() => setBasis('deduction')}
          className={cn(
            'px-3 py-1 font-medium transition-colors',
            basis === 'deduction' ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          차감기준
        </button>
        <button
          data-testid="sales-staff-basis-payment"
          onClick={() => setBasis('payment')}
          className={cn(
            'px-3 py-1 font-medium transition-colors',
            basis === 'payment' ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          수납기준
        </button>
      </div>
      <span className="text-muted-foreground">
        {basis === 'deduction'
          ? '패키지 티켓 차감(시술) 치료사 × 차감수가'
          : '수납 시점 치료사/장비 × 결제금액'}
      </span>
    </div>
  );

  // T-20260725-foot-THERAPIST-DESIGNATED-CUSTLIST-DRILLDOWN:
  //   '지정 수' 셀 — 1 이상이면 클릭 가능한 drill-down(링크형), 0이면 비활성 텍스트(AC1·AC4).
  const renderDesignatedCount = (
    staffId: string,
    staffName: string,
    count: number,
    testId: string,
  ) => {
    if (count <= 0) {
      return <span className="text-muted-foreground">0</span>;
    }
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={() => setDesignatedDialog({ staffId, staffName })}
        className="cursor-pointer font-semibold text-emerald-700 underline decoration-dotted underline-offset-2 transition-colors hover:text-emerald-900"
        title="지정 고객 명단 보기"
      >
        {count}
      </button>
    );
  };

  // 현재 팝업 대상 치료사의 지정 고객 명단 (동일 소스 파생 → 카운트 정합 보장).
  const dialogCustomers = designatedDialog
    ? designatedListByTherapist.get(designatedDialog.staffId) ?? []
    : [];

  // ── 지정 고객 명단 Dialog (AC2·AC3·AC4) ───────────────────────────────────────
  const DesignatedListDialog = (
    <Dialog
      open={!!designatedDialog}
      onOpenChange={(open) => {
        if (!open) setDesignatedDialog(null);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="designated-dialog-title">
            {designatedDialog?.staffName} 치료사 지정 고객
          </DialogTitle>
          <DialogDescription>
            지정 수 {dialogCustomers.length}명 · 고객을 클릭하면 2번차트로 이동합니다.
          </DialogDescription>
        </DialogHeader>
        {dialogCustomers.length === 0 ? (
          <div
            data-testid="designated-dialog-empty"
            className="py-8 text-center text-sm text-muted-foreground"
          >
            지정된 고객이 없습니다.
          </div>
        ) : (
          <ul data-testid="designated-dialog-list" className="max-h-[60vh] divide-y overflow-auto">
            {dialogCustomers.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  data-testid={`designated-dialog-customer-${c.id}`}
                  onClick={() => {
                    openChart(c.id); // 기존 2번차트 라우팅 재사용(AC3)
                    setDesignatedDialog(null);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-1 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono text-xs text-teal-600">
                    {chartNoBadge(c.chart_number)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );

  // ── T-20260731 화장품 매출 칸 렌더 (클릭 → 드릴다운) ─────────────────────────────
  //   amount>0 → 클릭 가능한 링크형(팝업). amount<=0(—) → 클릭 무반응 텍스트(AC4).
  const renderCosmeticCell = (
    staffId: string,
    staffName: string,
    amount: number,
    testId: string,
  ) => {
    if (amount <= 0) {
      return (
        <span data-testid={testId} className="text-muted-foreground">
          —
        </span>
      );
    }
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={() => setCosmeticDialog({ staffId, staffName })}
        className="cursor-pointer font-semibold text-teal-700 underline decoration-dotted underline-offset-2 transition-colors hover:text-teal-900"
        title="화장품 판매 내역 보기"
      >
        {formatAmount(Math.round(amount))}원
      </button>
    );
  };

  // 현재 팝업 대상 치료사의 화장품 판매 건 목록 + 합계 (동일 소스 파생 → 칸 금액과 정합).
  const cosmeticDialogRows = cosmeticDialog
    ? cosmeticDetailBySeller.get(cosmeticDialog.staffId) ?? []
    : [];
  const cosmeticDialogTotal = cosmeticDialogRows.reduce((s, r) => s + r.amount, 0);

  // ── 화장품 판매내역 드릴다운 Dialog (AC1·AC2·AC3·AC6) ───────────────────────────
  const CosmeticDetailDialog = (
    <Dialog
      open={!!cosmeticDialog}
      onOpenChange={(open) => {
        if (!open) setCosmeticDialog(null);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid="cosmetic-dialog-title">
            {cosmeticDialog?.staffName} — 화장품 판매 내역
          </DialogTitle>
          <DialogDescription>
            {basis === 'deduction' ? '차감기준' : '수납기준'} · {from} ~ {to} · {cosmeticDialogRows.length}건
          </DialogDescription>
        </DialogHeader>
        {cosmeticDialogRows.length === 0 ? (
          <div
            data-testid="cosmetic-dialog-empty"
            className="py-8 text-center text-sm text-muted-foreground"
          >
            판매 내역이 없습니다.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-lg border text-xs">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-muted/70">
                <tr>
                  {['고객성함', '차트번호', '판매제품명', '판매일자', '금액'].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap border-b px-3 py-2 text-left font-medium text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody data-testid="cosmetic-dialog-list">
                {cosmeticDialogRows.map((r) => (
                  <tr key={r.key} className="border-b transition hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{r.customerName}</td>
                    <td className="px-3 py-2 font-mono text-teal-600">
                      {chartNoBadge(r.chartNumber)}
                    </td>
                    <td className="px-3 py-2">{r.productName}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {r.saleDate ?? '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-right font-semibold">
                      {formatAmount(Math.round(r.amount))}원
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40 font-semibold">
                  <td colSpan={4} className="px-3 py-2 text-right">
                    합계
                  </td>
                  <td
                    data-testid="cosmetic-dialog-total"
                    className="px-3 py-2 tabular-nums text-right text-teal-700"
                  >
                    {formatAmount(Math.round(cosmeticDialogTotal))}원
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  // ── 렌더 ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div>
        {BasisToggle}
        <div
          data-testid="sales-staff-loading"
          className="flex items-center justify-center py-16 text-sm text-muted-foreground"
        >
          불러오는 중…
        </div>
      </div>
    );
  }

  // ── 차감기준 view (T-20260605) ─────────────────────────────────────────────
  if (basis === 'deduction') {
    if (deductRowsWithCosmetic.length === 0) {
      return (
        <div>
          {BasisToggle}
          <div
            data-testid="sales-staff-deduct-empty"
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
          >
            <span className="text-sm text-muted-foreground">해당 기간에 차감 내역이 없습니다</span>
            <span className="text-xs text-muted-foreground">
              패키지 티켓 차감 시 치료사(performed_by)가 기록된 세션만 집계됩니다
            </span>
          </div>
        </div>
      );
    }

    return (
      <div>
        {BasisToggle}
        <div
          data-testid="sales-staff-deduct-tab"
          className="overflow-auto rounded-lg border bg-background text-xs"
        >
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/70">
              <tr>
                {['치료사', '차감 건수', '지정환자수', '차감 매출(치료)', '화장품 매출'].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border-b px-3 py-2 text-left font-medium text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deductRowsWithCosmetic.map((s) => (
                <tr
                  key={s.staffId}
                  data-testid={`sales-staff-deduct-row-${s.staffId}`}
                  className="border-b transition hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-medium">{s.staffName}</td>
                  <td
                    data-testid={`sales-staff-deduct-count-${s.staffId}`}
                    className="px-3 py-2 tabular-nums text-center"
                  >
                    {s.count}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-center">
                    {renderDesignatedCount(
                      s.staffId,
                      s.staffName,
                      s.designatedCount,
                      `sales-staff-deduct-designated-${s.staffId}`,
                    )}
                  </td>
                  <td
                    data-testid={`sales-staff-deduct-revenue-${s.staffId}`}
                    className="px-3 py-2 tabular-nums text-right font-semibold"
                  >
                    {formatAmount(Math.round(s.revenue))}원
                  </td>
                  {/* T-20260724-foot-COSMETIC-SELLER-ATTRIB (A-3): 화장품 매출 별도 컬럼(합산 X) */}
                  <td
                    className="px-3 py-2 tabular-nums text-right"
                  >
                    {renderCosmeticCell(
                      s.staffId,
                      s.staffName,
                      s.cosmeticRevenue,
                      `sales-staff-deduct-cosmetic-${s.staffId}`,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td className="px-3 py-2">합계</td>
                <td
                  data-testid="sales-staff-deduct-total-count"
                  className="px-3 py-2 tabular-nums text-center"
                >
                  {deductTotals.count}
                </td>
                <td className="px-3 py-2 tabular-nums text-center text-muted-foreground text-xs">—</td>
                <td
                  data-testid="sales-staff-deduct-total-revenue"
                  className="px-3 py-2 tabular-nums text-right"
                >
                  {formatAmount(Math.round(deductTotals.revenue))}원
                </td>
                <td
                  data-testid="sales-staff-deduct-total-cosmetic"
                  className="px-3 py-2 tabular-nums text-right text-teal-700"
                >
                  {formatAmount(Math.round(deductCosmeticTotal))}원
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="px-3 py-1.5 text-xs text-muted-foreground">
            * 차감기준: 패키지 티켓 차감(시술) 시점의 치료사에게 차감 수가 귀속 (status='used', 환불·취소 제외).
            금액 기준: {DEDUCT_AMOUNT_BASIS === 'snapshot' ? '차감 당시 단가(스냅샷)' : '현재 설정 단가'}
            {DEDUCT_INCLUDE_SURCHARGE ? ' · 추가금 포함' : ' · 추가금 미포함'}
            {' · 화장품 매출 = 판매 치료사(미지정 시 담당 치료사) 귀속, 치료 매출과 별도 집계(합산 아님).'}
          </p>
        </div>
        {DesignatedListDialog}
        {CosmeticDetailDialog}
      </div>
    );
  }

  // ── 수납기준 view (기존) ────────────────────────────────────────────────────
  if (payRowsWithCosmetic.length === 0) {
    return (
      <div>
        {BasisToggle}
        <div
          data-testid="sales-staff-empty"
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
        >
          <span className="text-sm text-muted-foreground">해당 기간에 담당치료사 데이터가 없습니다</span>
          <span className="text-xs text-muted-foreground">
            수납에 치료사/장비명이 연결되지 않은 경우 표시되지 않습니다
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {BasisToggle}
      <div
        data-testid="sales-staff-tab"
        className="overflow-auto rounded-lg border bg-background text-xs"
      >
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-muted/70">
            <tr>
              {['치료사/장비명', '역할', '시술 건수', '지정환자수', '치료 매출', '화장품 매출', '환불 차감액', '순 실적'].map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b px-3 py-2 text-left font-medium text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payRowsWithCosmetic.map((s) => {
              // 순 실적 = 치료 매출(화장품 제외) − 환불. 화장품 매출은 별도 컬럼(합산 X).
              const net = s.treatmentRevenue - s.refundAmount;
              // 행 role 판정(치료사 vs 장비) — 렌더 내 중복 인라인 비교 방지.
              const isTherapist = s.role === 'therapist';
              return (
                <tr
                  key={`${s.role}:${s.staffId}`}
                  data-testid={`sales-staff-row-${s.role}-${s.staffId}`}
                  className="border-b transition hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-medium">{s.staffName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {isTherapist ? '치료사' : '장비명'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-center">{s.count}</td>
                  {/* T-20260522-foot-DESIGNATED-THERAPIST AC-4 */}
                  <td
                    data-testid={`sales-staff-designated-cell-${s.role}-${s.staffId}`}
                    className="px-3 py-2 tabular-nums text-center"
                  >
                    {isTherapist
                      ? renderDesignatedCount(
                          s.staffId,
                          s.staffName,
                          s.designatedCount,
                          `sales-staff-designated-${s.role}-${s.staffId}`,
                        )
                      : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-right">
                    {formatAmount(Math.round(s.treatmentRevenue))}원
                  </td>
                  {/* T-20260724-foot-COSMETIC-SELLER-ATTRIB (A-3): 화장품 매출 별도 컬럼(seller 귀속) */}
                  <td
                    className="px-3 py-2 tabular-nums text-right"
                  >
                    {isTherapist
                      ? renderCosmeticCell(
                          s.staffId,
                          s.staffName,
                          s.cosmeticRevenue,
                          `sales-staff-cosmetic-${s.role}-${s.staffId}`,
                        )
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td
                    data-testid={`sales-staff-refund-${s.role}-${s.staffId}`}
                    className={cn(
                      'px-3 py-2 tabular-nums text-right',
                      s.refundAmount > 0 && 'text-red-600',
                    )}
                  >
                    {s.refundAmount > 0 ? `-${formatAmount(Math.round(s.refundAmount))}원` : '—'}
                  </td>
                  <td
                    data-testid={`sales-staff-net-${s.role}-${s.staffId}`}
                    className={cn(
                      'px-3 py-2 tabular-nums text-right font-semibold',
                      net < 0 && 'text-red-600',
                    )}
                  >
                    {formatAmount(Math.round(net))}원
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 font-semibold">
              <td colSpan={2} className="px-3 py-2">합계</td>
              <td
                data-testid="sales-staff-total-count"
                className="px-3 py-2 tabular-nums text-center"
              >
                {payTotals.count}
              </td>
              <td className="px-3 py-2 tabular-nums text-center text-muted-foreground text-xs">—</td>
              <td
                data-testid="sales-staff-total-revenue"
                className="px-3 py-2 tabular-nums text-right"
              >
                {formatAmount(Math.round(payDisplayTotals.treatment))}원
              </td>
              <td
                data-testid="sales-staff-total-cosmetic"
                className="px-3 py-2 tabular-nums text-right text-teal-700"
              >
                {formatAmount(Math.round(payDisplayTotals.cosmetic))}원
              </td>
              <td
                data-testid="sales-staff-total-refund"
                className="px-3 py-2 tabular-nums text-right text-red-600"
              >
                {payTotals.refund > 0 ? `-${formatAmount(Math.round(payTotals.refund))}원` : '—'}
              </td>
              <td
                data-testid="sales-staff-total-net"
                className="px-3 py-2 tabular-nums text-right"
              >
                {formatAmount(Math.round(payDisplayTotals.treatment - payTotals.refund))}원
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="px-3 py-1.5 text-xs text-muted-foreground">
          * 소급 방지: 환불액은 환불 처리 당월 해당 직원 실적에서 차감 (과거 월 데이터 불변)
          <br />
          * 화장품 매출 = 판매 치료사(미지정 시 담당 치료사) 귀속, 치료 매출 컬럼에서 분리 집계(이중산입 없음).
        </p>
      </div>
      {DesignatedListDialog}
      {CosmeticDetailDialog}
    </div>
  );
}
