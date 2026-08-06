/**
 * T-20260805-foot-DAYCLOSE-AC3-DXGUBUN-POPUP
 * 일마감 > 결제내역(CRM 수납) 탭 — [시술명] 셀 클릭 → 수납 상세 팝업.
 *
 * scope: view-layer only (db_change:false). 신규 스키마·입력란 없음.
 *   기존 수납 상세 UX(매출집계>환자별 탭 SalesPatientTab.PatientDetailModal, 스크린샷 F0BN57QDZFB)를
 *   payment_id 키로 재사용(self-fetch). SalesPatientTab 은 미export·PatientRow 결합이라 stomp 회피 위해
 *   동일 presentation 을 payment 단건 self-fetch 형태로 재현(reuse-by-pattern).
 *
 * 상병명 상단연동 (planner MSG-73yk/2no0 refinement):
 *   결제 미니창(PaymentMiniWindow)에서 선택되어 저장된 상병명 = claim_diagnoses(payment_id anchor)
 *   를 팝업 상단에 연동표시. 신규 write 0 (read-only).
 * [구분] = check_in_services.services.category (기본/풋케어/검사/상병/처방약) display-only.
 *
 * 상병코드 섹션분리 (T-20260806-foot-SUSUDETAIL-DXCODE-SECTION-SPLIT):
 *   category='상병' 서비스 = 상단 [상병코드] 전용 섹션(diagServices, >0일 때만).
 *   시술 오더 목록 = 상병 제외(treatServices, category!=='상병'). 순수 view 재구성, write 0.
 *
 * READ-ONLY 뷰: 편집·저장 없음 → DAYCLOSE 확정 편집잠금(T-20260730)과 무관.
 */

import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatAmount, chartNoBadge } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ─── 타입 (SalesPatientTab 수납상세 모달과 동일 shape, payment 단건) ───────────

interface ServiceChargeSummary {
  copayment_amount: number;
  insurance_covered_amount: number;
  exempt_amount: number;
}

interface ClaimDiagnosis {
  disease_code: string;
  disease_name: string | null;
}

interface SusuDetailRow {
  id: string;
  accounting_date: string | null;
  payment_type: string | null;
  amount: number;
  method: string | null;
  tax_type: string | null;
  claim_diagnoses: ClaimDiagnosis[] | null;
  check_ins: {
    visit_type: string | null;
    customer_name: string | null;
    customers: { chart_number: string | null } | null;
    check_in_services: {
      services: { name: string | null; category: string | null } | null;
    }[] | null;
    service_charges: ServiceChargeSummary[] | null;
  } | null;
}

// ─── 헬퍼 (SalesPatientTab 과 동일) ──────────────────────────────────────────

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

function calcTaxableSupply(amount: number, taxType: string | null): number {
  if (taxType === '과세_비급여') return Math.round(amount / 1.1);
  return 0;
}

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

// ─── 모달 ────────────────────────────────────────────────────────────────────

export function PaymentSusuDetailModal({
  paymentId,
  onClose,
}: {
  paymentId: string;
  onClose: () => void;
}) {
  const { data: row, isLoading } = useQuery<SusuDetailRow | null>({
    queryKey: ['closing-susu-detail', paymentId],
    enabled: !!paymentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, accounting_date, payment_type, amount, method, tax_type,
          claim_diagnoses(disease_code, disease_name),
          check_ins(
            visit_type, customer_name,
            customers(chart_number),
            check_in_services(services(name, category)),
            service_charges(copayment_amount, insurance_covered_amount, exempt_amount)
          )
        `)
        .eq('id', paymentId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as SusuDetailRow | null;
    },
  });

  const ci = row?.check_ins ?? null;
  const services = ci?.check_in_services ?? [];
  // 상병코드(category='상병')는 별도 전용 섹션, 시술오더 목록에서는 제외 (AC-1/AC-2)
  const treatServices = services.filter((s) => s.services?.category !== '상병');
  const diagServices = services.filter((s) => s.services?.category === '상병');
  const isRefund = row?.payment_type === 'refund';
  const netAmt = row ? (isRefund ? -row.amount : row.amount) : 0;
  const charges = sumCharges(ci?.service_charges);
  const taxableSupply = row ? calcTaxableSupply(row.amount, row.tax_type) : 0;
  const hasChargeDetail =
    charges.copayment > 0 || charges.covered > 0 || charges.exempt > 0 || taxableSupply > 0;
  const diagnoses = row?.claim_diagnoses ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="closing-susu-detail-modal">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2 flex-wrap">
            <span>수납 상세 — {ci?.customer_name ?? '—'}</span>
            <span className="text-xs font-mono font-normal text-teal-600">
              {chartNoBadge(ci?.customers?.chart_number ?? null)}
            </span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">불러오는 중…</div>
        ) : !row ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            수납 상세를 불러올 수 없습니다.
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {/* 상병명 상단연동 (결제 미니창 선택값 = claim_diagnoses) — 최상단 배치 */}
            {diagnoses.length > 0 && (
              <div
                data-testid="closing-susu-detail-diagnosis"
                className="rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-teal-700">상병명 </span>
                {diagnoses
                  .map((d) => `${d.disease_code}${d.disease_name ? ` (${d.disease_name})` : ''}`)
                  .join(', ')}
              </div>
            )}

            {/* 상병코드 전용 섹션 (services.category='상병') — teal 박스 아래 상단 배치 (AC-2) */}
            {diagServices.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground">상병코드</div>
                {diagServices.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded border px-2 py-1 text-xs"
                    data-testid="closing-susu-detail-dxcode"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-teal-500" />
                    <span>{s.services?.name ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}

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
                {row.accounting_date ?? '—'}
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
            </div>

            {/* 원천 영수증 — 수가 내역 */}
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

            {/* 시술 오더 (상병 제외 = treatServices, services.category = [구분] display-only) */}
            {treatServices.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground">시술 오더</div>
                {treatServices.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded border px-2 py-1 text-xs"
                    data-testid="closing-susu-detail-order"
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
