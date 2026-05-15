/**
 * T-20260515-foot-SALES-TAB-PATIENT
 * 매출집계 탭2 — 환자별 원무 대사 뷰
 *
 * AC-1: accounting_date 기준 최신순 평면 그리드 (14 컬럼 풀 스펙)
 * AC-2: 행 클릭 → 상세 모달 (원천 영수증 수가내역 + 차트 오더)
 * AC-3: 글로벌 필터 + 엑셀은 부모(Sales.tsx)에서 처리
 *
 * READ-ONLY. DB 변경 없음.
 * 소스: payments JOIN claim_diagnoses JOIN check_ins JOIN customers
 *        JOIN check_in_services JOIN service_charges
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SalesFilterState } from '@/components/sales/SalesFilterBar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

// ─── 타입 ───────────────────────────────────────────────────────────────────

interface ServiceChargeSummary {
  copayment_amount: number;
  insurance_covered_amount: number;
  exempt_amount: number;
}

interface ClaimDiagnosis {
  disease_code: string;
  disease_name: string | null;
}

interface PatientRow {
  id: string;
  accounting_date: string;
  payment_type: string | null;
  status: string | null;
  amount: number;
  method: string | null;
  tax_type: string | null;
  parent_payment_id: string | null;
  /** ICD-10 상병코드 (정규화 테이블 T-20260515-foot-SALES-COMMON-DB) */
  claim_diagnoses: ClaimDiagnosis[] | null;
  check_ins: {
    visit_type: string | null;
    customer_name: string | null;
    customers: { chart_number: string | null } | null;
    check_in_services: {
      services: { name: string | null; category: string | null } | null;
    }[] | null;
    consultant: { name: string | null } | null;
    therapist: { name: string | null } | null;
    /** 수가 산출 이력 (T-20260504-foot-INSURANCE-COPAYMENT) */
    service_charges: ServiceChargeSummary[] | null;
  } | null;
}

interface Props {
  filter: SalesFilterState;
}

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

const METHOD_LABEL: Record<string, string> = {
  cash: '현금', card: '카드', transfer: '이체',
  membership: '선수금차감', insurance: '보험', mixed: '복합',
};

function visitLabel(vt: string | null) {
  if (vt === 'new') return '초진';
  if (vt === 'returning') return '재진';
  if (vt === 'trial' || vt === 'experience') return '체험';
  return vt ?? '';
}

function statusVariant(pt: string | null, st: string | null): 'default' | 'secondary' | 'destructive' {
  if (pt === 'refund') return 'destructive';
  if (st === 'cancelled') return 'secondary';
  return 'default';
}

function statusLabel(pt: string | null, st: string | null): string {
  if (st === 'cancelled') return '결제취소';
  if (pt === 'refund') return '부분환불';
  return '정상수납';
}

/** 과세공급가 역산 (부가세 10% 포함 → 세전 공급가) */
function calcTaxableSupply(amount: number, taxType: string | null): number {
  if (taxType === '과세_비급여') return Math.round(amount / 1.1);
  return 0;
}

/** service_charges 배열 합산 */
function sumCharges(charges: ServiceChargeSummary[] | null | undefined) {
  if (!charges?.length) return { copayment: 0, covered: 0, exempt: 0 };
  return charges.reduce(
    (acc, c) => ({
      copayment: acc.copayment + (c.copayment_amount ?? 0),
      covered: acc.covered + (c.insurance_covered_amount ?? 0),
      exempt: acc.exempt + (c.exempt_amount ?? 0),
    }),
    { copayment: 0, covered: 0, exempt: 0 },
  );
}

/** 상병코드 목록 → 쉼표 구분 문자열 */
function diagLabel(diagnoses: ClaimDiagnosis[] | null | undefined): string {
  if (!diagnoses?.length) return '—';
  return diagnoses.map((d) => d.disease_code).join(', ');
}

// ─── 테이블 헤더 ─────────────────────────────────────────────────────────────

const HEADERS = [
  '회계귀속일', '차트번호', '환자명', '진료구분', '상병코드',
  '시술명', '본부금', '공단청구액', '과세공급가', '면세금액',
  '할인', '실수납액', '결제수단', '전표상태',
] as const; // 14 컬럼

// ─── 상세 모달 (AC-2) ───────────────────────────────────────────────────────

function PatientDetailModal({
  row,
  onClose,
}: {
  row: PatientRow;
  onClose: () => void;
}) {
  const ci = row.check_ins;
  const services = ci?.check_in_services ?? [];
  const isRefund = row.payment_type === 'refund';
  const netAmt = isRefund ? -row.amount : row.amount;
  const charges = sumCharges(ci?.service_charges);
  const taxableSupply = calcTaxableSupply(row.amount, row.tax_type);
  const hasChargeDetail = charges.copayment > 0 || charges.covered > 0 || charges.exempt > 0 || taxableSupply > 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="sales-patient-modal">
        <DialogHeader>
          <DialogTitle className="text-base">
            수납 상세 — {ci?.customer_name ?? '—'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* 기본 정보 */}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs">
            <div>
              <span className="text-muted-foreground">차트번호 </span>
              {ci?.customers?.chart_number ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">진료구분 </span>
              {visitLabel(ci?.visit_type ?? null)}
            </div>
            <div>
              <span className="text-muted-foreground">회계귀속일 </span>
              {row.accounting_date}
            </div>
            <div>
              <span className="text-muted-foreground">결제수단 </span>
              {METHOD_LABEL[row.method ?? ''] ?? row.method ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">세금속성 </span>
              {row.tax_type ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">실수납액 </span>
              <span className={cn('font-semibold', isRefund && 'text-red-600')}>
                {formatAmount(netAmt)}
              </span>
            </div>
            {row.claim_diagnoses && row.claim_diagnoses.length > 0 && (
              <div className="col-span-2">
                <span className="text-muted-foreground">상병코드 </span>
                {row.claim_diagnoses
                  .map((d) => `${d.disease_code}${d.disease_name ? ` (${d.disease_name})` : ''}`)
                  .join(', ')}
              </div>
            )}
          </div>

          {/* 원천 영수증 — 수가 내역 (AC-2) */}
          {hasChargeDetail && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">
                수가 내역 (원천 영수증)
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border px-3 py-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">급여 본부금</span>
                  <span className="tabular-nums">{formatAmount(charges.copayment)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">공단청구액</span>
                  <span className="tabular-nums">{formatAmount(charges.covered)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">과세공급가</span>
                  <span className="tabular-nums">{formatAmount(taxableSupply)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">면세금액</span>
                  <span className="tabular-nums">{formatAmount(charges.exempt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">할인</span>
                  <span className="tabular-nums">0</span>
                </div>
              </div>
            </div>
          )}

          {/* 차트 오더 내역 (AC-2) */}
          {services.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">시술 오더</div>
              {services.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded border px-2 py-1 text-xs"
                >
                  <FileText className="h-3 w-3 shrink-0 text-teal-500" />
                  <span>{s.services?.name ?? '—'}</span>
                  {s.services?.category && (
                    <span className="ml-auto text-muted-foreground">{s.services.category}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 환불 건 원거래 연결 (AC-2: parent_payment_id) */}
          {row.parent_payment_id && (
            <div
              data-testid="sales-patient-modal-parent"
              className="rounded border border-yellow-200 bg-yellow-50 px-2 py-1.5 text-xs text-yellow-800"
            >
              <span className="font-medium">원거래 연결</span>
              {' '}ID:{' '}
              <code className="font-mono">{row.parent_payment_id.slice(0, 8)}…</code>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────

export function SalesPatientTab({ filter }: Props) {
  const clinic = useClinic();
  const [selected, setSelected] = useState<PatientRow | null>(null);
  const { from, to } = filter.dateRange;
  const q = filter.searchQuery.trim().toLowerCase();

  const { data: rows = [], isLoading } = useQuery<PatientRow[]>({
    queryKey: ['sales-patient', clinic?.id, from, to],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, accounting_date, payment_type, status, amount,
          method, tax_type, parent_payment_id,
          claim_diagnoses(disease_code, disease_name),
          check_ins(
            visit_type, customer_name,
            customers(chart_number),
            check_in_services(services(name, category)),
            consultant:staff!check_ins_consultant_id_fkey(name),
            therapist:staff!check_ins_therapist_id_fkey(name),
            service_charges(copayment_amount, insurance_covered_amount, exempt_amount)
          )
        `)
        .eq('clinic_id', clinic!.id)
        .not('status', 'eq', 'deleted')
        .gte('accounting_date', from)
        .lte('accounting_date', to)
        .order('accounting_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PatientRow[];
    },
  });

  const filtered = q
    ? rows.filter(
        (r) =>
          (r.check_ins?.customer_name ?? '').toLowerCase().includes(q) ||
          (r.check_ins?.customers?.chart_number ?? '').toLowerCase().includes(q),
      )
    : rows;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        불러오는 중…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div
        data-testid="sales-patient-empty"
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 py-16 text-center"
      >
        <span className="text-sm text-muted-foreground">해당 기간에 수납 내역이 없습니다</span>
      </div>
    );
  }

  const totalNetAmt = filtered.reduce(
    (s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount),
    0,
  );

  return (
    <div data-testid="sales-patient-tab">
      <div className="overflow-auto rounded-lg border bg-background text-xs">
        <table
          data-testid="sales-patient-grid"
          className="w-full border-collapse"
        >
          <thead className="sticky top-0 z-10 bg-muted/70">
            <tr>
              {HEADERS.map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((row) => {
              const ci = row.check_ins;
              const svcName = ci?.check_in_services?.[0]?.services?.name ?? '—';
              const isRefund = row.payment_type === 'refund';
              const netAmt = isRefund ? -row.amount : row.amount;
              const charges = sumCharges(ci?.service_charges);
              const taxableSupply = calcTaxableSupply(row.amount, row.tax_type);
              const diseaseStr = diagLabel(row.claim_diagnoses);

              return (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b transition hover:bg-teal-50/50"
                  onClick={() => setSelected(row)}
                >
                  {/* 회계귀속일 */}
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                    {row.accounting_date}
                  </td>
                  {/* 차트번호 */}
                  <td className="px-2 py-1.5 font-mono">
                    {ci?.customers?.chart_number ?? '—'}
                  </td>
                  {/* 환자명 */}
                  <td className="px-2 py-1.5 font-medium">
                    {ci?.customer_name ?? '—'}
                  </td>
                  {/* 진료구분 */}
                  <td className="px-2 py-1.5">
                    {visitLabel(ci?.visit_type ?? null)}
                  </td>
                  {/* 상병코드 */}
                  <td className="px-2 py-1.5 font-mono text-[10px]">
                    {diseaseStr}
                  </td>
                  {/* 시술명 */}
                  <td className="max-w-[140px] truncate px-2 py-1.5">{svcName}</td>
                  {/* 본부금 */}
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-right">
                    {charges.copayment > 0 ? formatAmount(charges.copayment) : '—'}
                  </td>
                  {/* 공단청구액 */}
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-right">
                    {charges.covered > 0 ? formatAmount(charges.covered) : '—'}
                  </td>
                  {/* 과세공급가 */}
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-right">
                    {taxableSupply > 0 ? formatAmount(taxableSupply) : '—'}
                  </td>
                  {/* 면세금액 */}
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-right">
                    {charges.exempt > 0 ? formatAmount(charges.exempt) : '—'}
                  </td>
                  {/* 할인 */}
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-right">—</td>
                  {/* 실수납액 */}
                  <td
                    className={cn(
                      'whitespace-nowrap px-2 py-1.5 tabular-nums text-right font-medium',
                      isRefund && 'text-red-600',
                    )}
                  >
                    {formatAmount(netAmt)}
                  </td>
                  {/* 결제수단 */}
                  <td className="px-2 py-1.5">
                    {METHOD_LABEL[row.method ?? ''] ?? row.method ?? '—'}
                  </td>
                  {/* 전표상태 */}
                  <td className="px-2 py-1.5">
                    <Badge
                      variant={statusVariant(row.payment_type, row.status)}
                      className="text-[10px]"
                    >
                      {statusLabel(row.payment_type, row.status)}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* 합계 행 — 실수납액 (column 12) 기준 */}
          <tfoot>
            <tr className="bg-muted/40 font-semibold">
              <td colSpan={11} className="px-2 py-1.5 text-right text-muted-foreground">
                합계
              </td>
              <td
                data-testid="sales-patient-total"
                className="whitespace-nowrap px-2 py-1.5 tabular-nums text-right"
              >
                {formatAmount(totalNetAmt)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-1 text-right text-xs text-muted-foreground">{filtered.length}건</p>

      {selected && (
        <PatientDetailModal row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
