/**
 * T-20260515-foot-SALES-COMMON-DB
 * 매출집계 메인 페이지
 *
 * 탭 구조:
 *   일일결산(daily)  — T-20260515-foot-SALES-TAB-DAILY 구현 예정
 *   환자별(patient)  — T-20260515-foot-SALES-TAB-PATIENT 구현 예정
 *   시술별(treatment)— T-20260515-foot-SALES-TAB-TREATMENT 구현 예정
 *   담당의별(doctor) — T-20260515-foot-SALES-TAB-DOCTOR 구현 예정
 *   담당직원별(staff)— T-20260515-foot-SALES-TAB-STAFF 구현 예정
 *
 * 이 파일은 COMMON-DB 범위: 탭 셸 + 공통 필터 + 엑셀 다운로드 공통 레이어.
 * 개별 탭 콘텐츠는 후속 티켓에서 채워진다.
 *
 * 원칙:
 *   - READ-ONLY: 기존 결제 플로우 코드 수정 없음
 *   - 집계 기준: accounting_date (소급 차단)
 *   - 기존 DB 필드 100% 재사용
 */

import { useState } from 'react';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  SalesFilterBar,
  defaultSalesFilter,
  type SalesFilterState,
} from '@/components/sales/SalesFilterBar';
import {
  downloadSalesExcel,
  dateRangeFilename,
  visitTypeLabel,
  payMethodLabel,
  paymentStatusLabel,
  type SalesExcelRow,
} from '@/lib/salesExport';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { toast } from 'sonner';
import { BarChart2, Users, Layers, UserCheck, User } from 'lucide-react';
import { SalesDailyTab } from '@/components/sales/SalesDailyTab';

// 탭 정의
const SALES_TABS = [
  { value: 'daily',     label: '일일결산',   icon: BarChart2 },
  { value: 'patient',   label: '환자별',     icon: Users },
  { value: 'treatment', label: '시술별',     icon: Layers },
  { value: 'doctor',    label: '담당의별',   icon: UserCheck },
  { value: 'staff',     label: '담당직원별', icon: User },
] as const;

type SalesTabValue = (typeof SALES_TABS)[number]['value'];

/** 개별 탭 미구현 플레이스홀더 */
function TabPlaceholder({ label }: { label: string }) {
  return (
    <div
      data-testid={`sales-placeholder-${label}`}
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 py-20 text-center"
    >
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">개발 진행 중</span>
    </div>
  );
}

export default function Sales() {
  const clinic = useClinic();
  const [activeTab, setActiveTab] = useState<SalesTabValue>('daily');
  const [filter, setFilter] = useState<SalesFilterState>(defaultSalesFilter());
  const [exporting, setExporting] = useState(false);

  /** 공통 엑셀 다운로드 — accounting_date 기준 payments + package_payments 조인 */
  const handleExport = async () => {
    if (!clinic) { toast.error('클리닉 정보를 불러오는 중입니다.'); return; }
    setExporting(true);
    try {
      const rows = await fetchSalesRawRows(clinic.id, filter);
      if (!rows.length) {
        toast.info('해당 기간에 매출 내역이 없습니다.');
        return;
      }
      downloadSalesExcel(rows, dateRangeFilename(filter.dateRange.from, filter.dateRange.to));
      toast.success(`${rows.length}건 다운로드 완료`);
    } catch (e) {
      console.error('[Sales.exportExcel]', e);
      toast.error('다운로드 중 오류가 발생했습니다.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 페이지 헤더 */}
      <div className="shrink-0 border-b bg-background px-5 py-3">
        <h1 className="text-lg font-semibold">매출집계</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          집계 기준: 회계귀속일(accounting_date). 과거 마감 소급 변동 차단.
        </p>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* 글로벌 필터 바 */}
        <SalesFilterBar
          value={filter}
          onChange={setFilter}
          onExport={handleExport}
          exporting={exporting}
        />

        {/* 탭 */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as SalesTabValue)}
        >
          <TabsList className="h-auto flex-wrap gap-1 p-1">
            {SALES_TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="gap-1.5 px-3 py-1.5 text-sm"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* 일일결산 — T-20260515-foot-SALES-TAB-DAILY */}
          <TabsContent value="daily">
            <SalesDailyTab filter={filter} />
          </TabsContent>

          {/* 환자별 — T-20260515-foot-SALES-TAB-PATIENT */}
          <TabsContent value="patient">
            <TabPlaceholder label="환자별 (T-20260515-foot-SALES-TAB-PATIENT)" />
          </TabsContent>

          {/* 시술별 — T-20260515-foot-SALES-TAB-TREATMENT */}
          <TabsContent value="treatment">
            <TabPlaceholder label="시술별 (T-20260515-foot-SALES-TAB-TREATMENT)" />
          </TabsContent>

          {/* 담당의별 — T-20260515-foot-SALES-TAB-DOCTOR */}
          <TabsContent value="doctor">
            <TabPlaceholder label="담당의별 (T-20260515-foot-SALES-TAB-DOCTOR)" />
          </TabsContent>

          {/* 담당직원별 — T-20260515-foot-SALES-TAB-STAFF */}
          <TabsContent value="staff">
            <TabPlaceholder label="담당직원별 (T-20260515-foot-SALES-TAB-STAFF)" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부: 엑셀 Raw 조회 (payments + package_payments)
// accounting_date 기준, 기존 DB 필드 100% 재사용
// ─────────────────────────────────────────────────────────────────────────────

interface PaymentRawRow {
  id: string;
  accounting_date: string | null;
  origin_tx_date: string | null;
  payment_type: string | null;
  status: string | null;
  amount: number;
  method: string | null;
  tax_type: string | null;
  appr_info: string | null;
  exclude_tax_report: boolean | null;
  parent_payment_id: string | null;
  memo: string | null;
  created_at: string;
  check_ins: {
    visit_type: string | null;
    customer_name: string | null;
    customers: {
      chart_number: string | null;
    } | null;
    check_in_services: {
      services: {
        name: string | null;
        category: string | null;
      } | null;
    }[] | null;
    therapist: { name: string | null } | null;
    consultant: { name: string | null } | null;
  } | null;
}

interface PkgPaymentRawRow {
  id: string;
  accounting_date: string | null;
  origin_tx_date: string | null;
  payment_type: string | null;
  amount: number;
  method: string | null;
  tax_type: string | null;
  appr_info: string | null;
  exclude_tax_report: boolean | null;
  parent_payment_id: string | null;
  memo: string | null;
  created_at: string;
  packages: {
    name: string | null;
    customers: {
      name: string | null;
      chart_number: string | null;
    } | null;
  } | null;
}

async function fetchSalesRawRows(
  clinicId: string,
  filter: SalesFilterState,
): Promise<SalesExcelRow[]> {
  const { from, to } = filter.dateRange;
  const q = filter.searchQuery.trim();

  // ── 단건 결제 ────────────────────────────────────────────
  // accounting_date: 마이그레이션 backfill + INSERT 트리거로 항상 non-null 보장.
  const payRes = await supabase
    .from('payments')
    .select(`
      id, accounting_date, origin_tx_date, payment_type, status,
      amount, method, tax_type, appr_info, exclude_tax_report,
      parent_payment_id, memo, created_at,
      check_ins(
        visit_type, customer_name,
        customers(chart_number),
        check_in_services(services(name, category)),
        therapist:staff!check_ins_therapist_id_fkey(name),
        consultant:staff!check_ins_consultant_id_fkey(name)
      )
    `)
    .eq('clinic_id', clinicId)
    .not('status', 'eq', 'deleted')
    .gte('accounting_date', from)
    .lte('accounting_date', to);

  // ── 패키지 결제 ──────────────────────────────────────────
  const pkgRes = await supabase
    .from('package_payments')
    .select(`
      id, accounting_date, origin_tx_date, payment_type,
      amount, method, tax_type, appr_info, exclude_tax_report,
      parent_payment_id, memo, created_at,
      packages(name, customers(name, chart_number))
    `)
    .eq('clinic_id', clinicId)
    .gte('accounting_date', from)
    .lte('accounting_date', to);

  if (payRes.error) throw payRes.error;
  if (pkgRes.error) throw pkgRes.error;

  const payRows = (payRes.data ?? []) as unknown as PaymentRawRow[];
  const pkgRows = (pkgRes.data ?? []) as unknown as PkgPaymentRawRow[];

  const result: SalesExcelRow[] = [];

  // 단건 결제 → SalesExcelRow
  for (const p of payRows) {
    const ci = p.check_ins;
    const svcName = ci?.check_in_services?.[0]?.services?.name ?? '';
    const svcCode = ci?.check_in_services?.[0]?.services?.category ?? '';
    const accountingDate =
      p.accounting_date ??
      new Date(p.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

    const row: SalesExcelRow = {
      '고유전표ID': p.id,
      '회계귀속일자': accountingDate,
      '원거래일자': p.origin_tx_date ?? '',
      '차트번호': ci?.customers?.chart_number ?? '',
      '환자명': ci?.customer_name ?? '',
      '주민등록번호': '',   // Vault 참조 — 프론트에서 직접 조회 불가, 공란 처리
      '진료구분': visitTypeLabel(ci?.visit_type),
      '상병코드': '',   // claim_diagnoses 별도 조회 가능, 여기선 공란
      '시술코드': svcCode,
      '시술/상품명': svcName,
      '담당의사': '',
      '담당직원': ci?.therapist?.name ?? ci?.consultant?.name ?? '',
      '세금속성': p.tax_type ?? '',
      '총발생금액': p.amount,
      '급여 본부금': 0,
      '공단청구액': 0,
      '과세 공급가': 0,
      '부가세': 0,
      '비과세액': 0,
      '할인금액': 0,
      '실수납액': p.payment_type === 'refund' ? -p.amount : p.amount,
      '결제수단': payMethodLabel(p.method),
      '승인정보': p.appr_info ?? '',
      '연말정산제외': p.exclude_tax_report ? 'Y' : 'N',
      '전표상태': paymentStatusLabel(p.payment_type, p.status),
    };
    result.push(row);
  }

  // 패키지 결제 → SalesExcelRow
  for (const p of pkgRows) {
    const customer = p.packages?.customers;
    const accountingDate =
      p.accounting_date ??
      new Date(p.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

    const row: SalesExcelRow = {
      '고유전표ID': p.id,
      '회계귀속일자': accountingDate,
      '원거래일자': p.origin_tx_date ?? '',
      '차트번호': customer?.chart_number ?? '',
      '환자명': customer?.name ?? '',
      '주민등록번호': '',   // Vault 참조 — 프론트에서 직접 조회 불가, 공란 처리
      '진료구분': '',
      '상병코드': '',
      '시술코드': 'PKG',
      '시술/상품명': p.packages?.name ?? '패키지',
      '담당의사': '',
      '담당직원': '',
      '세금속성': p.tax_type ?? '',
      '총발생금액': p.amount,
      '급여 본부금': 0,
      '공단청구액': 0,
      '과세 공급가': 0,
      '부가세': 0,
      '비과세액': 0,
      '할인금액': 0,
      '실수납액': p.payment_type === 'refund' ? -p.amount : p.amount,
      '결제수단': payMethodLabel(p.method),
      '승인정보': p.appr_info ?? '',
      '연말정산제외': p.exclude_tax_report ? 'Y' : 'N',
      '전표상태': paymentStatusLabel(p.payment_type, null),
    };
    result.push(row);
  }

  // accounting_date 오름차순 정렬
  result.sort((a, b) => a['회계귀속일자'].localeCompare(b['회계귀속일자']));

  // 검색 필터 (클라이언트 사이드 — 패키지/단건 통합 필터)
  if (q) {
    const lq = q.toLowerCase();
    return result.filter(
      (r) =>
        r['환자명'].toLowerCase().includes(lq) ||
        r['차트번호'].toLowerCase().includes(lq),
    );
  }

  return result;
}

