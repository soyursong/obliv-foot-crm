import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
// T-20260809-foot-CLOSING-PAYSUBTAB-PERSIST-HASHUNIFY: 주탭/서브탭 모두 URL query(?tab=/?paytab=) 단일 축으로 통일(재사용).
import { useTabParam } from '@/hooks/useTabParam';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from '@/lib/toast';
import * as XLSX from 'xlsx';
import {
  Clock,
  CreditCard,
  Download,
  FileDown,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Trash2,
  Unlock,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { isStaffUnlockRole, canEditConfirmedClosing, canViewTherapistSales as canViewTherapistSalesRole, canViewClosingTotalRevenue } from '@/lib/permissions';
import { getClinic } from '@/lib/clinic';
import { formatAmount, formatPhone, chartNoBadge } from '@/lib/format';
import { METHOD_KO, STATUS_KO, VISIT_TYPE_KO, staffRoleSortIndex } from '@/lib/status';
// T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL: 일일 미수금 박스 — footBilling outstanding SSOT 재사용(신규 산출 0)
import { loadCustomerOutstanding } from '@/lib/footBilling';
// T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC (옵션A): 수기입력 → 정본 write-path 연동(단일 SSOT)
import { recordManualPayment, type ManualPayAttribution, type ManualPayCheckIn, type PaymentSplit } from '@/lib/manualPaymentWritePath';
import type { CheckIn, CheckInStatus, Clinic, Staff, VisitType } from '@/lib/types';
// ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3) — 플랜A(단말기 직결) 환불 버튼 + 짝맞춤 판별자.
import CbandTerminalCancelButton, { isPlanACardPayment } from '@/components/CbandTerminalCancelButton';
import CbandPayInfoButton from '@/components/CbandPayInfoButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/AmountInput';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PaymentMiniWindow } from '@/components/PaymentMiniWindow';
import { ReceiptUpload } from '@/components/ReceiptUpload';
// T-20260708-foot-REDPAY-CLOSING-TAB: 결제 탭 하위 '레드페이' 하위탭 (카드단말기 자동수집 대조)
import { RedpayReconcileTab } from '@/components/closing/RedpayReconcileTab';
import { ReceiptSettlementTab } from '@/components/closing/ReceiptSettlementTab';
// T-20260805-foot-DAYCLOSE-AC3-DXGUBUN-POPUP: [시술명] 셀 클릭 → 수납 상세 팝업(view-layer only)
import { PaymentSusuDetailModal } from '@/components/closing/PaymentSusuDetailModal';
// T-20260808-foot-DAYCLOSE-REVENUE-COMPARE-TAB: 통계 화면의 '일자별 매출 비교(당월 vs 전월)' 데이터/컴포넌트를
//   일마감 신규 탭으로 재사용(신규 산식 창작 금지·기존 SSOT 그대로 소비). staffBreakdown(실장 개인성과)은 미노출.
import MonthlyComparisonSection from '@/components/stats/MonthlyComparisonSection';
// T-20260809-foot-DAYCLOSE-TOTALREVENUE-REDESIGN: 통계>MTM매출 [이번달 목표매출]·[실장별 일별매출] 뷰 재사용(신규 산식 창작 0).
import MonthlyTargetSection from '@/components/stats/MonthlyTargetSection';
import { fetchMonthlyComparison, fetchStaffDailyBreakdown, type MonthlyComparison, type StaffDailyBreakdown } from '@/lib/mtmSales';
// T-20260819-foot-DAYCLOSE-TOTALREV-EXCEL-DOWNLOAD: '총 매출' 표(일자별비교·실장별일별) 화면표시값 그대로 .xlsx.
import { buildMonthlyCompareSheet, buildStaffDailySheet, downloadRevenueWorkbook, compactDate, type RevenueSheetSpec } from '@/lib/closingRevenueExport';
// T-20260811-foot-SALESAGG-THERAPIST-TAB: 매출집계>담당치료사별(SalesStaffTab)을 일마감 신규 탭으로 미러(내용 그대로 연동).
//   기존 컴포넌트/산식/필터 그대로 재사용 — 신규 산식/쿼리 창작 0. 필터바도 매출집계와 동일 UX(기간·검색).
import { SalesStaffTab } from '@/components/sales/SalesStaffTab';
import { SalesFilterBar, defaultSalesFilter, type SalesFilterState } from '@/components/sales/SalesFilterBar';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────────

type Method = 'card' | 'cash' | 'transfer' | 'membership';
type PaymentType = 'payment' | 'refund';

interface PaymentRow {
  /** T-20260522-foot-CLOSING-REFUND: 환불 RPC 호출용 */
  id: string;
  amount: number;
  method: Method;
  payment_type: PaymentType;
  created_at: string;
  customer_id: string | null;
  installment: number | null;
  memo: string | null;
  check_in_id: string | null;
  /** T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE: soft-delete/cancel 상태 */
  status?: string | null;
  /** T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세/현금영수증 */
  cash_receipt_issued?: boolean | null;
  cash_receipt_type?: string | null;
  taxable_amount?: number | null;
  tax_exempt_amount?: number | null;
  /** T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불행 → 원결제행 링크(단건). 환불(refund) 행에서만 채워짐. */
  linked_payment_id?: string | null;
  /** T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY: 결제/환불 처리 직원(payments.created_by). 과거행 NULL. */
  created_by?: string | null;
  /** T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY: user_profiles!payments_created_by_fkey embed(name). NULL=미기록. */
  processor?: { name: string | null } | null;
  // ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3): 플랜A 짝맞춤 판별자(payments 축).
  payment_attempt_id?: string | null;
  external_approval_no?: string | null;
  accounting_date?: string | null;
}

interface PackagePaymentRow {
  /** T-20260522-foot-CLOSING-REFUND: package_payments row id */
  id: string;
  /** T-20260522-foot-CLOSING-REFUND: refund_package_atomic에 전달할 packages.id */
  package_id: string;
  amount: number;
  method: 'card' | 'cash' | 'transfer';
  payment_type: PaymentType;
  created_at: string;
  /** T-20260805-foot-DAYCLOSE-PAYHIST-PACKAGE-MISSING: 매출 인식(판매)일 = accounting_date(INSERT 트리거 세팅).
   *  담당실장별 매출집계(SalesDoctorTab/SalesDailyTab)가 이 컬럼으로 집계 → 결제내역 리스트도 동일 축으로 정합(AC-2).
   *  prod census: package_payments 전건 non-null(refund 포함). NULL이면 created_at 폴백. */
  accounting_date: string | null;
  customer_id: string;
  installment: number | null;
  memo: string | null;
  /** T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불행 → 원결제행 링크(패키지). 환불(refund) 행에서만 채워짐. */
  parent_payment_id?: string | null;
  /** T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY: 환불 처리 직원(package_payments.created_by). refund_package_payment auth.uid() 캡처. 과거행 NULL. */
  created_by?: string | null;
  /** T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY: user_profiles!package_payments_created_by_fkey embed(name). NULL=미기록('—'). */
  processor?: { name: string | null } | null;
  // ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3): 플랜A 짝맞춤 판별자(package_payments 축).
  payment_attempt_id?: string | null;
  external_approval_no?: string | null;
}

interface UnpaidCheckIn {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  status: string;
  checked_in_at: string;
  // T-20260612-foot-CHARTNO-B2-P2: 경고카드 환자명 단독 노출 0 — 차트번호 인접 표기용 embed(읽기 전용)
  customers?: { chart_number: string | null } | null;
}

interface DailyClosingRow {
  id: string;
  clinic_id: string;
  close_date: string;
  package_card_total: number;
  package_cash_total: number;
  package_transfer_total: number;
  single_card_total: number;
  single_cash_total: number;
  single_transfer_total: number;
  actual_card_total: number;
  actual_cash_total: number;
  actual_transfer_total: number;
  difference: number;
  status: 'open' | 'closed';
  closed_at: string | null;
  memo: string | null;
}

interface CheckInDetail {
  id: string;
  customer_name: string;
  visit_type: string;
  // T-20260522-foot-CLOSING-PAY-3COL: consultant_id 제거 — assigned_staff_id 단일 소스 확정
  customer_id: string | null;
}

interface CustomerBasic {
  id: string;
  name: string;
  chart_number: string | null;
  // T-20260522-foot-DAILY-SETTLE-STAFF: 2번차트 고객정보 확정
  // lead_source → visit_route (customers.visit_route 실제 컬럼)
  visit_route: string | null;
  // T-20260522-foot-DAILY-SETTLE-STAFF: 초진/재진 — customers.visit_type (2번차트 고객정보)
  visit_type: string | null;
  // T-20260510-foot-C21-STAFF-REVENUE: 담당자 매출 자동연동
  assigned_staff_id: string | null;
}

interface ManualPaymentRow {
  id: string;
  clinic_id: string;
  close_date: string;
  pay_time: string | null;
  chart_number: string | null;
  customer_name: string;
  lead_source: string | null;
  visit_type: string | null;
  staff_name: string | null;
  amount: number;
  method: string;
  memo: string | null;
  created_at: string;
}

/** T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 후 수정 이력 행(closing_edit_log) */
interface ClosingEditLogRow {
  id: string;
  edited_by: string | null;
  edited_at: string;
  op_kind: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  revision_after: number;
  editor?: { name: string | null } | null;
}

/** 결제내역 탭에서 표시되는 통합 행 */
interface EnrichedRow {
  sort_key: string;
  pay_date: string;          // YYYY-MM-DD (날짜 컬럼용)
  pay_time: string;
  chart_number: string | null;
  customer_name: string;
  lead_source: string | null;
  visit_type_label: string;
  staff_name: string | null;
  /** T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY: 실제 결제/환불 처리자(payments.created_by→user_profiles.name).
   *  ⚠ staff_name(=customers.assigned_staff_id 고객 배정담당)과 다른 축. 환불 이력 처리자 컬럼 전용.
   *  단건=payments.processor 승계 / 패키지=package_payments.processor 승계(T-20260727-ACTOR-HISTORY) / 수기=null. NULL=미기록('—'). */
  processor_name?: string | null;
  amount: number;
  method: string;
  payment_type: PaymentType;
  source: 'payment' | 'package' | 'manual';
  manual_id?: string;
  /** 수기 수정용 raw entry */
  manual_raw?: ManualPaymentRow;
  /** T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세/현금영수증 */
  taxable_amount: number | null;
  tax_exempt_amount: number | null;
  cash_receipt_issued: boolean | null;
  cash_receipt_type: string | null;
  /** T-20260522-foot-CLOSING-REFUND: 환불 처리용 */
  payment_id?: string;       // source === 'payment' 시 payments.id
  // T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING: 진료비/단건 heuristic 구분용(payments.check_in_id 유무).
  //   check_in_id 有 → 진료(내원)에 종속된 수납 = '진료비', null → 내원 비종속 별도결제 = '단건'.
  //   ⚠ 확정 비즈니스 카테고리 필드는 스키마에 없음 → planner FOLLOWUP(scenario_missing) 로 구분키 확인 요청.
  //   (표기 label 전용 — money-path(환불 금액)는 행별 amount 로 산출하므로 heuristic 오분류돼도 금액 무영향)
  pay_check_in_id?: string | null;
  package_id?: string;       // source === 'package' 시 packages.id (legacy)
  // T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH: 선택 결제행 단위 환불(refund_package_payment)용
  pkg_payment_id?: string;   // source === 'package' 시 package_payments.id (환불 대상 결제행)
  row_customer_id?: string;  // 원결제행 customer_id (표시용)
  // ── T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불 = 기존 행 annotate ──
  //   환불행을 별도 빨간 새 행으로 그리지 않고, 원결제행 안에 '환불' 표기 + 두 시각을 병기한다.
  /** 이 행이 환불(refund)이며 원결제행에 병합됨 → 표시 경로에서 렌더 스킵(합계 reduce 에는 그대로 남아 net 유지). */
  merged_refund?: boolean;
  /** 이 행(원결제)이 환불된 결제임 → '환불' 표기 노출. */
  refunded?: boolean;
  /** 환불 신청 시각(원결제행 표시용). 결제 업로드 시각은 기존 pay_date/pay_time. */
  refund_date?: string | null;
  refund_time?: string | null;
  /** 원결제행에 병합된 환불 총액(양수 합). */
  refund_amount?: number;
  /** T-20260805-foot-CLOSING-PAYDETAIL-REFUND-PROCESSOR-DISPLAY: 원결제행에 병합된 환불의 실제 처리자
   *  (환불행 processor_name = payments/package_payments.created_by→user_profiles.name).
   *  ⚠ staff_name(고객 배정담당)과 별개 축 — '환불처리 직원명'. 매출집계>환자별 탭(SalesPatientTab '처리 직원명')과 parity.
   *  다건 병합 시 refund_date/time 과 동일하게 '마지막(최신) 환불'의 처리자를 표기. 미기록 → null('—'). */
  refund_processor_name?: string | null;
  /** 환불행 → 원결제행 매칭 키(단건=linked_payment_id / 패키지=parent_payment_id). */
  linked_payment_id?: string | null;
  parent_payment_id?: string | null;
  // ── ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3) 플랜A 환불 짝맞춤 판별자 ──
  //   VG-4 결정론: 플랜A(단말기 직결결제) 여부 = payment_attempt_id IS NOT NULL ∧ external_approval_no 존재
  //   (isPlanACardPayment). 이 축으로만 환불방식을 판단(구분 패키지/단건 무관). payments·package_payments 양쪽 착지.
  /** CAT-origin 판별자(FK). NOT NULL = 플랜A(단말기 직결) 결제행. */
  payment_attempt_id?: string | null;
  /** 원거래 승인번호(AUTHNO) — 취소 전문 ORI_AUTHNO. */
  external_approval_no?: string | null;
  /** 매출일자 앵커(ISO) — 취소 전문 ORI_DATE 파생. */
  row_accounting_date?: string | null;
  /** 원거래 할부 개월(취소 HALBU=원거래 동일값). */
  pay_installment?: number | null;
}

// ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3/VG-4) — 결제행이 플랜A(단말기 직결결제)인지 결정론 판별.
//   payment_attempt_id(CAT-origin FK) ∧ external_approval_no(AUTHNO) 존재 = 플랜A. 구분(패키지/단건) 무관, 결제방식으로만 판단.
//   이 판별로 '기존 환불' vs '플랜A 환불' 버튼의 활성/비활성을 강제(안내문 아닌 disabled 강제).
function rowIsPlanAPayment(r: EnrichedRow): boolean {
  return isPlanACardPayment({
    id: '',
    amount: r.amount,
    external_approval_no: r.external_approval_no ?? null,
    payment_attempt_id: r.payment_attempt_id ?? null,
  });
}

const LEAD_SOURCE_OPTIONS = ['TM', '인바운드', '워크인', '지인소개', '온라인', '기타'];
const VISIT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: '초진' },
  { value: 'returning', label: '재진' },
];

// ──────────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────────

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function dayBoundsISO(date: string): { start: string; end: string } {
  return { start: `${date}T00:00:00+09:00`, end: `${date}T23:59:59+09:00` };
}

function visitTypeLabel(vt: string | null): string {
  if (!vt) return '-';
  return VISIT_TYPE_KO[vt as VisitType] ?? vt;
}

// ──────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ──────────────────────────────────────────────────────────────

export default function Closing() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  // T-20260520-foot-RBAC-MENU-EXPAND AC-1: consultant/coordinator/therapist 뷰 전용
  // T-20260620-foot-STAFF-PERM-UNLOCK-6MENU ②: 임시저장·마감확정·재오픈·수기수정·수기매출 원본보기 = 3역할 일괄 해제.
  //   isAdminOrManager(admin||manager) → STAFF_UNLOCK_ROLES(6역할). 동반 RLS 마이그(daily_closings_staff_unlock_6menu)와 FE=RLS 정합.
  //   (변수명 isAdminOrManager 유지 — 마감 쓰기 게이트 의미. canRefund 는 旣 3역할 포함이라 이 set 의 부분집합.)
  const { profile } = useAuth();
  const isAdminOrManager = isStaffUnlockRole(profile?.role);
  // T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정(closed) 후 '해제 없이 수정' 권한(admin/manager/director + payment).
  const canEditConfirmed = canEditConfirmedClosing(profile);
  // 확정 편집 모드 — 켜지면 확정 상태에서 재오픈 클릭 없이 실제정산/메모/수기수납 수정 가능(저장 시 RPC 원자 재확정).
  const [confirmedEditMode, setConfirmedEditMode] = useState(false);
  // T-20260525-foot-ROLE-PERM-CUSTOM AC-4 → 6MENU ②: 환불 처리도 동일 6역할 set(기존 admin/manager/consultant/coordinator/therapist 포함, +director).
  const canRefund = isAdminOrManager;
  // ── T-20260809-foot-DAYCLOSE-TOTALREVENUE-REDESIGN (item5, 접근권한 축소) ──
  //   '총 매출' 탭 = 매출 surface → cross_crm §12-3 EXCL-3 표준상 has_ops_authority 게이트 대상(T-20260619 RBAC).
  //   reporter(김주연 총괄) 요건 '관리자 필수 + 일반직원 중 상담실장만' = has_ops_authority(admin/manager role-implied
  //   + flag 부여된 실장급) 게이트로 정렬(planner GO_WARN 기본해석). 선행 DAYCLOSE-REVENUE-COMPARE-TAB '전직원 열람'을
  //   authorized supersede(동일 reporter=ops 권위)해 좁힘.
  //   ★lock-out-safe: DB 역배정 전(전원 admin)엔 admin escape 로 inert(전원 통과) — 역배정 시점에 비로소 실효.
  // ── T-20260820-foot-DAYCLOSE-TOTALREV-CONSULTANT-PERM-GRANT (상담실장 scoped view-grant, ADDITIVE) ──
  //   현장(김주연 총괄): 상담실장(consultant)이 총 매출 탭을 못 봄 → hasOpsAuthority 위에 consultant 만 ADDITIVE
  //   재개방. admin/manager/director(+flag) 무회귀. canViewClosingTotalRevenue = SSOT predicate(permissions.ts).
  //   ★db_change=false — 탭 소스 테이블(payments/closing_manual_payments/package_sessions/check_ins)은 consultant 가
  //     이미 summary/payments 탭에서 읽는 RLS 통과 집합. blanket RLS 해제 아님(RLS-SEAL 하드닝 비충돌).
  const canViewTotalRevenue = canViewClosingTotalRevenue(profile);

  // ── T-20260811-foot-SALESAGG-THERAPIST-TAB (권한, C2/V2 최소노출) ──
  //   김주연 총괄 확정(reply ts=1786502240.795299): 신규 '총매출(치료)' 탭 = 관리자(admin)+치료사(therapist)만 노출.
  //   ★ /sales route(RoleGuard[admin,manager,director]) 는 무변경 — therapist 를 매출집계 전체에 admit 하지 않음(worst-case
  //     blanket 노출 회피). 일마감(/admin/closing)은 이미 전직원 OPEN(AdminLayout)이라 이 신규 탭만 role 게이트로 좁힌다.
  //   manager/director 는 기존 매출집계(/sales) 열람 그대로 유지(본 탭 비노출이나 접근권 무영향).
  const canViewTherapistSales = canViewTherapistSalesRole(profile?.role);
  // '총매출(치료)' 탭 전용 필터 상태 — 매출집계(Sales.tsx)와 동일 기본값(defaultSalesFilter: 이번 달). 독립 로컬 상태.
  const [therapistSalesFilter, setTherapistSalesFilter] = useState<SalesFilterState>(defaultSalesFilter());
  // T-20260809-foot-CLOSING-PAYSUBTAB-PERSIST-HASHUNIFY (부모 T-20260808-foot-CRM-REFRESH-ROUTE-PERSIST AC-2 자식):
  //   [RC] 주탭(summary/payments/compare)은 구 URL hash(#payments/#compare) 기반, 서브탭(paySubTab)은 useState 만
  //     관리 → 서브탭이 새로고침(F5)에 첫 탭으로 리셋. hash 와 query(?paytab=) 를 병행하면 react-router
  //     navigate/setSearchParams 가 서로의 hash·search 를 상호 소거(stomp)해 서브탭 유지가 구조적으로 불가.
  //   [Fix] 주탭 라우팅 mechanism 을 hash → query(?tab=) 로 통일(useTabParam 재사용, 부모 티켓의 서브탭 훅과 동일 축).
  //     이로써 서브탭도 같은 query 축(?paytab=)에 실어 stomp 를 제거하고 새로고침/딥링크에 함께 유지된다.
  //     기존 #payments/#compare 딥링크·북마크는 아래 레거시 호환 리다이렉트(1회 이관)로 회귀 방지.
  // T-20260811-foot-SALESAGG-THERAPIST-TAB: 신규 최상위 탭 'therapist_sales'(총매출(치료)) 추가.
  //   매출집계>담당치료사별(SalesStaffTab) 미러(내용 그대로 연동). admin+therapist 한정 노출(아래 canViewTherapistSales).
  const [tab, setTab] = useTabParam<'summary' | 'payments' | 'compare' | 'therapist_sales'>({
    key: 'tab',
    valid: ['summary', 'payments', 'compare', 'therapist_sales'],
    fallback: 'summary',
  });
  // T-20260708-foot-REDPAY-CLOSING-TAB / T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD:
  //   결제 탭 하위탭(CRM 수납 / 레드페이 / 영수증 수납). 기본=CRM 수납.
  //   T-20260809-HASHUNIFY: 주탭 query 통일로 stomp 해소 → paySubTab 도 URL query(?paytab=) 에 반영해
  //   새로고침/딥링크 유지. 유효값 화이트리스트로 딥링크 오염 방어.
  const [paySubTab, setPaySubTab] = useTabParam<'crm' | 'redpay' | 'receipt'>({
    key: 'paytab',
    valid: ['crm', 'redpay', 'receipt'],
    fallback: 'crm',
  });

  // ── 레거시 hash 딥링크 호환 리다이렉트 (#payments/#compare → ?tab=) ──
  //   기존 북마크/딥링크(#payments, #compare)로 진입 시 1회 query 로 이관하고 hash 를 제거한다.
  //   단일 navigate(pathname+search+hash 동시 지정)로 처리해 hash↔search stomp 를 원천 차단.
  //   이미 ?tab= 가 있으면 query 우선(hash 무시) — 신규 링크와 충돌 없음. 마운트 1회만.
  useEffect(() => {
    const h = location.hash;
    if (h !== '#payments' && h !== '#compare') return;
    const legacy = h === '#payments' ? 'payments' : 'compare';
    const params = new URLSearchParams(location.search);
    if (!params.get('tab')) params.set('tab', legacy);
    navigate(
      { pathname: location.pathname, search: params.toString(), hash: '' },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── T-20260809-foot-DAYCLOSE-TOTALREVENUE-REDESIGN (item5, NAV-BOUNCE parity) ──
  //   총매출 탭 트리거는 canViewTotalRevenue 시에만 노출하지만, 직접 URL(?tab=compare) 딥링크로 진입할 수 있어
  //   권한 없는 계정이 compare 탭에 착지하면 요약 탭으로 바운스(탭 숨김 + 직접접근 차단 둘 다 = NAV-BOUNCE 패리티).
  //   lock-out-safe: 전원 admin 환경에선 canViewTotalRevenue=true 라 바운스 없음(inert).
  useEffect(() => {
    if (tab === 'compare' && !canViewTotalRevenue) setTab('summary');
  }, [tab, canViewTotalRevenue, setTab]);

  // T-20260811-foot-SALESAGG-THERAPIST-TAB: '총매출(치료)' 탭도 동일 NAV-BOUNCE 패리티 —
  //   트리거 숨김 + 직접 URL(?tab=therapist_sales) 딥링크 차단(권한 없는 계정은 요약 탭으로 바운스).
  useEffect(() => {
    if (tab === 'therapist_sales' && !canViewTherapistSales) setTab('summary');
  }, [tab, canViewTherapistSales, setTab]);

  const [date, setDate] = useState(todayStr());
  const [actualCard, setActualCard] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [actualTransfer, setActualTransfer] = useState(0);
  const [memo, setMemo] = useState('');
  const [payTarget, setPayTarget] = useState<CheckIn | null>(null);
  // T-20260616-foot-CLOSING-PAYWAIT-PMW-SWAP: 같은 checkIn 연속 재결제 시 강제 리마운트 (Dashboard BUG4 패턴)
  const [payAttemptCounter, setPayAttemptCounter] = useState(0);
  const [showManualDialog, setShowManualDialog] = useState(false);
  /** 수기 수정 대상 (null이면 신규 추가 모드) */
  const [manualEditTarget, setManualEditTarget] = useState<ManualPaymentRow | null>(null);
  /** C2-MANAGER-PAYMENT-MAP: 결제내역 담당자 필터 */
  const [staffFilter, setStaffFilter] = useState('');
  /** T-20260530-foot-CLOSING-PAYMETHOD-FILTER: 결제내역 결제수단 필터 ('' = 전체) */
  const [methodFilter, setMethodFilter] = useState('');
  /** T-20260819-foot-CLOSING-TERMINAL-FILTER: 결제내역 단말기(레드페이 TID) 필터 ('' = 전체).
   *  담당자·결제수단과 AND 결합. TID→결제 매핑은 read-only 뷰(v_redpay_reconciliation_daily)에서만 파생. */
  const [terminalFilter, setTerminalFilter] = useState('');
  /** T-20260522-foot-CLOSING-REFUND: 환불 처리 대상 결제 행
   *  T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT: 단일행 → 고객의 환불 가능 행 묶음(배열).
   *    환불창이 유형별(패키지/진료비/단건) 구분 표기 + 항목 선택(체크박스) UI 로 확장됨. */
  const [refundTarget, setRefundTarget] = useState<EnrichedRow[] | null>(null);
  // T-20260805-foot-DAYCLOSE-AC3-DXGUBUN-POPUP: [시술명] 셀 클릭 시 수납 상세 팝업 대상 payment_id
  const [susuDetailPaymentId, setSusuDetailPaymentId] = useState<string | null>(null);

  /** T-20260525-foot-CLOSING-NAV-BUG AC-4: 결제내역 테이블 스크롤 위치 보존 */
  const paymentsTableRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);

  const { data: clinic } = useQuery<Clinic | null>({
    queryKey: ['clinic'],
    queryFn: () => getClinic(),
  });

  const { start, end } = useMemo(() => dayBoundsISO(date), [date]);

  // ── 단건 결제 ───────────────────────────────────────────────
  const { data: payments = [] } = useQuery<PaymentRow[]>({
    queryKey: ['closing-payments', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        // T-20260522-foot-CLOSING-REFUND: id 추가 (환불 RPC 호출용)
        // T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: linked_payment_id 추가(환불행→원결제행 annotate 매칭용)
        // T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY: created_by + processor JOIN 추가(SalesPatientTab 패턴 REUSE).
        //   환불 이력 '처리자' = payments.created_by(refund_single_payment RPC 캡처) → user_profiles.name.
        //   FK 기본명 payments_created_by_fkey (prod 확인·20260717140000 마이그 dryrun §2 검증필). 과거행 NULL → '—'.
        .select('id, amount, method, payment_type, created_at, customer_id, installment, memo, check_in_id, status, cash_receipt_issued, cash_receipt_type, taxable_amount, tax_exempt_amount, linked_payment_id, created_by, payment_attempt_id, external_approval_no, accounting_date, processor:user_profiles!payments_created_by_fkey(name)')
        .eq('clinic_id', clinic!.id)
        .gte('created_at', start)
        .lte('created_at', end)
        // T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE: 삭제된 수납은 일마감 집계에서 제외
        .neq('status', 'deleted')
        .order('created_at', { ascending: true });
      if (error) throw error;
      // T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY: processor embed 은 PostgREST 생성타입상 배열추론 →
      //   many-to-one 실런타임은 객체(or null). SalesPatientTab 과 동형으로 unknown 경유 cast.
      return (data ?? []) as unknown as PaymentRow[];
    },
  });

  // ── 패키지 결제 (created_at 축 — 일마감 합계/확정 전용) ─────────────────────
  //   ★ T-20260805-foot-DAYCLOSE-PAYHIST-PACKAGE-MISSING: 이 쿼리는 created_at KST 윈도잉을 '의도적으로' 유지한다.
  //     일마감 확정 totals(package_card_total 등 → daily_closings write, L1192)와 마감 전령 payload는
  //     CLOSING-HERALD-PAYLOAD-RECONCILE(deployed)의 INV5 하드게이트(system_totals==daily_closings 3중 대조,
  //     윈도잉=created_at KST)에 바인딩돼 있어, 축을 바꾸면 확정 emit-fail/DLQ 회귀. 따라서 합계/확정 축은 불변.
  //     결제내역 '리스트' 표시 누락은 아래 pkgPaymentsForList(accounting_date 축)로 별도 해소(합계 축과 분리).
  const { data: pkgPayments = [] } = useQuery<PackagePaymentRow[]>({
    queryKey: ['closing-pkg-payments', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('package_payments')
        // T-20260522-foot-CLOSING-REFUND: id, package_id 추가 (환불 RPC 호출용)
        // T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: parent_payment_id 추가(패키지 환불행→원결제행 annotate 매칭용)
        // T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY: created_by + processor JOIN 추가(단건 PROCESSOR-DISPLAY 패턴 형제 복제).
        //   환불 이력 '처리자' = package_payments.created_by(refund_package_payment RPC auth.uid() 캡처) → user_profiles.name.
        //   FK 기본명 package_payments_created_by_fkey (마이그 20260727210000 dryrun §2 검증필). 과거행 NULL → '—'(forward-only).
        //   read-side 노출은 user_profiles RLS(단건 payments.created_by 경로와 동일 정책) 재사용 → parity·신규표면 0.
        .select('id, package_id, amount, method, payment_type, created_at, customer_id, installment, memo, parent_payment_id, created_by, processor:user_profiles!package_payments_created_by_fkey(name)')
        .eq('clinic_id', clinic!.id)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY: processor embed 은 PostgREST 생성타입상 배열추론 →
      //   many-to-one 실런타임은 객체(or null). 단건(PaymentRow) 과 동형으로 unknown 경유 cast.
      return (data ?? []) as unknown as PackagePaymentRow[];
    },
  });

  // ── 패키지 결제 (accounting_date 축 — 결제내역 '리스트' 표시 전용) ──────────────
  //   T-20260805-foot-DAYCLOSE-PAYHIST-PACKAGE-MISSING (AC-1/AC-2):
  //     [증상] 일마감 결제내역 리스트에 '당일 패키지(선수금) 결제'가 누락 → 정산 금액 불일치.
  //     [RC]   위 pkgPayments(created_at 축)로 리스트를 그려, 매출 인식일(accounting_date, INSERT 트리거 세팅)이
  //            created_at 일자와 다른 선수금/익일마감 귀속 결제(prod census 7/134건)를 리스트에서만 탈락시킴.
  //            담당실장별 매출집계(SalesDoctorTab/SalesDailyTab)는 accounting_date로 집계(deployed) → divergence.
  //     [Fix]  리스트는 집계 SSOT와 동일한 accounting_date 축으로 조회 → 리스트 패키지 합 = 담당실장별 패키지 합(AC-2).
  //            prod census: accounting_date NULL 0건(refund 19건 포함 전건 채움) → 누락 리스크 없음.
  //     ★ payments(단건)는 AC-3(일반결제·환불 행 불변) 준수 위해 created_at 유지 — 본 티켓 스코프 밖.
  //     ★ 이중기록 없음(AC-3): 패키지 판매는 회차1=payments / 회차2+=package_payments 로 상호배타(PKGCLASS-SESSION1-SINGLE),
  //       source 태그로 구분되어 UNION 중복 불가 → dedup 불요.
  const { data: pkgPaymentsForList = [] } = useQuery<PackagePaymentRow[]>({
    queryKey: ['closing-pkg-payments-list', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('package_payments')
        .select('id, package_id, amount, method, payment_type, created_at, accounting_date, customer_id, installment, memo, parent_payment_id, created_by, payment_attempt_id, external_approval_no, processor:user_profiles!package_payments_created_by_fkey(name)')
        .eq('clinic_id', clinic!.id)
        .eq('accounting_date', date)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PackagePaymentRow[];
    },
  });

  // ── T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT [FOLD]: 전 기간 환불 합계 ──
  //   AC-B1/AC-B2: 완전환불행 재환불 차단 + 교차일(원결제일≠환불일) 환불 배지.
  //   당일 표시되는 원결제행(payments/package_payments)에 연결된 환불을 '날짜 필터 없이' 조회해
  //   원결제 id 별 누적 환불액을 산출한다(같은날 병합 로직은 당일만 보므로 교차일 누락을 이 쿼리가 보완).
  //   ★ read-only 조회만 — schema/서버/데이터 무접점. 합계(net) reduce 경로는 건드리지 않음(무회귀).
  const origPayIds = useMemo(
    () => payments.filter(p => p.payment_type !== 'refund').map(p => p.id),
    [payments],
  );
  // T-20260805-foot-DAYCLOSE-PAYHIST-PACKAGE-MISSING: 리스트 행의 교차일 환불 누적은 리스트 소스(accounting_date) 기준.
  const origPkgPayIds = useMemo(
    () => pkgPaymentsForList.filter(p => p.payment_type !== 'refund').map(p => p.id),
    [pkgPaymentsForList],
  );
  const { data: refundTotalsAllDates = {} } = useQuery<Record<string, number>>({
    queryKey: ['closing-refund-alldates', clinic?.id, origPayIds, origPkgPayIds],
    enabled: !!clinic && (origPayIds.length > 0 || origPkgPayIds.length > 0),
    queryFn: async () => {
      const map: Record<string, number> = {};
      if (origPayIds.length > 0) {
        const { data } = await supabase
          .from('payments')
          .select('linked_payment_id, amount')
          .eq('clinic_id', clinic!.id)
          .eq('payment_type', 'refund')
          .neq('status', 'deleted')
          .in('linked_payment_id', origPayIds);
        for (const r of (data ?? []) as { linked_payment_id: string | null; amount: number | null }[]) {
          if (r.linked_payment_id) map[`pay:${r.linked_payment_id}`] = (map[`pay:${r.linked_payment_id}`] ?? 0) + (r.amount ?? 0);
        }
      }
      if (origPkgPayIds.length > 0) {
        const { data } = await supabase
          .from('package_payments')
          .select('parent_payment_id, amount')
          .eq('clinic_id', clinic!.id)
          .eq('payment_type', 'refund')
          .in('parent_payment_id', origPkgPayIds);
        for (const r of (data ?? []) as { parent_payment_id: string | null; amount: number | null }[]) {
          if (r.parent_payment_id) map[`pkg:${r.parent_payment_id}`] = (map[`pkg:${r.parent_payment_id}`] ?? 0) + (r.amount ?? 0);
        }
      }
      return map;
    },
  });

  // ── T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET: 원결제 method linkage 조회 (revenue-basis) ──
  //   DA da_decision_foot_closing_cashsum_revenue_basis_rebucket_20260820 (Q4·code-gate 오라클 #3):
  //     revenue-basis 재버킷의 원결제 method read-source = payment-linkage(단건 linked_payment_id /
  //     패키지 parent_payment_id → 원결제 charge.method) UNIFORM. pre-B-1 저장 refund.method 는 Axis-B
  //     (실지급 오염값)이라 절대 신뢰 금지 → 반드시 linkage 조인으로 원결제 method 복구(cutover-safe).
  //   ★ 당일 로드(payments/pkgPayments)는 created_at 축이라 '교차일 환불'(원결제가 과거일)은 당일 맵에 없다.
  //     census(READ-ONLY, 2026-08-20): 교차수단 환불 4건 중 1건(패키지 07-28 환불→07-20 이체 원결제)이 교차일
  //     → 당일 맵 미해결. 이 쿼리로 당일 환불행의 원결제 method 를 날짜 무관 조회(linkage-uniform 완결).
  //   ★ read-only SELECT 만 — schema/서버/데이터 무접점. daily_closings persist·payload·A6 무접촉(표시 projection).
  const refundSingleLinkIds = useMemo(
    () => Array.from(new Set(payments.filter(p => p.payment_type === 'refund' && p.linked_payment_id).map(p => p.linked_payment_id as string))),
    [payments],
  );
  const refundPkgLinkIds = useMemo(
    () => Array.from(new Set(pkgPayments.filter(p => p.payment_type === 'refund' && p.parent_payment_id).map(p => p.parent_payment_id as string))),
    [pkgPayments],
  );
  const { data: origMethodMap = { single: {}, pkg: {} } } = useQuery<{ single: Record<string, string>; pkg: Record<string, string> }>({
    queryKey: ['closing-refund-orig-method', clinic?.id, refundSingleLinkIds, refundPkgLinkIds],
    enabled: !!clinic && (refundSingleLinkIds.length > 0 || refundPkgLinkIds.length > 0),
    queryFn: async () => {
      const single: Record<string, string> = {};
      const pkg: Record<string, string> = {};
      if (refundSingleLinkIds.length > 0) {
        const { data } = await supabase
          .from('payments')
          .select('id, method')
          .eq('clinic_id', clinic!.id)
          .in('id', refundSingleLinkIds);
        for (const r of (data ?? []) as { id: string; method: string }[]) single[r.id] = r.method;
      }
      if (refundPkgLinkIds.length > 0) {
        const { data } = await supabase
          .from('package_payments')
          .select('id, method')
          .eq('clinic_id', clinic!.id)
          .in('id', refundPkgLinkIds);
        for (const r of (data ?? []) as { id: string; method: string }[]) pkg[r.id] = r.method;
      }
      return { single, pkg };
    },
  });

  // ── 미수 ────────────────────────────────────────────────────
  const { data: unpaid = [] } = useQuery<UnpaidCheckIn[]>({
    queryKey: ['closing-unpaid', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_name, customer_phone, status, checked_in_at, customers(chart_number)')
        .eq('clinic_id', clinic!.id)
        .eq('status', 'payment_waiting')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      // T-20260612-foot-CHARTNO-B2-P2: supabase embed customers는 배열로 추론 → unknown 경유 캐스트
      return (data ?? []) as unknown as UnpaidCheckIn[];
    },
  });

  // ── 일일 미수금 (T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL) ──────────────
  //   당일(date) payment_waiting 체크인 고객의 미수금을 footBilling SSOT(loadCustomerOutstanding)로 재사용.
  //   "당일" 윈도잉 = 화면 date 기준 미결제 체크인 고객. 금액 정의(패키지/진료비 분리)는
  //   PKG-OUTSTANDING-BALANCE §4-A를 따른다 — 합산 단일 '총 미수금' 산출/표기 금지. 신규 쿼리 외 산출 로직 0.
  const { data: dailyOutstanding = { packageDue: 0, consultationDue: 0, dueCustomerCount: 0 } } = useQuery<{
    packageDue: number; consultationDue: number; dueCustomerCount: number;
  }>({
    queryKey: ['closing-daily-outstanding', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('customer_id')
        .eq('clinic_id', clinic!.id)
        .eq('status', 'payment_waiting')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end);
      if (error) throw error;
      const ids = [...new Set(
        (data ?? [])
          .map((r: { customer_id: string | null }) => r.customer_id)
          .filter(Boolean) as string[],
      )];
      if (ids.length === 0) return { packageDue: 0, consultationDue: 0, dueCustomerCount: 0 };
      const map = await loadCustomerOutstanding(ids, clinic!.id);
      let packageDue = 0;
      let consultationDue = 0;
      let dueCustomerCount = 0;
      for (const o of map.values()) {
        const pd = o.packageDue ?? 0;
        const cd = o.consultationDue ?? 0;
        if (pd > 0 || cd > 0) dueCustomerCount += 1;
        packageDue += pd;
        consultationDue += cd;
      }
      return { packageDue, consultationDue, dueCustomerCount };
    },
  });

  // ── 시술별 통계 (raw 시술 항목) ─────────────────────────────
  // T-20260519-foot-PKG-REVENUE-SPLIT AC-2/AC-3:
  //   is_package_session=true 항목 제외 — 패키지 차감 세션은 이미 결제된 건
  // T-20260715-foot-DAYCLOSE-STAT-PAYONLY:
  //   집계(paid 필터·revenue 합산)는 아래 procedureStats useMemo로 이동.
  //   이 쿼리는 당일 체크인의 시술 raw 행만 조회한다.
  const { data: procedureServicesRaw = [] } = useQuery<{ service_name: string; price: number; check_in_id: string | null; is_package_session?: boolean | null }[]>({
    queryKey: ['closing-procedures', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_in_services')
        // is_package_session·check_in_id 포함해 JS에서 필터링 (null 안전성)
        .select('service_name, price, check_in_id, is_package_session')
        .in('check_in_id', (await supabase
          .from('check_ins')
          .select('id')
          .eq('clinic_id', clinic!.id)
          .gte('checked_in_at', start)
          .lte('checked_in_at', end)
          .then(r => (r.data ?? []).map((d: { id: string }) => d.id))
        ))
        // T-20260804-foot-COSMETIC-CORRECTION-CRM (Tier-C): 비진성 soft-void 라인 제외.
        //   DA-20260805 census C1: procedureServicesRaw = 시술별통계 표시카드(L1869)에만 feed —
        //   마감 payload/grossTotal(payment-grain 권위총액)에 미기여 → (i-payment) 확정 → filter GO(firewall breach 아님).
        //   net-0 phantom 라인 제거 = line-grain breakdown 을 payment 총액 방향으로 healing.
        .is('voided_at', null);
      if (error) throw error;
      return (data ?? []) as { service_name: string; price: number; check_in_id: string | null; is_package_session?: boolean | null }[];
    },
  });

  // ── [시술명] 컬럼 소스 (T-20260805-foot-DAYCLOSE-AC3-DXGUBUN-POPUP) ────────────
  //   결제내역(CRM 수납) 행의 [시술명] = 그 결제의 check_in 에 매인 시술 항목명(중복 제거, 콤마).
  //   procedureServicesRaw(당일 check_in_services) 를 check_in_id 기준으로 그룹핑(read-only, no db change).
  const serviceNamesByCheckIn = useMemo<Map<string, string>>(() => {
    const byCheckIn = new Map<string, string[]>();
    for (const row of procedureServicesRaw) {
      if (!row.check_in_id || !row.service_name) continue;
      const list = byCheckIn.get(row.check_in_id) ?? [];
      if (!list.includes(row.service_name)) list.push(row.service_name);
      byCheckIn.set(row.check_in_id, list);
    }
    const joined = new Map<string, string>();
    for (const [id, names] of byCheckIn) joined.set(id, names.join(', '));
    return joined;
  }, [procedureServicesRaw]);

  // ── 실수납/결제 confirmed 체크인 집합 (net>0) ────────────────
  // T-20260715-foot-DAYCLOSE-STAT-PAYONLY (A안, 김주연 총괄 결정):
  //   시술별 통계는 '완료' 상태 전환만으로는 집계하지 않고 실제 수납/결제된 건만 집계한다.
  //   AC-4 RC 확정: 환불은 payments 별도 행(payment_type='refund')으로 저장 → check_in별
  //   net = Σ(payment.amount) − Σ(refund.amount). net>0 기준(b) 채택.
  //   (payment 레코드 존재(a)는 F-4714(net=0 환불건)를 걸러내지 못하므로 부적합.)
  const paidCheckInIds = useMemo(() => {
    const net = new Map<string, number>();
    for (const p of payments) {
      if (!p.check_in_id) continue;
      net.set(p.check_in_id, (net.get(p.check_in_id) ?? 0) + (p.payment_type === 'refund' ? -p.amount : p.amount));
    }
    const set = new Set<string>();
    for (const [id, amt] of net) if (amt > 0) set.add(id);
    return set;
  }, [payments]);

  // ── 시술별 통계 (paid 필터 후 집계) ─────────────────────────
  const procedureStats = useMemo<{ service_name: string; count: number; revenue: number }[]>(() => {
    const byName: Record<string, { count: number; revenue: number }> = {};
    for (const row of procedureServicesRaw) {
      // T-20260519-foot-PKG-REVENUE-SPLIT: 패키지 세션 항목 제외
      if (row.is_package_session === true) continue;
      // T-20260715-foot-DAYCLOSE-STAT-PAYONLY: 실수납/결제 confirmed(net>0) 체크인만 집계
      if (!row.check_in_id || !paidCheckInIds.has(row.check_in_id)) continue;
      const entry = byName[row.service_name] ??= { count: 0, revenue: 0 };
      entry.count++;
      entry.revenue += row.price;
    }
    return Object.entries(byName)
      .map(([service_name, { count, revenue }]) => ({ service_name, count, revenue }))
      .sort((a, b) => b.count - a.count);
  }, [procedureServicesRaw, paidCheckInIds]);

  // ── 체크인 상세 (결제내역 탭용 enriched) ──────────────────
  const { data: checkInsDetail = [] } = useQuery<CheckInDetail[]>({
    queryKey: ['closing-checkin-detail', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_name, visit_type, customer_id')
        // T-20260522-foot-CLOSING-PAY-3COL: consultant_id 제거 — assigned_staff_id 단일 소스
        .eq('clinic_id', clinic!.id)
        .gte('checked_in_at', start)
        .lte('checked_in_at', end);
      if (error) throw error;
      return (data ?? []) as CheckInDetail[];
    },
  });

  // ── 체크인 고객 ID 수집 ────────────────────────────────────
  const customerIds = useMemo(() => {
    const ids = new Set<string>();
    payments.forEach(p => { if (p.customer_id) ids.add(p.customer_id); });
    pkgPayments.forEach(p => { if (p.customer_id) ids.add(p.customer_id); });
    // T-20260805-foot-DAYCLOSE-PAYHIST-PACKAGE-MISSING: 리스트 표시 소스(accounting_date) 고객도 customerMap 시딩
    //   (accounting_date 귀속 패키지 행의 성함/차트번호/담당자 해소 — 미시딩 시 '-' 표기 회귀 방지).
    pkgPaymentsForList.forEach(p => { if (p.customer_id) ids.add(p.customer_id); });
    checkInsDetail.forEach(c => { if (c.customer_id) ids.add(c.customer_id); });
    return [...ids].sort();
  }, [payments, pkgPayments, pkgPaymentsForList, checkInsDetail]);

  // ── 고객 기본정보 ──────────────────────────────────────────
  const { data: customersBasic = [] } = useQuery<CustomerBasic[]>({
    queryKey: ['closing-customers', clinic?.id, customerIds.join(',')],
    enabled: !!clinic && customerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, chart_number, visit_route, visit_type, assigned_staff_id')
        .in('id', customerIds);
      if (error) throw error;
      return (data ?? []) as CustomerBasic[];
    },
  });

  // ── 직원 목록 (결제담당 조회) ──────────────────────────────
  // T-20260522-foot-CLOSING-STAFF-DROP: 2번차트 1구역 담당자 드롭과 동일 쿼리/필터/정렬
  // 2번차트: .in('role', ['consultant','coordinator','director','therapist']).order('name')
  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ['staff', clinic?.id, 'closing'],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        // T-20260523-foot-PKG-DEDUCT-THERAPIST bugfix: display_name 컬럼 미존재 → 400 에러 방지
        // display_name은 UI에서 || name fallback으로 처리. migration 적용 전까지 select 제외.
        .select('id, name, role, clinic_id, active, created_at')
        .eq('clinic_id', clinic!.id)
        .eq('active', true)
        .in('role', ['consultant', 'coordinator', 'director', 'therapist'])
        .is('deleted_at', null) // T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT: 삭제 직원 제외
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });

  // ── 수기 결제내역 ──────────────────────────────────────────
  const { data: manualEntries = [] } = useQuery<ManualPaymentRow[]>({
    queryKey: ['closing-manual', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      // T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE: soft-void 무효행 제외(합산경로 (a) 일마감 grossTotal).
      //   voided_at IS NULL = 유효행만 로드 → totals(grossTotal)/enrichedRows/daily_closings payload 전부 무효행 배제.
      //   forward 프리미티브 배포 시점 전건 voided_at=NULL → 합계 불변(net-zero).
      const { data, error } = await supabase
        .from('closing_manual_payments')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', date)
        .is('voided_at', null)
        .order('pay_time', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as ManualPaymentRow[];
    },
  });

  // ── T-20260819-foot-CLOSING-TERMINAL-FILTER: 단말기(레드페이 TID) 필터 소스 ──────────────
  //   [feasibility] 신규 컬럼/스키마 0 — TID↔결제 매핑은 기존 read-only 뷰 v_redpay_reconciliation_daily
  //     (T-20260708 REDPAY-CLOSING-TAB, security_invoker=호출자 clinic RLS)의 (matched_payment_id, tid) 를
  //     그대로 소비한다. 레드페이 raw 앵커 행에서 CRM 단건 결제(payments.id)에 매칭된 단말 TID 가 표면화됨.
  //     ★ FE 조인/매칭 재계산 금지 계약 준수 — 뷰가 산출한 매칭 결과만 읽어 payment_id→tid Map 을 만든다.
  //   AC-6(레드페이 미활성/테스트모드): 뷰가 빈 목록이면 옵션 없음 → 드롭다운은 '전체'만(기존동작). 에러도 비차단([]).
  const { data: redpayTidRows = [] } = useQuery<{ matched_payment_id: string | null; tid: string | null }[]>({
    queryKey: ['closing-redpay-tidmap', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_redpay_reconciliation_daily')
        .select('matched_payment_id, tid')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', date);
      // 뷰 미배포/권한 등 어떤 에러도 일마감 화면을 막지 않는다(필터는 부가기능) → 조용히 빈 목록.
      if (error) return [];
      return (data ?? []) as { matched_payment_id: string | null; tid: string | null }[];
    },
  });

  // ── 단말기 사람용 라벨 (redpay_terminal_registry SSOT, T-20260711 REGISTRY-TABLE) ──────────
  //   terminal_label(풋(VAN)/풋(멀티)/풋(무선) 등) 을 드롭다운 표기에 사용(태블릿 가독성). authenticated read-all.
  //   미배포/에러 시 라벨 없이 TID 원문 표기로 폴백(비차단).
  const { data: terminalRegistry = [] } = useQuery<{ tid: string | null; terminal_label: string | null }[]>({
    queryKey: ['closing-redpay-terminal-registry', clinic?.id],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('redpay_terminal_registry')
        .select('tid, terminal_label')
        .eq('domain', 'foot')
        .eq('active', true);
      if (error) return [];
      return (data ?? []) as { tid: string | null; terminal_label: string | null }[];
    },
  });

  // ── 진행 중 체크인 (마감 전 경고용) ────────────────────────
  const { data: inProgress = [] } = useQuery<UnpaidCheckIn[]>({
    queryKey: ['closing-in-progress', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_name, customer_phone, status, checked_in_at, customers(chart_number)')
        .eq('clinic_id', clinic!.id)
        .not('status', 'in', '("done","cancelled","payment_waiting")')
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      // T-20260612-foot-CHARTNO-B2-P2: supabase embed customers는 배열로 추론 → unknown 경유 캐스트
      return (data ?? []) as unknown as UnpaidCheckIn[];
    },
  });

  // ── 기존 마감 레코드 ────────────────────────────────────────
  const { data: existing } = useQuery<DailyClosingRow | null>({
    queryKey: ['closing', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_closings')
        .select('*')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', date)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return (data as DailyClosingRow | null) ?? null;
    },
  });

  // ── T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 후 수정 이력(closing_edit_log) ──
  //   who/when/field/old→new/revision_after — 일마감 화면에서 바로 노출(김다인 confirm: 화면 즉시노출).
  const { data: editLog = [] } = useQuery<ClosingEditLogRow[]>({
    queryKey: ['closing-edit-log', clinic?.id, date],
    enabled: !!clinic,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('closing_edit_log')
        .select('id, edited_by, edited_at, op_kind, field, old_value, new_value, revision_after, editor:user_profiles!closing_edit_log_edited_by_fkey(name)')
        .eq('clinic_id', clinic!.id)
        .eq('close_date', date)
        .order('edited_at', { ascending: false });
      // 테이블 미배포(마이그 pre-apply) 시 조용히 빈 배열(화면 비차단).
      if (error) return [];
      return (data ?? []) as unknown as ClosingEditLogRow[];
    },
  });

  // ── T-20260808-foot-DAYCLOSE-REVENUE-COMPARE-TAB: '매출 비교' 탭 데이터 ──
  //   통계>MTM매출 02섹션 '일자별 매출 비교(당월 vs 전월)'와 동일 소스(fetchMonthlyComparison/mtmSales.ts)를
  //   그대로 재사용(신규 산식·별도 쿼리 창작 없음 = AC-2, 통계 화면과 값 동일 SSOT). refISO=선택일(date)이 속한 달 기준.
  //   ★스코프: 카드 #1(일자별 당월vs전월)만 노출 — 실장 개인성과(카드 #2)는 fetch/렌더 안 함(staff 노출 경계, AC-3).
  //   월 단위 캐시(같은 달 내 날짜 변경 시 재조회 안 함). 통계 화면(admin 전용)과 달리 일마감은 전직원 open.
  const compareMonth = date.slice(0, 7); // yyyy-MM
  const { data: monthlyCompare = null, isLoading: compareLoading } = useQuery<MonthlyComparison | null>({
    queryKey: ['closing-monthly-compare', clinic?.id, compareMonth],
    enabled: !!clinic && tab === 'compare' && canViewTotalRevenue,
    queryFn: () => fetchMonthlyComparison(clinic!.id, `${compareMonth}-01`),
  });

  // ── T-20260809-foot-DAYCLOSE-TOTALREVENUE-REDESIGN (item2·item3): 실장별 일별 매출 데이터 ──
  //   통계>MTM매출 대시보드 [실장별 일별매출] 뷰와 '동일 소스'(fetchStaffDailyBreakdown/mtmSales.ts SSOT)를 그대로
  //   재사용 — 신규 산식/쿼리 창작 0. MonthlyComparisonSection(공유 렌더러)에 staffBreakdown 으로 주입해 통계 화면과
  //   같은 표를 3번 항목으로 노출. 총매출 열람권(canViewTotalRevenue)자에게만 fetch. 월 단위 캐시(compareMonth).
  const { data: staffDaily = null, isLoading: staffDailyLoading } = useQuery<StaffDailyBreakdown | null>({
    queryKey: ['closing-staff-daily', clinic?.id, compareMonth],
    enabled: !!clinic && tab === 'compare' && canViewTotalRevenue,
    queryFn: () => fetchStaffDailyBreakdown(clinic!.id, `${compareMonth}-01`),
  });

  // ── 기존 마감 데이터로 폼 초기화 ────────────────────────────
  useEffect(() => {
    if (existing) {
      setActualCard(existing.actual_card_total ?? 0);
      setActualCash(existing.actual_cash_total ?? 0);
      setActualTransfer(existing.actual_transfer_total ?? 0);
      setMemo(existing.memo ?? '');
    } else {
      setActualCard(0);
      setActualCash(0);
      setActualTransfer(0);
      setMemo('');
    }
    // T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 날짜/마감 전환 시 확정 편집 모드 종료(잔여 상태 차단).
    setConfirmedEditMode(false);
  }, [existing, date]);

  // ── Realtime: 결제·패키지결제·수기 변경 시 즉시 새로고침 ────
  // 데스크/상담실에서 결제가 들어오면 일마감 화면이 실시간 갱신됨
  useEffect(() => {
    if (!clinic) return;
    const channel = supabase.channel(`closing-${clinic.id}-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `clinic_id=eq.${clinic.id}` },
        () => qc.invalidateQueries({ queryKey: ['closing-payments', clinic.id, date] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'package_payments', filter: `clinic_id=eq.${clinic.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['closing-pkg-payments', clinic.id, date] });
          // T-20260805-foot-DAYCLOSE-PAYHIST-PACKAGE-MISSING: 리스트 소스(accounting_date)도 동시 갱신.
          qc.invalidateQueries({ queryKey: ['closing-pkg-payments-list', clinic.id, date] });
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'closing_manual_payments', filter: `clinic_id=eq.${clinic.id}` },
        () => qc.invalidateQueries({ queryKey: ['closing-manual', clinic.id, date] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clinic, date, qc]);

  // ── 합계 계산 ───────────────────────────────────────────────
  // T-20260525-foot-CLOSING-SUM-ERR 수정:
  //   구 코드는 manualEntries(수기결제)를 totals에서 누락 → 총합계 ≠ 결제내역 SUM.
  //   수기결제는 enrichedRows에는 포함되어 결제내역 탭에는 정상 표시됐지만,
  //   totals useMemo의 [payments, pkgPayments] dep array에 manualEntries 없어 grossTotal 미반영.
  //   Fix: manualCard/Cash/Transfer를 합산, manualEntries를 dep에 추가.
  //
  // T-20260525-foot-CLOSING-CALC-BUG 수정:
  //   fab1ad6(T-20260522-foot-CLOSING-REFUND)에서 refund_single_payment RPC 도입 후
  //   SummaryCard "합계" 행에 ['환불(차감 포함)', -refundAmount]를 추가했는데,
  //   sum() 헬퍼가 이미 환불을 차감해 totalCard/Cash/Transfer는 NET값임.
  //   → 환불이 이중 차감되어 표시행 합계(NET + -환불) ≠ grossTotal(NET) → 금액 불일치 표시.
  //
  //   Fix 전략: sum() = NET (환불 차감) — reconciliation(실제 정산)용
  //              sumGross() = GROSS (환불 미차감) — SummaryCard 표시행용
  //   SummaryCard "합계" rows: GROSS + ['환불', -refundAmount] → 합계 = NET = grossTotal ✓
  const totals = useMemo(() => {
    // NET sum: 환불 차감 포함 — reconciliation 및 DB 저장용
    const sum = (rows: { amount: number; method: string; payment_type: PaymentType }[], method: string) =>
      rows
        .filter(r => r.method === method)
        .reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);

    // GROSS sum: 결제(payment)행만 — SummaryCard 표시행용 (환불 행 제외)
    const sumGross = (rows: { amount: number; method: string; payment_type: PaymentType }[], method: string) =>
      rows
        .filter(r => r.method === method && r.payment_type !== 'refund')
        .reduce((s, r) => s + r.amount, 0);

    // ── T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET (DA CONDITIONAL-GO) ──────────
    //   DA da_decision_foot_closing_cashsum_revenue_basis_rebucket_20260820 (coherence-extension).
    //   교차수단 환불(원결제 method ≠ 환불 실지급 method)을 '합계(결제수단별)' 표시 카드에서만 원결제 method
    //   버킷으로 재귀속(revenue-basis). 근거: 김주연 총괄 field-authority(ts 1787189112, 08-18 정답=735,400)
    //     = 마감 현금합계 = 원결제수단 기준(revenue basis). 환불은 실지급(drawer) 아닌 원결제 버킷을 되돌린다.
    //   예(이금득 08-18): 카드 원결제 100k → 현금 실지급 환불(패키지, parent_payment_id join).
    //     · drawer basis(저장 method=cash 차감) → 현금 -100k(635,400) = 물리 금고 실제.
    //     · revenue basis(원결제 method=card 재귀속) → 현금 표시소계 735,400·카드 -100k(원결제수단 매출 반전).
    //   ★ Q1 전-수단 rebucket MANDATORY(conservation·INV5): cash +100k 흡수 해제 AND card -100k 이동을 '동시'.
    //     cash-only(cash만 올리고 card 미변경)=HARD REJECT(Σ 버킷 = net+100k). 재버킷=attribution 이전, Σ 불변.
    //     불변식: totalCardRev+CashRev+TransferRev ≡ totalCard+Cash+Transfer (버킷 간 이동일 뿐 총합 무변).
    //   ★ Q3 DISPLAY-ONLY(HARD BOUNDARY): 이 …Rev 소계는 '합계(결제수단별)' 표시 카드 전용. daily_closings persist
    //     (single_cash_total=totals.singleCash net)·outbox payload totals{}·일일감사 A6·정산 대사(cashDiff)·프린트
    //     '환불차감후'·DB 저장은 drawer grain(net 저장 method) 그대로 불변 — revenue projection 절대 무유입.
    //     (안 그러면 물리 금고 100k 유출이 시스템에만 남아 무고 cash-short → money-path harm.)
    //   ★ Q4 read-source = payment-linkage(원결제 charge.method) UNIFORM: pre-B-1 저장 refund.method 는 Axis-B
    //     오염값이라 절대 신뢰 금지. origMethodMap(날짜 무관 linkage 조회, 교차일 원결제 포함) 우선, 당일 맵 폴백.
    //   ★ Q4 anti-fabrication: linkage NULL(원결제 추적 불가)·linkage 미해결 환불행은 원결제 method 합성 금지 →
    //     honest fallback(저장 method 버킷 유지 = revenue-rebucket EXCLUDE·이동 안 함, 미verify 건수 노출).
    //     census(READ-ONLY 2026-08-20): NULL-linkage 환불 8건(단건 6+패키지 2)·교차수단 환불 4건(교차일 1건).
    const payMethodById = new Map<string, string>();
    for (const p of payments) payMethodById.set(p.id, p.method);
    const pkgMethodById = new Map<string, string>();
    for (const p of pkgPayments) pkgMethodById.set(p.id, p.method);
    // 원결제 method 해결(linkage-uniform·cutover-safe): 날짜무관 조회(origMethodMap) → 당일 로드 맵 폴백.
    const origMethodOfSingle = (id: string): string | undefined => origMethodMap.single[id] ?? payMethodById.get(id);
    const origMethodOfPkg    = (id: string): string | undefined => origMethodMap.pkg[id] ?? pkgMethodById.get(id);
    // 환불행의 revenue 버킷 + 해결여부. resolved=false → linkage 미verify(honest fallback: 저장 method 유지).
    const revBucketOfPayment = (r: PaymentRow): { bucket: string; unresolved: boolean } => {
      if (r.payment_type !== 'refund') return { bucket: r.method, unresolved: false };
      const origM = r.linked_payment_id ? origMethodOfSingle(r.linked_payment_id) : undefined;
      if (!origM) return { bucket: r.method, unresolved: true }; // NULL/미해결 linkage → 합성 금지, 저장 method 유지
      return { bucket: origM, unresolved: false };               // linkage-uniform: 원결제 method(Axis-A)
    };
    const revBucketOfPkg = (r: PackagePaymentRow): { bucket: string; unresolved: boolean } => {
      if (r.payment_type !== 'refund') return { bucket: r.method, unresolved: false };
      const origM = r.parent_payment_id ? origMethodOfPkg(r.parent_payment_id) : undefined;
      if (!origM) return { bucket: r.method, unresolved: true };
      return { bucket: origM, unresolved: false };
    };
    const bucketOfPayment = (r: PaymentRow): string => revBucketOfPayment(r).bucket;
    const bucketOfPkg     = (r: PackagePaymentRow): string => revBucketOfPkg(r).bucket;
    // revenue-basis NET 소계(표시 전용): net totals 과 동일 산식이되 환불행만 원결제 method 버킷으로 재귀속.
    //   sum(net) 과의 유일 차이 = filter 축(저장 method → bucketOf). 수기결제(환불 없음)는 저장 method 그대로.
    const sumRev = (method: string) =>
      payments.filter(r => bucketOfPayment(r) === method)
        .reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0) +
      pkgPayments.filter(r => bucketOfPkg(r) === method)
        .reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0) +
      manualEntries.filter(m => m.method === method).reduce((s, m) => s + m.amount, 0);
    // Q4 anti-fabrication 노출: linkage 미verify 환불(원결제 method 확인 불가·저장 method 기준 표시) 건수/금액.
    const revUnverified = (() => {
      let count = 0, amount = 0;
      for (const r of payments) if (r.payment_type === 'refund' && revBucketOfPayment(r).unresolved) { count++; amount += r.amount; }
      for (const r of pkgPayments) if (r.payment_type === 'refund' && revBucketOfPkg(r).unresolved) { count++; amount += r.amount; }
      return { count, amount };
    })();

    // NET (reconciliation/DB)
    const pkgCard     = sum(pkgPayments, 'card');
    const pkgCash     = sum(pkgPayments, 'cash');
    const pkgTransfer = sum(pkgPayments, 'transfer');
    const singleCard      = sum(payments, 'card');
    const singleCash      = sum(payments, 'cash');
    const singleTransfer  = sum(payments, 'transfer');
    const singleMembership = sum(payments, 'membership');
    // T-20260803-foot-MEDAID1-HEALTHFEE-DEDUCT (AC4-GATE b, silent-drop 금지):
    //   공단(건강생활유지비) 대납 = 실현매출(현금주의) → grossTotal 유니버스 포함(membership 과 달리 제외 아님).
    //   단건 결제(handleSettle 분리행)로만 생성 — 패키지/수기 경로 없음.
    const singleHealthMaintenance = sum(payments, 'health_maintenance');

    // GROSS (display)
    const pkgCardGross     = sumGross(pkgPayments, 'card');
    const pkgCashGross     = sumGross(pkgPayments, 'cash');
    const pkgTransferGross = sumGross(pkgPayments, 'transfer');
    const singleCardGross     = sumGross(payments, 'card');
    const singleCashGross     = sumGross(payments, 'cash');
    const singleTransferGross = sumGross(payments, 'transfer');

    // T-20260526-foot-CLOSING-PAYCOUNT: 건 수 — SummaryCard 결제수단별 건 수 표기
    const countGross = (rows: { method: string; payment_type: PaymentType }[], method: string) =>
      rows.filter(r => r.method === method && r.payment_type !== 'refund').length;
    const countRefund = (rows: { payment_type: PaymentType }[]) =>
      rows.filter(r => r.payment_type === 'refund').length;

    // 패키지 결제 건 수 (GROSS: 결제만, 환불 제외)
    const pkgCardCount     = countGross(pkgPayments, 'card');
    const pkgCashCount     = countGross(pkgPayments, 'cash');
    const pkgTransferCount = countGross(pkgPayments, 'transfer');
    const pkgRefundCount   = countRefund(pkgPayments);

    // 단건 결제 건 수
    const singleCardCount     = countGross(payments, 'card');
    const singleCashCount     = countGross(payments, 'cash');
    const singleTransferCount = countGross(payments, 'transfer');
    const singleRefundCount   = countRefund(payments);

    // 수기결제: manual entries는 항상 payment_type='payment' (환불 없음) — 직접 합산
    const manualCard     = manualEntries.filter(m => m.method === 'card').reduce((s, m) => s + m.amount, 0);
    const manualCash     = manualEntries.filter(m => m.method === 'cash').reduce((s, m) => s + m.amount, 0);
    const manualTransfer = manualEntries.filter(m => m.method === 'transfer').reduce((s, m) => s + m.amount, 0);
    const manualTotal    = manualCard + manualCash + manualTransfer;

    // 수기결제 건 수
    const manualCardCount     = manualEntries.filter(m => m.method === 'card').length;
    const manualCashCount     = manualEntries.filter(m => m.method === 'cash').length;
    const manualTransferCount = manualEntries.filter(m => m.method === 'transfer').length;

    // 합계 건 수
    const totalCardCount     = pkgCardCount + singleCardCount + manualCardCount;
    const totalCashCount     = pkgCashCount + singleCashCount + manualCashCount;
    const totalTransferCount = pkgTransferCount + singleTransferCount + manualTransferCount;
    const totalRefundCount   = pkgRefundCount + singleRefundCount;

    // NET totals (reconciliation/DB저장) = DRAWER grain(Axis-B/disbursement). 교차수단 환불도 저장 method(실지급)
    //   으로 차감 → 물리 금고 실제 증감. §85 payload 4버킷·A6·정산 실사 source. revenue projection 절대 무접촉·불변.
    const totalCard     = pkgCard + singleCard + manualCard;
    const totalCash     = pkgCash + singleCash + manualCash;
    const totalTransfer = pkgTransfer + singleTransfer + manualTransfer;

    // T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET: '합계(결제수단별)' 표시 카드 전용 revenue-basis(Axis-A)
    //   재귀속 소계 = DISPLAY-ONLY projection. conservation 불변식(Q1·INV5): totalCardRev+CashRev+TransferRev
    //   ≡ totalCard+Cash+Transfer (버킷 간 attribution 이전일 뿐 Σ 무변) → grossTotal(합계 카드 total prop) 정합.
    const totalCardRev     = sumRev('card');
    const totalCashRev     = sumRev('cash');
    const totalTransferRev = sumRev('transfer');

    // GROSS totals (SummaryCard 표시용)
    const totalCardGross     = pkgCardGross + singleCardGross + manualCard;
    const totalCashGross     = pkgCashGross + singleCashGross + manualCash;
    const totalTransferGross = pkgTransferGross + singleTransferGross + manualTransfer;

    // 환불 합계 (절댓값)
    const refundSingleAmount =
      payments.filter(r => r.payment_type === 'refund').reduce((s, r) => s + r.amount, 0);
    const refundPkgAmount =
      pkgPayments.filter(r => r.payment_type === 'refund').reduce((s, r) => s + r.amount, 0);
    const refundAmount = refundSingleAmount + refundPkgAmount;

    // ── T-20260820-foot-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL (part1): 결제수단별 환불 집계 ──
    //   환불 별도 박스(환불 내역)의 '카드/현금/이체 환불 N건 -X원' 표기용. 환불행을 method 축으로 partition.
    //   ★method 축 = Axis-A(원결제 승계·결제수단별 집계 canonical bucket) — REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX
    //     (da_decision_foot_refund_crossmethod_method_inherit_fwdfix_20260819) 확정. forward 환불행=원결제 method 승계(정합) /
    //     4 historical 교차수단행=현행 method 유지(김주연 총괄 field GENUINE 결정, 소급 미접촉).
    //   ★신규 산식 0(§13.1.C): 위 refundSingleAmount/refundPkgAmount 와 '동일 refund 행 집합'을 method 로 partition 만.
    //     합계(refundCard+Cash+Transfer+Other) ≡ refundAmount(SSOT) — silent-drop 방지(refundOther 잔여 가드).
    const refundMethodAmount = (method: string) =>
      payments.filter(r => r.payment_type === 'refund' && r.method === method).reduce((s, r) => s + r.amount, 0) +
      pkgPayments.filter(r => r.payment_type === 'refund' && r.method === method).reduce((s, r) => s + r.amount, 0);
    const refundMethodCount = (method: string) =>
      payments.filter(r => r.payment_type === 'refund' && r.method === method).length +
      pkgPayments.filter(r => r.payment_type === 'refund' && r.method === method).length;
    const refundCardAmount     = refundMethodAmount('card');
    const refundCashAmount     = refundMethodAmount('cash');
    const refundTransferAmount = refundMethodAmount('transfer');
    const refundCardCount      = refundMethodCount('card');
    const refundCashCount      = refundMethodCount('cash');
    const refundTransferCount  = refundMethodCount('transfer');
    // 카드/현금/이체 외 수단(membership 등) 환불 잔여 — 총합 정합(=refundAmount) 유지용. 0 이면 미표기.
    const refundOtherAmount = refundAmount - (refundCardAmount + refundCashAmount + refundTransferAmount);
    const refundOtherCount  = totalRefundCount - (refundCardCount + refundCashCount + refundTransferCount);

    // T-20260519-foot-PKG-REVENUE-SPLIT AC-2/AC-3:
    // grossTotal에서 singleMembership 제외.
    // 'membership' method = 전액 패키지 차감건(amount=0 마커) 또는 구형 패키지차감건
    // 패키지는 최초 구매 시점(package_payments)에 이미 집계됨 → 차감 시점에 재집계 불가
    // grossTotal = NET (환불 차감 후, membership 제외) — reconciliation 기준점
    // T-20260803-foot-MEDAID1-HEALTHFEE-DEDUCT (AC4-GATE b): 공단 대납(health_maintenance)은 실현매출이므로
    //   grossTotal 에 가산(silent-drop 금지). membership(선불 use)은 여전히 제외 유지.
    const grossTotal = totalCard + totalCash + totalTransfer + singleHealthMaintenance;

    return {
      // NET (reconciliation/DB)
      pkgCard, pkgCash, pkgTransfer,
      singleCard, singleCash, singleTransfer, singleMembership,
      singleHealthMaintenance,
      totalCard, totalCash, totalTransfer,
      // T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET: '합계(결제수단별)' 표시 카드 전용 revenue-basis 소계 + 미verify 노출
      totalCardRev, totalCashRev, totalTransferRev,
      revUnverifiedCount: revUnverified.count, revUnverifiedAmount: revUnverified.amount,
      // GROSS (SummaryCard 표시)
      pkgCardGross, pkgCashGross, pkgTransferGross,
      singleCardGross, singleCashGross, singleTransferGross,
      totalCardGross, totalCashGross, totalTransferGross,
      // Manual (공통)
      manualCard, manualCash, manualTransfer, manualTotal,
      manualCardCount, manualCashCount, manualTransferCount,
      // 환불
      refundAmount, refundSingleAmount, refundPkgAmount,
      // T-20260820-foot-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL (part1): 결제수단별 환불 breakdown
      refundCardAmount, refundCashAmount, refundTransferAmount, refundOtherAmount,
      refundCardCount, refundCashCount, refundTransferCount, refundOtherCount,
      // 합계
      grossTotal,
      // T-20260526-foot-CLOSING-PAYCOUNT: 건 수
      pkgCardCount, pkgCashCount, pkgTransferCount, pkgRefundCount,
      singleCardCount, singleCashCount, singleTransferCount, singleRefundCount,
      totalCardCount, totalCashCount, totalTransferCount, totalRefundCount,
    };
  }, [payments, pkgPayments, manualEntries, origMethodMap]);

  const cardDiff = actualCard - totals.totalCard;
  const cashDiff = actualCash - totals.totalCash;
  const transferDiff = actualTransfer - totals.totalTransfer;
  const totalDiff = cardDiff + cashDiff + transferDiff;
  const isClosed = existing?.status === 'closed';

  // ── 조회 맵 ────────────────────────────────────────────────
  const customerMap = useMemo(() => {
    const map = new Map<string, CustomerBasic>();
    for (const c of customersBasic) map.set(c.id, c);
    return map;
  }, [customersBasic]);

  // T-20260522-foot-STAFF-NAME-UNIFY: id → display_name(구성명) fallback to name
  const staffMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staffList) map.set(s.id, s.display_name || s.name);
    return map;
  }, [staffList]);

  const checkInDetailMap = useMemo(() => {
    const map = new Map<string, CheckInDetail>();
    for (const c of checkInsDetail) map.set(c.id, c);
    return map;
  }, [checkInsDetail]);

  // T-20260715-foot-SAMEDAY-VISITTYPE-DISPLAY-CHECKINS-SOURCE (AC1): 당일 초진/재진 = check_ins.visit_type(접수 스냅샷) 기준.
  //   customers.visit_type 은 [완료] 이동 시 'returning' 승격(다음 방문 예측용) → 당일 표시엔 사용 금지.
  //   단건 결제는 check_in_id 직접 연결로 조회하고, 패키지 결제(check_in_id 無)는 customer_id → 당일 check_in 으로 폴백 조회.
  const checkInVisitTypeByCustomer = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of checkInsDetail) {
      if (c.customer_id && !map.has(c.customer_id)) map.set(c.customer_id, c.visit_type);
    }
    return map;
  }, [checkInsDetail]);

  // ── 통합 결제내역 (enriched) ────────────────────────────────
  const enrichedRows = useMemo<EnrichedRow[]>(() => {
    const rows: EnrichedRow[] = [];

    // 단건 결제
    for (const p of payments) {
      const ci = p.check_in_id ? checkInDetailMap.get(p.check_in_id) : null;
      const customerId = p.customer_id ?? ci?.customer_id ?? null;
      const cust = customerId ? customerMap.get(customerId) : null;
      // T-20260522-foot-CLOSING-PAY-3COL: 결제담당자 = customers.assigned_staff_id (2번차트 1구역 담당자 드롭 단일 소스)
      // consultant_id 혼재 제거 — 현장 확정 2026-05-22
      const payStaffId = cust?.assigned_staff_id ?? null;
      const consultantName = payStaffId ? (staffMap.get(payStaffId) ?? null) : null;
      const customerName = ci?.customer_name ?? cust?.name ?? '-';
      const dt = new Date(p.created_at);

      rows.push({
        sort_key: p.created_at,
        pay_date: format(dt, 'yyyy-MM-dd'),
        pay_time: format(dt, 'HH:mm'),
        chart_number: cust?.chart_number ?? null,
        customer_name: customerName,
        // T-20260522-foot-DAILY-SETTLE-STAFF: 내원경로=customers.visit_route
        lead_source: cust?.visit_route ?? null,
        // T-20260715-foot-SAMEDAY-VISITTYPE-DISPLAY-CHECKINS-SOURCE (AC1): 초진/재진 = check_ins.visit_type(접수 스냅샷).
        //   단건 결제는 check_in_id 직접 연결(ci) 우선, 없으면 customer_id 폴백, 최후에 customers.visit_type.
        visit_type_label: visitTypeLabel(
          ci?.visit_type
            ?? (customerId ? checkInVisitTypeByCustomer.get(customerId) ?? null : null)
            ?? cust?.visit_type
            ?? null,
        ),
        staff_name: consultantName,
        // T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY: 실제 처리자 = payments.created_by JOIN(refund_single_payment 캡처분).
        //   staff_name(고객 배정담당)과 별개 축 — 환불 이력 처리자 컬럼 전용. 미기록 → null('—').
        processor_name: p.processor?.name ?? null,
        amount: p.amount,
        method: p.method,
        payment_type: p.payment_type,
        source: 'payment',
        // T-20260515-foot-RECEIPT-TAX-SPLIT AC-4
        taxable_amount: p.taxable_amount ?? null,
        tax_exempt_amount: p.tax_exempt_amount ?? null,
        cash_receipt_issued: p.cash_receipt_issued ?? null,
        cash_receipt_type: p.cash_receipt_type ?? null,
        // T-20260522-foot-CLOSING-REFUND: 환불 RPC 호출용
        payment_id: p.id,
        // T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING: 진료비/단건 heuristic(check_in_id 유무)
        pay_check_in_id: p.check_in_id ?? null,
        row_customer_id: p.customer_id ?? undefined,
        // T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불행→원결제행 매칭 키
        linked_payment_id: p.linked_payment_id ?? null,
        // ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3): 플랜A 짝맞춤 판별자(payments 축).
        payment_attempt_id: p.payment_attempt_id ?? null,
        external_approval_no: p.external_approval_no ?? null,
        row_accounting_date: p.accounting_date ?? null,
        pay_installment: p.installment ?? null,
      });
    }

    // 패키지 결제 — T-20260510-foot-C21-STAFF-REVENUE: 담당자 자동연동
    // T-20260805-foot-DAYCLOSE-PAYHIST-PACKAGE-MISSING: 리스트 소스 = pkgPaymentsForList(accounting_date 축).
    for (const p of pkgPaymentsForList) {
      const cust = p.customer_id ? customerMap.get(p.customer_id) : null;
      const dt = new Date(p.created_at);
      const assignedStaffName = cust?.assigned_staff_id ? (staffMap.get(cust.assigned_staff_id) ?? null) : null;
      // T-20260805-foot-DAYCLOSE-PAYHIST-PACKAGE-MISSING: 표시 일자 = accounting_date(매출 인식일, 리스트 필터 축과 일치).
      //   시각(HH:mm)은 실제 수납 clock(created_at) 유지. accounting_date NULL이면 created_at 폴백.
      //   ★ sort_key 는 created_at(단건 payments 와 동일 포맷=Supabase UTC ISO) 유지 → 소스간 정렬 포맷 혼합
      //     (localeCompare tz-offset 오정렬) 회피. accounting 귀속 소수 건(census 7/134)은 당일 상단에 정렬됨(허용).
      const acctDate = p.accounting_date ?? format(dt, 'yyyy-MM-dd');
      const pkgTime = format(dt, 'HH:mm');
      rows.push({
        sort_key: p.created_at,
        pay_date: acctDate,
        pay_time: pkgTime,
        chart_number: cust?.chart_number ?? null,
        customer_name: cust?.name ?? '-',
        // T-20260522-foot-DAILY-SETTLE-STAFF: 내원경로=customers.visit_route
        lead_source: cust?.visit_route ?? null,
        // T-20260715-foot-SAMEDAY-VISITTYPE-DISPLAY-CHECKINS-SOURCE (AC1): 초진/재진 = check_ins.visit_type(접수 스냅샷).
        //   패키지 결제는 check_in_id 미보유 → customer_id 로 당일 check_in 조회, 없으면 customers.visit_type 폴백.
        visit_type_label: visitTypeLabel(
          (p.customer_id ? checkInVisitTypeByCustomer.get(p.customer_id) ?? null : null)
            ?? cust?.visit_type
            ?? null,
        ),
        staff_name: assignedStaffName,
        // T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY: 실제 환불 처리자 = package_payments.created_by JOIN
        //   (refund_package_payment auth.uid() 캡처분). staff_name(고객 배정담당)과 별개 축. 과거행 미기록 → null('—').
        processor_name: p.processor?.name ?? null,
        amount: p.amount,
        method: p.method,
        payment_type: p.payment_type,
        source: 'package',
        taxable_amount: null,
        tax_exempt_amount: null,
        cash_receipt_issued: null,
        cash_receipt_type: null,
        // T-20260522-foot-CLOSING-REFUND: 환불 RPC 호출용
        package_id: p.package_id,
        // T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH: 선택 결제행 단위 환불 대상 = 이 package_payments row
        pkg_payment_id: p.id,
        row_customer_id: p.customer_id,
        // T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 패키지 환불행→원결제행 매칭 키
        parent_payment_id: p.parent_payment_id ?? null,
        // ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3): 플랜A 짝맞춤 판별자(package_payments 축).
        payment_attempt_id: p.payment_attempt_id ?? null,
        external_approval_no: p.external_approval_no ?? null,
        row_accounting_date: p.accounting_date ?? null,
        pay_installment: p.installment ?? null,
      });
    }

    // 수기 추가
    for (const m of manualEntries) {
      rows.push({
        sort_key: m.close_date + 'T' + (m.pay_time ?? '00:00') + ':00+09:00',
        pay_date: m.close_date,
        pay_time: m.pay_time ?? '-',
        chart_number: m.chart_number,
        customer_name: m.customer_name,
        lead_source: m.lead_source,
        visit_type_label: visitTypeLabel(m.visit_type),
        staff_name: m.staff_name,
        amount: m.amount,
        method: m.method,
        payment_type: 'payment',
        source: 'manual',
        manual_id: m.id,
        manual_raw: m,
        taxable_amount: null,
        tax_exempt_amount: null,
        cash_receipt_issued: null,
        cash_receipt_type: null,
      });
    }

    // ── T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 환불 = 기존 행 annotate ──────
    //   환불(refund) 행을 별도 빨간 새 행으로 그리지 않고, 원결제행에 '환불' 표기 + 환불 신청 시각을
    //   병기한다. 매칭: 단건=linked_payment_id→payment_id / 패키지=parent_payment_id→pkg_payment_id.
    //   ★ 합계 불변식: 병합해도 refund 행은 rows 배열에 그대로 남긴다(merged_refund 플래그만 세팅) →
    //     모든 합계 reduce(payment_type==='refund'?-amount:amount)는 net 값을 그대로 유지(회귀 0).
    //     표시 경로(.map/Excel/PDF)에서만 merged_refund 행을 스킵한다.
    //   ★ 데이터 무손실: 원결제행이 당일 목록에 없는 '고아 환불'(과거일 결제 환불 등)은 병합하지 않고
    //     기존처럼 자체 행으로 렌더(regression-safe fallback).
    const originalByPaymentId = new Map<string, EnrichedRow>();
    const originalByPkgPaymentId = new Map<string, EnrichedRow>();
    for (const r of rows) {
      if (r.payment_type === 'refund') continue;
      if (r.source === 'payment' && r.payment_id) originalByPaymentId.set(r.payment_id, r);
      if (r.source === 'package' && r.pkg_payment_id) originalByPkgPaymentId.set(r.pkg_payment_id, r);
    }
    for (const r of rows) {
      if (r.payment_type !== 'refund') continue;
      const orig =
        r.source === 'payment' && r.linked_payment_id
          ? originalByPaymentId.get(r.linked_payment_id)
          : r.source === 'package' && r.parent_payment_id
          ? originalByPkgPaymentId.get(r.parent_payment_id)
          : undefined;
      if (!orig) continue; // 고아 환불 → 자체 행 유지(fallback)
      // ── T-20260819-foot-CLOSING-CASHSUM-REFUNDROW-100K-DROP (B-2, view-layer) ──────
      //   교차수단 환불(환불행 method ≠ 원결제행 method)은 병합하지 않고 자체 행으로 렌더한다.
      //   병합하면 환불행이 '원결제행 method 탭'으로 숨겨져(merged_refund=표시 스킵), 정작 총계
      //   reduce 는 환불행 자체 method 로 -amount 차감 → 환불행 method 탭의 [화면행 합 ≠ 총계]
      //   불일치가 발생한다(2026-08-18: 카드 원결제 100k → 현금 환불 → 현금탭 화면행 735,400 vs
      //   현금 총계 635,400, 100k 갭). 같은 수단일 때만 원결제행에 annotate 병합하고, 교차수단은
      //   고아 환불과 동일하게 자체 행(fallback)으로 남겨 환불행 method 탭에서 -amount 가 보이게 한다.
      //   ★ 합계 불변(회귀 0): refund 행은 병합 여부와 무관하게 rows 에 잔존 → totals reduce 불변.
      if (r.method !== orig.method) continue;
      r.merged_refund = true;                 // 표시에서 스킵(합계 reduce 에는 잔존)
      orig.refunded = true;
      orig.refund_amount = (orig.refund_amount ?? 0) + r.amount;
      // 마지막(최신) 환불 신청 시각을 원결제행에 표기
      orig.refund_date = r.pay_date;
      orig.refund_time = r.pay_time;
      // T-20260805-foot-CLOSING-PAYDETAIL-REFUND-PROCESSOR-DISPLAY: 환불 처리자(환불행 created_by→name)를 원결제행에 승계.
      //   refund_date/time 과 동일 규칙(마지막 환불 기준). 배정담당(orig.staff_name)과 별개 축. 미기록 → null('—').
      orig.refund_processor_name = r.processor_name ?? null;
    }

    rows.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
    return rows;
  }, [payments, pkgPaymentsForList, manualEntries, checkInDetailMap, checkInVisitTypeByCustomer, customerMap, staffMap]);

  // ── T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT: 환불 상태 헬퍼 ──
  //   전 기간(교차일 포함) 누적 환불액 / 완전환불 판정 / 고객 단위 환불행 묶기.
  const refundedTotalForRow = (r: EnrichedRow): number => {
    if (r.source === 'payment' && r.payment_id) return refundTotalsAllDates[`pay:${r.payment_id}`] ?? 0;
    if (r.source === 'package' && r.pkg_payment_id) return refundTotalsAllDates[`pkg:${r.pkg_payment_id}`] ?? 0;
    return 0;
  };
  // AC-B1: 잔여 환불가능 0(원결제 ≤ 누적 환불) → 완전환불 = 재환불 불가.
  const isFullyRefunded = (r: EnrichedRow): boolean =>
    (r.source === 'payment' || r.source === 'package') && r.amount > 0 && refundedTotalForRow(r) >= r.amount;
  // T-20260805-foot-CLOSING-PAYDETAIL-REFUND-PROCESSOR-DISPLAY: 결제내역 표시행의 '환불처리 직원명' 산출.
  //   ① 병합된 환불(원결제행): refund_processor_name(승계분) → 당일 환불행의 처리자.
  //   ② 병합 안 된 자체 환불행(고아 환불, 원결제 당일 목록에 없음): 행 자체 processor_name = 환불 처리자.
  //   ★ 교차일 누적 환불(refundedTotalForRow>0·당일 refunded 아님)은 환불행이 당일 로드 스코프 밖 → 처리자 미표시(날조 금지).
  //   반환 { has, name }: has=true 면 환불 처리자 라인 노출('—' 포함), false 면 미노출.
  const refundProcessorForRow = (r: EnrichedRow): { has: boolean; name: string | null } => {
    if (r.refunded) return { has: true, name: r.refund_processor_name ?? null };
    if (r.payment_type === 'refund') return { has: true, name: r.processor_name ?? null };
    return { has: false, name: null };
  };
  // 환불창 오픈 시 같은 고객(row_customer_id)의 환불 가능 결제행(payment/package, 환불행 제외) 묶음.
  //   row_customer_id 없으면(고객 미매칭 payment 등) 해당 행 단독.
  const gatherCustomerRefundRows = (r: EnrichedRow): EnrichedRow[] => {
    if (!r.row_customer_id) return [r];
    const set = enrichedRows.filter(
      x =>
        (x.source === 'payment' || x.source === 'package') &&
        x.payment_type !== 'refund' &&
        x.row_customer_id === r.row_customer_id,
    );
    return set.length > 0 ? set : [r];
  };

  // ── T-20260819-foot-CLOSING-TERMINAL-FILTER: 단말기 필터 파생 상태 ──────────────────────
  //   payment_id → TID Map (레드페이 매칭된 CRM 단건 결제만 존재). 뷰 산출 결과 소비만(FE 재계산 0).
  const terminalTidByPaymentId = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const r of redpayTidRows) {
      if (r.matched_payment_id && r.tid) m.set(r.matched_payment_id, r.tid);
    }
    return m;
  }, [redpayTidRows]);
  // TID → 사람용 라벨(풋(VAN)/풋(멀티) 등). 레지스트리 없으면 라벨 없음(TID 원문 폴백).
  const terminalLabelByTid = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const r of terminalRegistry) {
      if (r.tid && r.terminal_label) m.set(r.tid, r.terminal_label);
    }
    return m;
  }, [terminalRegistry]);
  // 드롭다운 옵션 = 당일 결제에 실제 매칭된 단말 TID 목록(정렬). 매칭 0건이면 '전체'만 노출(기존동작).
  const terminalOptions = useMemo<string[]>(
    () => [...new Set(terminalTidByPaymentId.values())].sort(),
    [terminalTidByPaymentId],
  );
  // 옵션 표기: '풋(멀티) ·9476'(라벨 + TID 끝 4자리). 라벨 없으면 TID 원문.
  const terminalOptionLabel = (tid: string): string => {
    const label = terminalLabelByTid.get(tid);
    return label ? `${label} ·${tid.slice(-4)}` : tid;
  };

  // C2-MANAGER-PAYMENT-MAP: 담당자 필터 적용
  // T-20260522-foot-DAILY-SETTLE-STAFF AC-3: NULL → '미지정' 통일
  // T-20260530-foot-CLOSING-PAYMETHOD-FILTER: 담당자 + 결제수단 AND 결합
  // T-20260819-foot-CLOSING-TERMINAL-FILTER: + 단말기(레드페이 TID) AND 결합.
  //   단말기 매핑은 payments(단건) 축에만 존재 → 패키지/수기/미매칭 단건은 필터 시 제외(레드페이 TID 없음, AC).
  //   원결제행=payment_id, (병합·자체) 환불행=linked_payment_id(원결제)로 TID 조회 → 원결제·환불이 같이 남아
  //   합계(net) reduce 정합 유지(회귀 0).
  const filteredEnrichedRows = useMemo<EnrichedRow[]>(() => {
    if (!staffFilter && !methodFilter && !terminalFilter) return enrichedRows;
    return enrichedRows.filter(r => {
      if (staffFilter && (r.staff_name ?? '미지정') !== staffFilter) return false;
      if (methodFilter && r.method !== methodFilter) return false;
      if (terminalFilter) {
        let tid: string | undefined;
        if (r.source === 'payment') {
          const key = r.payment_type === 'refund' ? (r.linked_payment_id ?? undefined) : (r.payment_id ?? undefined);
          tid = key ? terminalTidByPaymentId.get(key) : undefined;
        }
        if (tid !== terminalFilter) return false;
      }
      return true;
    });
  }, [enrichedRows, staffFilter, methodFilter, terminalFilter, terminalTidByPaymentId]);

  // ── T-20260715-foot-DAYCLOSE-LIST-PATIENT-GROUP: 동일 환자(차트번호+성함) 건 그룹 묶음 ──
  //   현장(김주연 총괄) 요청: 결제 시각순으로 흩어진 동일 환자 건을 최초 결제 시각 아래로 묶어 표시.
  //   ★ 순수 표시(render) 재배열 — 합계/집계 reduce 는 filteredEnrichedRows 를 그대로 사용하므로 숫자 무회귀.
  //   ★ Excel/PDF(exportExcel/handlePrint)는 enrichedRows(시간순) 그대로 → 출력물 형식 무변경(AC11).
  //   ★ 병합된 환불행(merged_refund)은 표시 스킵 규칙을 유지한 채 그룹화(REFUNDROW reconcile).
  //   그룹 키: chart_number + customer_name (chart_number null → customer_name 만으로 그룹).
  //   filteredEnrichedRows 는 이미 sort_key(pay_time) 오름차순 → Map 삽입순 = 그룹 최초시각 오름차순,
  //   그룹 내부 = 등장순 = 시각 오름차순(AC2/AC3 자동 충족).
  const groupedDisplayRows = useMemo<Array<{ row: EnrichedRow; indexInGroup: number; groupSize: number }>>(() => {
    const display = filteredEnrichedRows.filter(r => !r.merged_refund);
    // key: null-char 구분자로 chart_number 접두 → chart null(빈 접두)과 chart 값 절대 충돌 없음.
    // chart null 이면 접두가 빈 문자열 → customer_name 만으로 그룹화(AC9).
    const groups = new Map<string, EnrichedRow[]>();
    for (const r of display) {
      const key = `${r.chart_number ?? ''}\u0000${r.customer_name}`;
      const g = groups.get(key);
      if (g) g.push(r);
      else groups.set(key, [r]);
    }
    const flat: Array<{ row: EnrichedRow; indexInGroup: number; groupSize: number }> = [];
    for (const g of groups.values()) {
      g.forEach((row, idx) => flat.push({ row, indexInGroup: idx, groupSize: g.length }));
    }
    return flat;
  }, [filteredEnrichedRows]);

  // ── AC-4: 자동 갱신 시 결제내역 스크롤 위치 보존 ──────────────
  // T-20260525-foot-CLOSING-NAV-BUG:
  //   qc.invalidateQueries → 데이터 갱신 → filteredEnrichedRows 변경 →
  //   useLayoutEffect 실행(paint 전) → scrollTop 복원 → 시각적 점프 없음
  useLayoutEffect(() => {
    const el = paymentsTableRef.current;
    if (!el) return;
    el.scrollTop = scrollTopRef.current;
  }, [filteredEnrichedRows]);

  // T-20260522-foot-DAILY-SETTLE-STAFF AC-2: 담당자별 매출 집계 — 카드/현금/이체 소계 추가
  // AC-3: NULL staff_id → '미지정' 표시 (enrichedRows 기준 — 필터 무관)
  const staffTotals = useMemo<Array<{ name: string; total: number; card: number; cash: number; transfer: number }>>(() => {
    const map = new Map<string, { name: string; total: number; card: number; cash: number; transfer: number }>();
    for (const r of enrichedRows) {
      const key = r.staff_name ?? '미지정';
      const existing = map.get(key) ?? { name: key, total: 0, card: 0, cash: 0, transfer: 0 };
      const amt = r.payment_type === 'refund' ? -r.amount : r.amount;
      existing.total += amt;
      if (r.method === 'card' || r.method === 'membership') existing.card += amt;
      else if (r.method === 'cash') existing.cash += amt;
      else if (r.method === 'transfer') existing.transfer += amt;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [enrichedRows]);

  // ── T-20260717-foot-CLOSING-REFUND-STATS-MISSING: 금일 환불 별도 집계 섹션(표시 전용) ──
  //   [REOPEN 실제 요구] '차감 여부'는 이미 정상(refundAmount가 grossTotal에서 NET 차감).
  //   본 작업은 환불 건을 '별도 집계 섹션'으로 노출만 추가한다(additive display).
  //   ★ 환불 식별·금액은 확정 소스 재사용: enrichedRows 의 payment_type==='refund' 행
  //     (단건=payments / 패키지=package_payments, payment_type='refund') — 새 산식 발명 0.
  //   ★ 합계·차감·담당자별 로직 무접점 — refundRows 는 표시용 파생값일 뿐(reduce 경로 불변).
  //   ★ merged_refund(원결제행에 병합 표시된 환불) 포함 — 병합은 '결제내역 목록' 표기 규칙일 뿐
  //     환불 집계에서는 모든 refund 행을 세야 totals.refundAmount/totalRefundCount 와 정합(AC-R4).
  const refundRows = useMemo<EnrichedRow[]>(
    () =>
      enrichedRows
        .filter(r => r.payment_type === 'refund')
        .sort((a, b) => a.sort_key.localeCompare(b.sort_key)),
    [enrichedRows],
  );

  // ── 핸들러 ────────────────────────────────────────────────
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['closing', clinic?.id, date] });
  };

  const refreshPayments = () => {
    qc.invalidateQueries({ queryKey: ['closing-payments', clinic?.id, date] });
    qc.invalidateQueries({ queryKey: ['closing-pkg-payments', clinic?.id, date] });
    qc.invalidateQueries({ queryKey: ['closing-manual', clinic?.id, date] });
    qc.invalidateQueries({ queryKey: ['closing-unpaid', clinic?.id, date] });
    qc.invalidateQueries({ queryKey: ['closing-checkin-detail', clinic?.id, date] });
  };

  const saveDraft = async (close: boolean) => {
    if (!clinic) return;
    const payload = {
      clinic_id: clinic.id,
      close_date: date,
      package_card_total: totals.pkgCard,
      package_cash_total: totals.pkgCash,
      package_transfer_total: totals.pkgTransfer,
      single_card_total: totals.singleCard,
      single_cash_total: totals.singleCash,
      single_transfer_total: totals.singleTransfer,
      actual_card_total: actualCard,
      actual_cash_total: actualCash,
      actual_transfer_total: actualTransfer,
      difference: totalDiff,
      status: close ? 'closed' : 'open',
      closed_at: close ? new Date().toISOString() : null,
      memo: memo || null,
    };
    let error;
    if (existing) {
      ({ error } = await supabase.from('daily_closings').update(payload).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('daily_closings').insert(payload));
    }
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success(close ? '마감 완료' : '저장 완료');
    refresh();
  };

  const reopen = async () => {
    if (!existing) return;
    const { error } = await supabase
      .from('daily_closings')
      .update({ status: 'open', closed_at: null })
      .eq('id', existing.id);
    if (error) { toast.error(`재오픈 실패: ${error.message}`); return; }
    toast.success('재오픈');
    refresh();
  };

  // ── T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 후 '해제 없이 수정' 원자 저장 ──
  //   저장 = closing_confirmed_edit RPC(unlock→edit→re-confirm revision+1 + 감사로그). raw mutate 아님(DA [4-d]).
  //   manualOp(있으면) = 수기수납 단일행 편집/삭제/추가를 같은 트랜잭션에서 적용. audit = 필드단위 변경내역.
  const saveConfirmedEdit = async (
    manualOp: Record<string, unknown> | null,
    audit: { field: string; old_value: string | null; new_value: string | null }[],
  ): Promise<boolean> => {
    if (!clinic || !existing) return false;
    const { data, error } = await supabase.rpc('closing_confirmed_edit', {
      p_clinic_id: clinic.id,
      p_close_date: date,
      p_actual_card: actualCard,
      p_actual_cash: actualCash,
      p_actual_transfer: actualTransfer,
      p_memo: memo || null,
      p_manual_op: manualOp,
      p_audit: audit,
    });
    if (error) { toast.error(`수정 저장 실패: ${error.message}`); return false; }
    const rev = (data as { revision?: number } | null)?.revision;
    toast.success(`수정 저장됨 — 자동 재확정${typeof rev === 'number' ? ` (버전 ${rev})` : ''}·이력 기록`);
    setConfirmedEditMode(false);
    refresh();
    refreshPayments();
    qc.invalidateQueries({ queryKey: ['closing-edit-log', clinic.id, date] });
    return true;
  };

  // 실제정산(실수령)/메모 변경 저장 — 변경필드만 audit 로 기록.
  const saveConfirmedReconcile = async () => {
    if (!existing) return;
    const audit: { field: string; old_value: string | null; new_value: string | null }[] = [];
    if (actualCard !== (existing.actual_card_total ?? 0))
      audit.push({ field: '카드 실수령', old_value: String(existing.actual_card_total ?? 0), new_value: String(actualCard) });
    if (actualCash !== (existing.actual_cash_total ?? 0))
      audit.push({ field: '현금 실수령', old_value: String(existing.actual_cash_total ?? 0), new_value: String(actualCash) });
    if (actualTransfer !== (existing.actual_transfer_total ?? 0))
      audit.push({ field: '이체 실수령', old_value: String(existing.actual_transfer_total ?? 0), new_value: String(actualTransfer) });
    if ((memo || '') !== (existing.memo ?? ''))
      audit.push({ field: '메모', old_value: existing.memo ?? '', new_value: memo || '' });
    if (audit.length === 0) { toast.error('변경된 내용이 없습니다'); return; }
    await saveConfirmedEdit(null, audit);
  };

  // 확정 편집 모드 취소 — 폼을 확정 시점 값으로 되돌리고 모드 종료.
  const cancelConfirmedEdit = () => {
    if (existing) {
      setActualCard(existing.actual_card_total ?? 0);
      setActualCash(existing.actual_cash_total ?? 0);
      setActualTransfer(existing.actual_transfer_total ?? 0);
      setMemo(existing.memo ?? '');
    }
    setConfirmedEditMode(false);
  };

  // ── CSV 내보내기 (총 합계 탭) ─────────────────────────────
  // T-20260519-foot-PKG-REVENUE-SPLIT: grossTotal은 패키지차감(membership) 제외
  // T-20260525-foot-CLOSING-CALC-BUG: GROSS 표시 + 환불 별도 행 → 행합계 = NET(grossTotal) ✓
  const exportCSV = () => {
    const rows = [
      ['구분', '카드(GROSS)', '현금(GROSS)', '이체(GROSS)', '패키지차감(매출제외)', '매출합계(NET)'],
      ['패키지구매', totals.pkgCardGross, totals.pkgCashGross, totals.pkgTransferGross, 0,
        totals.pkgCard + totals.pkgCash + totals.pkgTransfer],
      ['단건', totals.singleCardGross, totals.singleCashGross, totals.singleTransferGross, totals.singleMembership,
        totals.singleCard + totals.singleCash + totals.singleTransfer],
      ['합계(멤버십제외)', totals.totalCardGross, totals.totalCashGross, totals.totalTransferGross, totals.singleMembership, totals.grossTotal],
      ['환불(차감)', -totals.refundSingleAmount, '', '', '', -totals.refundPkgAmount],
      [],
      ['정산', '시스템(NET)', '실제', '차이'],
      ['카드', totals.totalCard, actualCard, cardDiff],
      ['현금', totals.totalCash, actualCash, cashDiff],
      ['이체', totals.totalTransfer, actualTransfer, transferDiff],
      ['총 차이', '', '', totalDiff],
      [],
      ['환불합계', totals.refundAmount],
      ['  └단건환불', totals.refundSingleAmount],
      ['  └패키지환불', totals.refundPkgAmount],
      ['미수건수', unpaid.length],
    ];
    if (memo) rows.push([], ['메모', memo]);
    const bom = '﻿';
    const escapeCell = (v: unknown) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = bom + rows.map(r => r.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `마감_총합계_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV 다운로드 완료');
  };

  // ── Excel 내보내기 (결제내역 탭) ──────────────────────────
  const exportExcel = () => {
    const header = ['날짜', '시간', '차트번호', '성함', '내원경로', '초진/재진', '결제담당', '결제금액', '결제수단', '구분'];
    const dataRows = enrichedRows.map(r => [
      r.pay_date,
      r.pay_time,
      r.chart_number ?? '',
      r.customer_name,
      r.lead_source ?? '',
      r.visit_type_label,
      r.staff_name ?? '',
      r.payment_type === 'refund' ? -r.amount : r.amount,
      METHOD_KO[r.method] ?? r.method,
      r.source === 'manual' ? '수기' : r.source === 'package' ? '패키지' : '단건',
    ]);
    const totalRow = ['합계', '', '', '', '', '', '', enrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0), '', ''];

    const wsData = [header, ...dataRows, [], totalRow];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // 컬럼 너비 조정 (10개 컬럼)
    ws['!cols'] = [
      { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 6 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '결제내역');
    XLSX.writeFile(wb, `결제내역_${date}.xlsx`);
    toast.success('Excel 다운로드 완료');
  };

  // ── T-20260819-foot-DAYCLOSE-TOTALREV-EXCEL-DOWNLOAD: '총 매출' 탭 엑셀 내보내기 ──────────
  //   화면(MonthlyComparisonSection)에 보이는 두 표를 재구성 없이 그대로 시트화 —
  //   시트1 '일자별매출비교(당월vs전월)' + 시트2 '실장별일별매출'(한 파일 2시트, AC-2).
  //   목표매출(MonthlyTargetSection)은 매출표가 아닌 목표라 제외. db_change=false.
  const exportTotalRevenue = () => {
    const sheets: RevenueSheetSpec[] = [];
    if (monthlyCompare && monthlyCompare.points.length > 0) {
      sheets.push(buildMonthlyCompareSheet(monthlyCompare));
    }
    if (staffDaily && staffDaily.staff.length > 0) {
      sheets.push(buildStaffDailySheet(staffDaily));
    }
    if (sheets.length === 0) {
      toast.info('다운로드할 매출 데이터가 없습니다.');
      return;
    }
    downloadRevenueWorkbook(sheets, `일마감_총매출_${compactDate(date)}`);
    toast.success('Excel 다운로드 완료');
  };

  // ── PDF 내보내기 (결제내역 탭) ──────────────────────────
  // 새 창에 인쇄 친화 HTML을 띄우고 자동 인쇄 다이얼로그 호출
  // 사용자가 "PDF로 저장" 옵션 선택 → 한글 안전 PDF 생성 (별도 패키지 불필요)
  const exportPaymentsPDF = () => {
    const fmt = (n: number) => n.toLocaleString('ko-KR');
    const total = enrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const sumByMethod = (m: string) =>
      enrichedRows.filter(r => r.method === m).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
    const methodSubtotals = (['card', 'cash', 'transfer', 'membership'] as const)
      .map(m => ({ method: m, label: METHOD_KO[m], amount: sumByMethod(m) }))
      .filter(x => x.amount !== 0);

    const rowsHtml = enrichedRows.map(r => `
      <tr class="${r.payment_type === 'refund' ? 'refund' : ''}${r.source === 'manual' ? ' manual' : ''}">
        <td>${r.pay_date}</td>
        <td>${r.pay_time}</td>
        <td>${r.chart_number ?? '-'}</td>
        <td>${r.customer_name}</td>
        <td>${r.lead_source ?? '-'}</td>
        <td>${r.visit_type_label}</td>
        <td>${r.staff_name ?? '-'}</td>
        <td class="num">${r.payment_type === 'refund' ? '-' : ''}${fmt(r.amount)}</td>
        <td>${METHOD_KO[r.method] ?? r.method}</td>
        <td>${r.payment_type === 'refund' ? '환불' : r.source === 'manual' ? '수기' : r.source === 'package' ? '패키지' : '단건'}</td>
      </tr>
    `).join('');

    const subtotalsHtml = methodSubtotals.map(x => `
      <div class="subtotal"><span>${x.label}</span><span class="num">${fmt(x.amount)}</span></div>
    `).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>결제내역 — ${date}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;padding:14mm;color:#111;font-size:11px;margin:0}
  h1{font-size:18px;text-align:center;margin:0 0 4px}
  .meta{text-align:center;color:#666;font-size:11px;margin-bottom:14px}
  .summary{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding:8px 12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px}
  .summary .total-label{font-weight:600;color:#0f766e}
  .summary .total-amount{font-size:16px;font-weight:700;color:#0f766e}
  .subtotals{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px}
  .subtotal{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;min-width:120px;font-size:11px}
  .subtotal span:first-child{color:#64748b}
  .subtotal .num{font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th{background:#f1f5f9;padding:6px 4px;text-align:left;border:1px solid #cbd5e1;font-weight:600;color:#334155}
  td{padding:5px 4px;border:1px solid #e2e8f0;vertical-align:middle}
  td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
  tr.refund{color:#b91c1c;background:#fef2f2}
  tr.manual{background:#f0f9ff}
  tfoot tr{background:#f1f5f9;font-weight:700}
  tfoot td{border-top:2px solid #475569}
  @media print{body{padding:8mm}.no-print{display:none}}
</style></head><body>
<h1>결제내역 — 일마감</h1>
<div class="meta">${date} · ${enrichedRows.length}건</div>
<div class="summary">
  <span class="total-label">총 결제 합계</span>
  <span class="total-amount">${fmt(total)}원</span>
</div>
${methodSubtotals.length ? `<div class="subtotals">${subtotalsHtml}</div>` : ''}
<table>
<thead>
<tr>
  <th>날짜</th><th>시간</th><th>차트번호</th><th>성함</th><th>내원경로</th>
  <th>초진/재진</th><th>결제담당</th><th>결제금액</th><th>결제수단</th><th>구분</th>
</tr>
</thead>
<tbody>${rowsHtml || '<tr><td colspan="10" style="text-align:center;padding:20px;color:#94a3b8">결제내역이 없습니다</td></tr>'}</tbody>
${enrichedRows.length ? `<tfoot><tr><td colspan="7">합계</td><td class="num">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>` : ''}
</table>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해주세요.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
    toast.success('PDF 인쇄 다이얼로그를 열었어요. "PDF로 저장"을 선택하세요.');
  };

  // ── PDF 내보내기 (총 합계 탭) ──────────────────────────
  const exportSummaryPDF = () => {
    const fmt = (n: number) => n.toLocaleString('ko-KR');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>일마감 — ${date}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;padding:14mm;color:#111;font-size:12px;margin:0}
  h1{font-size:20px;text-align:center;margin:0 0 4px}
  .meta{text-align:center;color:#666;font-size:11px;margin-bottom:18px}
  .grand{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding:12px 16px;background:#f0fdfa;border:2px solid #14b8a6;border-radius:8px}
  .grand .label{font-size:13px;font-weight:600;color:#0f766e}
  .grand .amount{font-size:22px;font-weight:800;color:#0f766e}
  table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11.5px}
  th{background:#f1f5f9;padding:7px 8px;text-align:left;border:1px solid #cbd5e1;font-weight:600;color:#334155}
  td{padding:6px 8px;border:1px solid #e2e8f0}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  tr.total td{font-weight:700;background:#f8fafc}
  h3{margin:18px 0 6px;font-size:13px;color:#334155;border-bottom:2px solid #14b8a6;padding-bottom:4px}
  .recon{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .recon .row{padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc}
  .recon .row .lbl{font-size:11px;color:#64748b}
  .recon .row .vals{display:flex;justify-content:space-between;margin-top:4px}
  .recon .diff{font-weight:700}
  .recon .diff.zero{color:#0f766e}
  .recon .diff.pos{color:#0f766e}
  .recon .diff.neg{color:#b91c1c}
  .memo{padding:10px 12px;background:#fefce8;border:1px solid #fde047;border-radius:6px;white-space:pre-wrap}
  @media print{body{padding:8mm}}
</style></head><body>
<h1>일마감 — ${date}</h1>
<div class="meta">${clinic?.name ?? '오블리브 풋센터'}${isClosed ? ' · 마감 확정' : ' · 임시저장'}</div>

<div class="grand">
  <span class="label">당일 매출 합계 (패키지차감 제외)</span>
  <span class="amount">${fmt(totals.grossTotal)}원</span>
</div>

<h3>결제수단별 내역</h3>
<table>
<thead><tr><th>구분</th><th>카드</th><th>현금</th><th>이체</th><th>패키지차감(매출제외)</th><th>매출합계</th></tr></thead>
<tbody>
<tr><td>패키지구매</td><td class="num">${fmt(totals.pkgCardGross)}</td><td class="num">${fmt(totals.pkgCashGross)}</td><td class="num">${fmt(totals.pkgTransferGross)}</td><td class="num">0</td><td class="num">${fmt(totals.pkgCard + totals.pkgCash + totals.pkgTransfer)}</td></tr>
<tr><td>단건</td><td class="num">${fmt(totals.singleCardGross)}</td><td class="num">${fmt(totals.singleCashGross)}</td><td class="num">${fmt(totals.singleTransferGross)}</td><td class="num">${fmt(totals.singleMembership)}</td><td class="num">${fmt(totals.singleCard + totals.singleCash + totals.singleTransfer)}</td></tr>
${totals.refundAmount > 0 ? `<tr><td>환불</td><td class="num" style="color:#b91c1c">-${fmt(totals.refundAmount)}</td><td></td><td></td><td></td><td class="num" style="color:#b91c1c">-${fmt(totals.refundAmount)}</td></tr>` : ''}
<tr class="total"><td>합계(멤버십제외,환불차감)</td><td class="num">${fmt(totals.totalCard)}</td><td class="num">${fmt(totals.totalCash)}</td><td class="num">${fmt(totals.totalTransfer)}</td><td class="num">${fmt(totals.singleMembership)}</td><td class="num">${fmt(totals.grossTotal)}</td></tr>
</tbody>
</table>

<h3>실제 정산 (환불 차감 후 기준)</h3>
<div class="recon">
  <div class="row">
    <div class="lbl">카드 (환불 차감 후)</div>
    <div class="vals"><span>시스템 ${fmt(totals.totalCard)}</span><span>실제 ${fmt(actualCard)}</span></div>
    <div class="vals"><span></span><span class="diff ${cardDiff === 0 ? 'zero' : cardDiff > 0 ? 'pos' : 'neg'}">차이 ${cardDiff > 0 ? '+' : ''}${fmt(cardDiff)}</span></div>
  </div>
  <div class="row">
    <div class="lbl">현금 (환불 차감 후)</div>
    <div class="vals"><span>시스템 ${fmt(totals.totalCash)}</span><span>실제 ${fmt(actualCash)}</span></div>
    <div class="vals"><span></span><span class="diff ${cashDiff === 0 ? 'zero' : cashDiff > 0 ? 'pos' : 'neg'}">차이 ${cashDiff > 0 ? '+' : ''}${fmt(cashDiff)}</span></div>
  </div>
  <div class="row">
    <div class="lbl">이체 (환불 차감 후)</div>
    <div class="vals"><span>시스템 ${fmt(totals.totalTransfer)}</span><span>실제 ${fmt(actualTransfer)}</span></div>
    <div class="vals"><span></span><span class="diff ${transferDiff === 0 ? 'zero' : transferDiff > 0 ? 'pos' : 'neg'}">차이 ${transferDiff > 0 ? '+' : ''}${fmt(transferDiff)}</span></div>
  </div>
</div>

${totals.refundAmount > 0 ? `<h3>환불 내역</h3><table><tbody><tr><td>단건 환불</td><td class="num">${fmt(totals.refundSingleAmount)}</td></tr><tr><td>패키지 환불</td><td class="num">${fmt(totals.refundPkgAmount)}</td></tr><tr class="total"><td>환불 합계</td><td class="num">${fmt(totals.refundAmount)}</td></tr></tbody></table>` : ''}
${unpaid.length > 0 ? `<h3>미수</h3><div>결제대기 ${unpaid.length}건</div>` : ''}
${memo ? `<h3>메모</h3><div class="memo">${memo.replace(/</g, '&lt;')}</div>` : ''}
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해주세요.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
    toast.success('PDF 인쇄 다이얼로그를 열었어요. "PDF로 저장"을 선택하세요.');
  };

  const handlePrint = () => window.print();

  // ── 수기 삭제 ─────────────────────────────────────────────
  const deleteManual = async (id: string, raw?: ManualPaymentRow) => {
    if (!window.confirm('수기 결제내역을 삭제하시겠습니까?')) return;
    // T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 편집 모드에서는 원자 재확정 경로(soft-void + 감사).
    if (isClosed && confirmedEditMode) {
      await saveConfirmedEdit(
        { kind: 'void', id },
        [{
          field: '수기수납 삭제',
          old_value: raw ? `${raw.customer_name} ${formatAmount(raw.amount)} ${METHOD_KO[raw.method] ?? raw.method}` : id,
          new_value: null,
        }],
      );
      return;
    }
    const { error } = await supabase.from('closing_manual_payments').delete().eq('id', id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('삭제됨');
    qc.invalidateQueries({ queryKey: ['closing-manual', clinic?.id, date] });
  };

  // ──────────────────────────────────────────────────────────
  // 렌더
  // ──────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-auto space-y-4 p-4">
      {/* 헤더 */}
      <div className="flex items-end justify-between">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label>마감일</Label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          {isClosed && (
            <Badge variant="success" className="mb-1">
              <Lock className="mr-1 h-3 w-3" /> 마감됨
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'summary' | 'payments' | 'compare')}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="summary" className="flex-1 sm:flex-none">
            총 합계
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex-1 sm:flex-none">
            결제내역 <Badge variant="secondary" className="ml-1.5">{enrichedRows.length}</Badge>
          </TabsTrigger>
          {/* T-20260808-foot-DAYCLOSE-REVENUE-COMPARE-TAB: 통계 '일자별 매출 비교(당월 vs 전월)' 재노출 탭.
              T-20260809-foot-DAYCLOSE-TOTALREVENUE-REDESIGN (item5): '총 매출' = 매출 surface →
              canViewTotalRevenue(has_ops_authority) 열람권자에게만 트리거 노출(전직원 열람 supersede). */}
          {canViewTotalRevenue && (
            <TabsTrigger value="compare" className="flex-1 sm:flex-none">
              총 매출
            </TabsTrigger>
          )}
          {/* T-20260811-foot-SALESAGG-THERAPIST-TAB: 신규 '총매출(치료)' 탭 트리거 — admin+therapist 만 노출. */}
          {canViewTherapistSales && (
            <TabsTrigger value="therapist_sales" className="flex-1 sm:flex-none">
              총매출(치료)
            </TabsTrigger>
          )}
        </TabsList>

        {/* ════════════════════════ 탭 1: 총 합계 ════════════════════════ */}
        <TabsContent value="summary" className="space-y-4">
          {/* 액션 버튼 */}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={exportCSV} title="CSV 다운로드">
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportSummaryPDF} title="PDF로 저장 — 인쇄 다이얼로그에서 'PDF로 저장' 선택">
              <FileDown className="mr-1 h-4 w-4" /> PDF
            </Button>
            <Button variant="ghost" size="icon" onClick={handlePrint} title="인쇄">
              <Printer className="h-4 w-4" />
            </Button>
            {/* T-20260520-foot-RBAC-MENU-EXPAND: 임시저장·마감 확정·재오픈 = admin/manager 전용 */}
            {isAdminOrManager && (isClosed ? (
              <>
                {/* T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 해제(재오픈) 없이 바로 수정 진입 */}
                {canEditConfirmed && !confirmedEditMode && (
                  <Button
                    variant="outline"
                    data-testid="confirmed-edit-enter"
                    onClick={() => setConfirmedEditMode(true)}
                    title="재오픈(해제) 없이 바로 수정 — 저장 시 자동 재확정·이력 기록"
                  >
                    <Pencil className="mr-1 h-4 w-4" /> 확정 상태에서 수정
                  </Button>
                )}
                {confirmedEditMode && (
                  <>
                    <Button variant="outline" data-testid="confirmed-edit-cancel" onClick={cancelConfirmedEdit}>
                      취소
                    </Button>
                    <Button
                      data-testid="confirmed-edit-save"
                      onClick={saveConfirmedReconcile}
                      title="실제정산/메모 변경 저장 — 자동 재확정(이력 기록)"
                    >
                      <Save className="mr-1 h-4 w-4" /> 수정 저장
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => {
                  if (!window.confirm('마감을 재오픈하시겠습니까?')) return;
                  reopen();
                }}>
                  <Unlock className="mr-1 h-4 w-4" /> 재오픈
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => saveDraft(false)} title="수정 가능한 임시저장">
                  <Save className="mr-1 h-4 w-4" /> 임시저장
                </Button>
                <Button onClick={() => saveDraft(true)} title="잠금 처리 — 재오픈 전까지 수정 불가">
                  <Lock className="mr-1 h-4 w-4" /> 마감 확정
                </Button>
              </>
            ))}
          </div>

          {!isClosed && (
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
              <span className="font-medium text-foreground">임시저장</span>은 수정 가능한 중간 저장이고,
              <span className="font-medium text-foreground"> 마감 확정</span>은 잠금 처리되어 재오픈 전까지 수정할 수 없습니다.
            </div>
          )}

          {/* T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 편집 모드 안내 배너 */}
          {isClosed && confirmedEditMode && (
            <div
              data-testid="confirmed-edit-banner"
              className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2"
            >
              <span className="font-semibold">확정 상태에서 수정 중</span> — 실제 정산·메모·수기 수납을 바로 고칠 수 있습니다.
              저장하면 <span className="font-medium">자동으로 다시 확정</span>되고 <span className="font-medium">수정 이력</span>(누가·언제·무엇)이 기록됩니다.
            </div>
          )}

          {/* 진행 중 / 결제대기(미수) 경고 — 2-col 병치 (md+ 좌우, sm 1-col)
              T-20260617-foot-CLOSING-INPROG-PAYWAIT-BOXLAYOUT:
              뉴트럴 카드 + 얇은 보더로 톤다운. 식별 포인트는 아이콘·배지·카운트 색으로 한정.
              클릭 동선·차트번호 인접 규약(CHARTNO-B2-P2)·시각/전화 포맷 전부 보존. */}
          {(inProgress.length > 0 || unpaid.length > 0) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* 진행 중 경고 */}
              {inProgress.length > 0 && (
                <Card className="border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-foreground">
                      <Clock className="h-4 w-4 text-orange-500" />
                      진행 중
                      <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-orange-300 text-orange-700 font-semibold">
                        {inProgress.length}건
                      </Badge>
                      <span className="ml-auto text-xs font-normal text-muted-foreground">마감 전 확인</span>
                    </CardTitle>
                  </CardHeader>
                  {/* T-20260617-foot-CLOSING-INPROG-PAYWAIT-MAXH-SCROLL:
                      리스트 영역 고정 max-height + 내부 세로 스크롤. 헤더(제목/카운트)는 CardHeader로 스크롤 영역 밖 고정.
                      항목 적으면 자연 높이(스크롤바 미노출), 많아도 박스 외형 일정. 두 박스 동일 max-h로 2-col 균형. */}
                  <CardContent className="space-y-1 text-sm text-foreground max-h-48 overflow-y-auto">
                    {inProgress.map(c => (
                      <button
                        key={c.id}
                        className="flex w-full justify-between rounded px-1 py-0.5 hover:bg-muted transition text-left"
                        onClick={() => navigate('/admin', { state: { openCheckInId: c.id } })}
                      >
                        <span className="flex items-center gap-2">
                          <span>{c.customer_name}</span>
                          {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
                          <span className="font-mono text-xs text-muted-foreground">{chartNoBadge(c.customers?.chart_number ?? null)}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-700">
                            {STATUS_KO[c.status as CheckInStatus] ?? c.status}
                          </Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">{format(new Date(c.checked_in_at), 'HH:mm')}</span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* 미수 경고 */}
              {unpaid.length > 0 && (
                <Card className="border bg-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm text-foreground">
                      <CreditCard className="h-4 w-4 text-amber-500" />
                      결제대기
                      <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-amber-300 text-amber-700 font-semibold">
                        {unpaid.length}건
                      </Badge>
                      <span className="ml-auto text-xs font-normal text-muted-foreground">클릭 → 결제 처리</span>
                    </CardTitle>
                  </CardHeader>
                  {/* T-20260617-foot-CLOSING-INPROG-PAYWAIT-MAXH-SCROLL: 진행중 박스와 동일 max-h-48 → 2-col 높이 균형 */}
                  <CardContent className="space-y-1 text-sm text-foreground max-h-48 overflow-y-auto">
                    {unpaid.map(c => (
                      <button
                        key={c.id}
                        className="flex w-full justify-between rounded px-1 py-0.5 hover:bg-muted transition text-left"
                        onClick={async () => {
                          const { data } = await supabase.from('check_ins').select('*, customers(name, chart_number)').eq('id', c.id).maybeSingle();
                          if (data) setPayTarget(data as CheckIn);
                          else toast.error('체크인을 불러올 수 없습니다');
                        }}
                      >
                        {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
                        <span>{c.customer_name} <span className="font-mono text-muted-foreground">{chartNoBadge(c.customers?.chart_number ?? null)}</span> <span className="text-muted-foreground">{formatPhone(c.customer_phone)}</span></span>
                        <span className="text-xs text-muted-foreground">{format(new Date(c.checked_in_at), 'HH:mm')}</span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* 요약 카드
              T-20260525-foot-CLOSING-CALC-BUG:
              SummaryCard 행값은 GROSS(환불 미차감)로 표시.
              "합계" 카드에 ['환불', -refundAmount] 행 추가 → 행 합계 = grossTotal(NET) ✓
              (구 코드: NET 행값 + 별도 환불 행 → 이중 차감 = 불일치 원인) */}
          {/* T-20260526-foot-CLOSING-PAYCOUNT: rows 3번째 인자 = 건 수 (0건도 표기) */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <SummaryCard
              title="패키지 결제"
              rows={[
                ['카드', totals.pkgCardGross, totals.pkgCardCount],
                ['현금', totals.pkgCashGross, totals.pkgCashCount],
                ['이체', totals.pkgTransferGross, totals.pkgTransferCount],
                ...(totals.refundPkgAmount > 0
                  ? [['환불', -totals.refundPkgAmount, totals.pkgRefundCount] as [string, number, number]]
                  : []),
              ]}
              total={totals.pkgCard + totals.pkgCash + totals.pkgTransfer}
              totalCount={totals.pkgCardCount + totals.pkgCashCount + totals.pkgTransferCount}
            />
            {/* T-20260519-foot-PKG-REVENUE-SPLIT AC-2/AC-3/AC-5:
                단건 결제 합계에서 singleMembership 제외.
                패키지차감건(method='membership')은 이미 package_payments에서 집계됨 */}
            <SummaryCard
              title="단건 결제"
              rows={[
                ['카드', totals.singleCardGross, totals.singleCardCount],
                ['현금', totals.singleCashGross, totals.singleCashCount],
                ['이체', totals.singleTransferGross, totals.singleTransferCount],
                ...(totals.singleMembership > 0
                  ? [['패키지차감(매출제외)', totals.singleMembership] as [string, number]]
                  : []),
                ...(totals.refundSingleAmount > 0
                  ? [['환불', -totals.refundSingleAmount, totals.singleRefundCount] as [string, number, number]]
                  : []),
              ]}
              total={totals.singleCard + totals.singleCash + totals.singleTransfer}
              totalCount={totals.singleCardCount + totals.singleCashCount + totals.singleTransferCount}
            />
            {/* T-20260525-foot-CLOSING-SUM-ERR: 수기결제가 있을 때 수기 소계 카드 추가 */}
            {/* T-20260527-foot-CLOSE-ITEM-COUNT: 수기결제 카드 건 수 추가 — 빨간 박스 전체 적용 */}
            {/* T-20260527-foot-CLOSE-ITEM-COUNT FIX: manualTotal>0 조건 제거 — 0건 상태에서도 항상 렌더 (supervisor QA 요구) */}
            <SummaryCard
              title="수기결제"
              rows={[
                ['카드', totals.manualCard, totals.manualCardCount],
                ['현금', totals.manualCash, totals.manualCashCount],
                ['이체', totals.manualTransfer, totals.manualTransferCount],
              ]}
              total={totals.manualTotal}
              totalCount={totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount}
            />
            {/* ── T-20260820-foot-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL ──────────────────────
                (part2) 결제수단별 실결제 = NET 표기: 카드/현금/이체 총합을 GROSS(환불 미차감) → NET(환불 차감,
                  totals.totalCard/Cash/Transfer)로 전환. 당일 취소(=당일 환불행)가 method 축에서 이미 차감돼
                  '실 결제내역만' 집계된다(reporter 요청2). NET = 실제정산(ReconRow)·마감 저장(daily_closings)·
                  print '합계(멤버십제외,환불차감)' 행과 동일 SSOT → 화면·정산·문서 3자 정합.
                (part1) 인라인 '환불' 행 제거 → 아래 '환불 내역' 별도 박스로 분리(reporter 요청1).
                ★이중 제외 없음(AC-2): 총합은 NET 로 환불 1회만 차감. 환불 내역 박스는 표시(정보)용 — 총합을 추가
                  차감하지 않는다. grossTotal(마감 payload 권위총액)·산식 무변경(순수 표시축 재배치, DA CONSULT 불요).
                ★수기결제 포함/공단 행 = 정보행(SummaryCard 는 명시 total prop 사용, 행 미합산) — total 무영향. */}
            {/* ── T-20260820-foot-CLOSING-CASHSUM-REVENUE-BASIS-REBUCKET (DA CONDITIONAL-GO) ──────────
                DA da_decision_foot_closing_cashsum_revenue_basis_rebucket_20260820.
                결제수단별 총합을 revenue-basis(…Rev, 교차수단 환불=원결제 method 재귀속)로 표시. 김주연 총괄
                field-authority(ts 1787189112, 08-18 정답=735,400) = 마감 현금합계=원결제수단 기준.
                ★ Q2 dual-axis: revenue(매출) primary + 교차수단 환불로 revenue≠drawer 된 수단은 '시재(실지급)'
                  행을 distinct 라벨로 병존 표기(§85 drawer grain 표면 보존·H4 단일 ambiguous 라벨 금지).
                  revenue==drawer(정상일)이면 단일 '총합' 행(불필요 drawer line 강제 X — DA UI 발명 금지).
                ★ Q3 DISPLAY-ONLY: total(grossTotal)·정산 대사(totalCash)·daily_closings 저장·payload·A6 는 drawer
                  net 그대로 불변. 표시 카드 소계 축만 revenue projection. conservation: …Rev 3소계 합 ≡ net 3소계 합. */}
            <SummaryCard
              title="합계 (결제수단별)"
              rows={[
                // Q2 dual-axis: 각 수단 = revenue(매출) 행 + (교차수단 환불로 drawer 와 갈릴 때) 시재(실지급) distinct 행.
                [`카드 총합${totals.totalCardRev !== totals.totalCard ? ' (매출)' : ''}`, totals.totalCardRev, totals.totalCardCount] as [string, number, number],
                ...(totals.totalCardRev !== totals.totalCard
                  ? [['ㄴ 카드 시재 (실지급)', totals.totalCard, undefined] as [string, number, number?]] : []),
                [`현금 총합${totals.totalCashRev !== totals.totalCash ? ' (매출)' : ''}`, totals.totalCashRev, totals.totalCashCount] as [string, number, number],
                ...(totals.totalCashRev !== totals.totalCash
                  ? [['ㄴ 현금 시재 (실지급)', totals.totalCash, undefined] as [string, number, number?]] : []),
                [`이체 총합${totals.totalTransferRev !== totals.totalTransfer ? ' (매출)' : ''}`, totals.totalTransferRev, totals.totalTransferCount] as [string, number, number],
                ...(totals.totalTransferRev !== totals.totalTransfer
                  ? [['ㄴ 이체 시재 (실지급)', totals.totalTransfer, undefined] as [string, number, number?]] : []),
                // T-20260803-foot-MEDAID1-HEALTHFEE-DEDUCT (AC4-GATE b): 공단 대납(건강생활유지비)도 grossTotal 에
                //   포함되므로 결제수단별 합계에 명시 행으로 노출(silent-drop 금지·행 합계=grossTotal 정합).
                ...(totals.singleHealthMaintenance !== 0
                  ? [['공단(건강생활유지비)', totals.singleHealthMaintenance, 0] as [string, number, number]]
                  : []),
                ...(totals.manualTotal > 0
                  ? [['수기결제 포함', totals.manualTotal, totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount] as [string, number, number]]
                  : []),
              ]}
              total={totals.grossTotal}
              totalCount={totals.totalCardCount + totals.totalCashCount + totals.totalTransferCount}
              highlight
            />
            {/* Q4 anti-fabrication 노출: 원결제 linkage 미verify 환불(합성 금지·저장수단 기준 표시). 0건이면 미표기. */}
            {totals.revUnverifiedCount > 0 && (
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground" data-testid="closing-rev-unverified-note">
                ※ 원결제 연결이 없는 환불 {totals.revUnverifiedCount}건(-{formatAmount(totals.revUnverifiedAmount)})은
                수단 재귀속을 확인할 수 없어 저장 수단 기준으로 표시됩니다.
              </p>
            )}
            {/* T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL: 합계 박스 옆 동일 박스 형태 일일 미수금 박스.
                §4-A: 패키지 미수 / 진료비 미수 별도 줄, 합산 단일 '총 미수금' 미표기. 소스=footBilling SSOT. */}
            <DailyOutstandingCard
              packageDue={dailyOutstanding.packageDue}
              consultationDue={dailyOutstanding.consultationDue}
              dueCustomerCount={dailyOutstanding.dueCustomerCount}
            />
          </div>

          {/* ── T-20260717-foot-CLOSING-REFUND-STATS-MISSING: 금일 환불 별도 집계 섹션 ──
              [REOPEN] '차감'은 이미 정상 → 여기서는 금일 환불을 '별도 요약(건수+총액)'으로 표시만 추가.
              소스=refundRows(enrichedRows 의 refund 행) / 수치=totals.refundAmount·totalRefundCount(확정 SSOT 재사용).
              배치=매출 요약(SummaryCard 그리드) 바로 아래(인접 default). 항상 렌더(0건도 명시). */}
          <Card data-testid="closing-refund-summary-card" className="border-rose-200 dark:border-rose-900">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <RotateCcw className="h-4 w-4 text-rose-500" />
                금일 환불
                <Badge
                  variant="outline"
                  className="text-[11px] px-1.5 py-0 border-rose-300 text-rose-700 font-semibold"
                  data-testid="closing-refund-count-badge"
                >
                  {totals.totalRefundCount}건
                </Badge>
                <span className="ml-auto text-sm font-semibold tabular-nums text-rose-700" data-testid="closing-refund-total-amount">
                  총 환불액 {formatAmount(totals.refundAmount)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* ── T-20260820-foot-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL (part1): 결제수단별 환불 breakdown ──
                  reporter 요청: '카드 환불 N건 -X원 / 현금 환불 N건 -X원 / 이체 환불 N건 -X원 / 합계 -X원'.
                  method 축 = Axis-A(원결제 승계 canonical bucket, REFUND-CROSSMETHOD-FWDFIX). 총합=refundAmount(SSOT).
                  0건 엣지도 박스 유지(항상 렌더) — 카드/현금/이체 3행 상시 표기, 기타 수단 환불은 잔여>0 시만. */}
              <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20 p-2.5 space-y-1" data-testid="closing-refund-by-method">
                {([
                  ['카드 환불', totals.refundCardAmount, totals.refundCardCount],
                  ['현금 환불', totals.refundCashAmount, totals.refundCashCount],
                  ['이체 환불', totals.refundTransferAmount, totals.refundTransferCount],
                  ...(totals.refundOtherAmount !== 0 || totals.refundOtherCount !== 0
                    ? [['기타수단 환불', totals.refundOtherAmount, totals.refundOtherCount] as [string, number, number]]
                    : []),
                ] as [string, number, number][]).map(([label, amt, cnt]) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <span className="text-xs text-muted-foreground">{cnt}건</span>
                      <span className={cn('font-medium', amt > 0 ? 'text-rose-700' : 'text-foreground')}>
                        {amt > 0 ? `-${formatAmount(amt)}` : formatAmount(0)}
                      </span>
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-rose-200 dark:border-rose-900 pt-1.5 text-sm font-semibold">
                  <span>합계</span>
                  <span className="flex items-center gap-1.5 tabular-nums text-rose-700">
                    <span className="text-xs font-normal text-muted-foreground">{totals.totalRefundCount}건</span>
                    <span data-testid="closing-refund-by-method-total">{totals.refundAmount > 0 ? `-${formatAmount(totals.refundAmount)}` : formatAmount(0)}</span>
                  </span>
                </div>
              </div>

              {/* 유형별 소계 (단건/패키지) — totals SSOT 재사용 */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>단건 환불 <span className="tabular-nums font-medium text-foreground">{formatAmount(totals.refundSingleAmount)}</span> ({totals.singleRefundCount}건)</span>
                <span>패키지 환불 <span className="tabular-nums font-medium text-foreground">{formatAmount(totals.refundPkgAmount)}</span> ({totals.pkgRefundCount}건)</span>
              </div>

              {refundRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="closing-refund-list">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="py-1.5 pr-2 text-left font-medium">시각</th>
                        <th className="py-1.5 pr-2 text-left font-medium">고객</th>
                        <th className="py-1.5 pr-2 text-left font-medium">차트번호</th>
                        <th className="py-1.5 pr-2 text-left font-medium">유형</th>
                        <th className="py-1.5 pr-2 text-left font-medium">결제수단</th>
                        <th className="py-1.5 pr-2 text-left font-medium">담당자</th>
                        <th className="py-1.5 text-right font-medium">환불액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refundRows.map((r, i) => (
                        <tr key={(r.payment_id ?? r.pkg_payment_id ?? r.sort_key) + ':' + i} className="border-b">
                          <td className="py-1.5 pr-2 text-xs text-muted-foreground tabular-nums">{r.pay_time}</td>
                          <td className="py-1.5 pr-2">{r.customer_name}</td>
                          <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{chartNoBadge(r.chart_number)}</td>
                          <td className="py-1.5 pr-2 text-xs">{r.source === 'package' ? '패키지' : '단건'}</td>
                          <td className="py-1.5 pr-2 text-xs">{METHOD_KO[r.method as Method] ?? r.method}</td>
                          {/* T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY: 데이터소스 정정 —
                              기존 r.staff_name(=고객 배정담당 assigned_staff, 실제 환불 처리자 아님·버그)
                              → r.processor_name(payments.created_by→user_profiles.name). 미기록 '—'.
                              ★컬럼 라벨(담당자→처리자) / 별도 신설 여부는 reporter 확인 대기(responder 경유) — 데이터소스만 우선 정정. */}
                          <td className="py-1.5 pr-2 text-xs" data-testid="closing-refund-processor">{r.processor_name ?? '—'}</td>
                          <td className="py-1.5 text-right tabular-nums font-medium text-rose-700">-{formatAmount(r.amount)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="py-1.5" colSpan={6}>환불 합계 ({totals.totalRefundCount}건)</td>
                        <td className="py-1.5 text-right tabular-nums text-rose-700">-{formatAmount(totals.refundAmount)}</td>
                      </tr>
                      {/* ── T-20260820-foot-REFUNDLIST-METHODTOTALS-FOOTER (김주연 총괄 2026-08-20) ──
                          '금일 환불 내역' 목록 하단에 결제수단별 총 환불금액(카드/현금/이체) 각각 표기.
                          ★method 축 = sibling T-20260820-CLOSING-REFUNDBOX-SPLIT-CANCELEXCL / FWDFIX(원결제 승계) 와
                            동일 refund method partition 재사용(§13.1.C dual-authoring 금지) — totals.refund{Card,Cash,Transfer,Other}
                            SSOT 그대로. 신규 산식 0. 합계(카드+현금+이체+기타)≡refundAmount(silent-drop 방지 기타 잔여 가드).
                          ★표시 위치=목록 table footer(sibling 상단 breakdown 박스와 위치 상이·중복 아님). */}
                      {([
                        ['카드 환불 합계', totals.refundCardAmount, totals.refundCardCount],
                        ['현금 환불 합계', totals.refundCashAmount, totals.refundCashCount],
                        ['이체 환불 합계', totals.refundTransferAmount, totals.refundTransferCount],
                        ...(totals.refundOtherAmount !== 0 || totals.refundOtherCount !== 0
                          ? [['기타수단 환불 합계', totals.refundOtherAmount, totals.refundOtherCount] as [string, number, number]]
                          : []),
                      ] as [string, number, number][]).map(([label, amt, cnt], mi) => (
                        <tr key={label} className={cn('text-xs', mi === 0 && 'border-t')} data-testid="closing-refund-list-method-total">
                          <td className="py-1 text-muted-foreground" colSpan={6}>{label} ({cnt}건)</td>
                          <td className={cn('py-1 text-right tabular-nums font-medium', amt > 0 ? 'text-rose-700' : 'text-muted-foreground')}>
                            {amt > 0 ? `-${formatAmount(amt)}` : formatAmount(0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="closing-refund-empty">금일 환불 내역이 없습니다.</p>
              )}
            </CardContent>
          </Card>

          {/* 시술별 통계 — T-20260715-foot-DAYCLOSE-STAT-PAYONLY: 실수납/결제 confirmed(net>0) 건만 */}
          {procedureStats.length > 0 && (
            <Card data-testid="procedure-stats-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">시술별 통계 ({procedureStats.reduce((s, p) => s + p.count, 0)}건)</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-medium">시술명</th>
                      <th className="py-1.5 text-right font-medium">건수</th>
                      {/* T-20260715-foot-DAYCLOSE-STATCOL-LABEL-TREATAMT: '매출'→'시술금액' (B안, 김주연 총괄 권고). 집계 로직 무변경(STAT-PAYONLY 담당). */}
                      <th className="py-1.5 text-right font-medium">시술금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {procedureStats.map(p => (
                      <tr key={p.service_name} className="border-b">
                        <td className="py-1.5">{p.service_name}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.count}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatAmount(p.revenue)}</td>
                      </tr>
                    ))}
                    <tr className="font-medium">
                      <td className="py-1.5">합계</td>
                      <td className="py-1.5 text-right tabular-nums">{procedureStats.reduce((s, p) => s + p.count, 0)}</td>
                      <td className="py-1.5 text-right tabular-nums" data-testid="procedure-stats-total-revenue">{formatAmount(procedureStats.reduce((s, p) => s + p.revenue, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* 실제 정산 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">실제 정산</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReconRow label="카드" system={totals.totalCard} actual={actualCard} diff={cardDiff} onChange={setActualCard} disabled={isClosed && !confirmedEditMode} />
                <ReconRow label="현금" system={totals.totalCash} actual={actualCash} diff={cashDiff} onChange={setActualCash} disabled={isClosed && !confirmedEditMode} />
                <ReconRow label="이체" system={totals.totalTransfer} actual={actualTransfer} diff={transferDiff} onChange={setActualTransfer} disabled={isClosed && !confirmedEditMode} />
              </div>
              <div className="mt-3 flex items-center justify-between rounded-md bg-muted px-4 py-2 text-sm">
                <span className="font-medium">총 차이</span>
                <span className={totalDiff === 0 ? 'font-semibold' : totalDiff > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-destructive'}>
                  {totalDiff > 0 ? '+' : ''}{formatAmount(totalDiff)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* 메모 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">메모</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={memo}
                onChange={e => setMemo(e.target.value)}
                placeholder="특이사항"
                disabled={isClosed && !confirmedEditMode}
                rows={3}
              />
            </CardContent>
          </Card>

          {/* T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 후 수정 이력(화면 즉시노출) */}
          {editLog.length > 0 && (
            <Card data-testid="closing-edit-log-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">확정 후 수정 이력 ({editLog.length}건)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60">
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="py-2 px-3 text-left font-medium w-36">일시</th>
                        <th className="py-2 px-2 text-left font-medium w-24">수정자</th>
                        <th className="py-2 px-2 text-left font-medium">항목</th>
                        <th className="py-2 px-2 text-left font-medium">변경 전 → 후</th>
                        <th className="py-2 px-2 text-center font-medium w-16">버전</th>
                      </tr>
                    </thead>
                    <tbody data-testid="closing-edit-log-rows">
                      {editLog.map(l => (
                        <tr key={l.id} className="border-b">
                          <td className="py-1.5 px-3 tabular-nums text-xs text-muted-foreground">
                            {format(new Date(l.edited_at), 'yyyy-MM-dd HH:mm')}
                          </td>
                          <td className="py-1.5 px-2 text-xs">{l.editor?.name ?? '—'}</td>
                          <td className="py-1.5 px-2 text-xs">{l.field}</td>
                          <td className="py-1.5 px-2 text-xs">
                            {l.old_value != null && l.old_value !== '' ? l.old_value : '—'}
                            <span className="mx-1 text-muted-foreground">→</span>
                            {l.new_value != null && l.new_value !== '' ? l.new_value : '—'}
                          </td>
                          <td className="py-1.5 px-2 text-center tabular-nums text-xs">{l.revision_after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ════════════════════════ 탭 2: 결제내역 ════════════════════════ */}
        <TabsContent value="payments" className="space-y-4">
          {/* T-20260708-foot-REDPAY-CLOSING-TAB AC-2: 결제 탭 하위 '레드페이' 하위탭 신설.
              기존 CRM 수납 레이아웃·동작 무손상 — 아래 전체를 'CRM 수납' 하위탭으로 감싸고
              '레드페이' 하위탭(카드단말기 자동수집 대조)만 신규 추가. */}
          <Tabs value={paySubTab} onValueChange={(v) => setPaySubTab(v as 'crm' | 'redpay' | 'receipt')}>
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="crm" className="flex-1 sm:flex-none">CRM 수납</TabsTrigger>
              <TabsTrigger value="redpay" className="flex-1 sm:flex-none">레드페이</TabsTrigger>
              {/* T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD: 영수증 수납 = 레드페이 우측 3번째 하위탭 */}
              <TabsTrigger value="receipt" className="flex-1 sm:flex-none">영수증 수납</TabsTrigger>
            </TabsList>

            <TabsContent value="crm" className="space-y-4">
          {/* C2-MANAGER-PAYMENT-MAP: 담당자 필터 + 액션 버튼 */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground">
                {/* T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 건수=표시 행(병합 환불 제외) / 합계=net(병합 환불 포함 → 회귀 0) */}
                총 <span className="font-semibold text-foreground">{filteredEnrichedRows.filter(r => !r.merged_refund).length}건</span> ·
                합계 <span className="font-semibold text-emerald-700">{formatAmount(filteredEnrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0))}</span>
              </div>
              {/* 담당자 필터 드롭다운 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">담당자</span>
                <select
                  value={staffFilter}
                  onChange={e => setStaffFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                >
                  <option value="">전체</option>
                  {/* T-20260522-foot-CLOSING-STAFF-DROP AC-1(5/24 확장): 2번차트 동일 — director(원장)+therapist(치료사) 제외, 상담실장+데스크만 */}
                  {/* T-20260522-foot-STAFF-NAME-UNIFY: display_name(구성명) fallback to name */}
                  {/* T-20260614-foot-STAFF-DROPDOWN-ROLE-SORT: 표시 순서만 role 정렬(상담실장→코디) — 2번차트와 동일 헬퍼 */}
                  {staffList.filter(s => s.role !== 'director' && s.role !== 'therapist').sort((a, b) => staffRoleSortIndex(a.role) - staffRoleSortIndex(b.role)).map(s => (
                    <option key={s.id} value={s.display_name || s.name}>{s.display_name || s.name}</option>
                  ))}
                  {/* T-20260522-foot-DAILY-SETTLE-STAFF AC-3: '미배정' → '미지정' */}
                  <option value="미지정">미지정</option>
                </select>
                {staffFilter && (
                  <button
                    onClick={() => setStaffFilter('')}
                    className="text-xs text-muted-foreground hover:text-foreground px-1"
                    title="필터 초기화"
                  >✕</button>
                )}
              </div>
              {/* T-20260530-foot-CLOSING-PAYMETHOD-FILTER: 결제수단 필터 드롭다운 */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">결제수단</span>
                <select
                  value={methodFilter}
                  onChange={e => setMethodFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                >
                  <option value="">전체</option>
                  {(['card', 'cash', 'transfer', 'membership'] as const).map(m => (
                    <option key={m} value={m}>{METHOD_KO[m]}</option>
                  ))}
                </select>
                {methodFilter && (
                  <button
                    onClick={() => setMethodFilter('')}
                    className="text-xs text-muted-foreground hover:text-foreground px-1"
                    title="필터 초기화"
                  >✕</button>
                )}
              </div>
              {/* T-20260819-foot-CLOSING-TERMINAL-FILTER: 단말기(레드페이 TID) 필터 드롭다운 — 담당자·결제수단과 AND 결합.
                  옵션 = 당일 결제에 매칭된 단말 TID(레드페이 자동수집). 매칭 0건이면 '전체'만(기존동작). */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">단말기</span>
                <select
                  value={terminalFilter}
                  onChange={e => setTerminalFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                >
                  <option value="">전체</option>
                  {terminalOptions.map(tid => (
                    <option key={tid} value={tid}>{terminalOptionLabel(tid)}</option>
                  ))}
                </select>
                {terminalFilter && (
                  <button
                    onClick={() => setTerminalFilter('')}
                    className="text-xs text-muted-foreground hover:text-foreground px-1"
                    title="필터 초기화"
                  >✕</button>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {/* T-20260520-foot-RBAC-MENU-EXPAND: 수기 추가 = admin/manager 전용 */}
              {/* T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 후에는 '확정 편집' 모드에서만(원자 재확정+감사) */}
              {isAdminOrManager && (!isClosed || confirmedEditMode) && (
                <Button variant="outline" size="sm" onClick={() => { setManualEditTarget(null); setShowManualDialog(true); }}>
                  <Plus className="mr-1 h-4 w-4" /> 수기 추가
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportExcel} title="Excel 다운로드">
                <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={exportPaymentsPDF} title="PDF로 저장 — 인쇄 다이얼로그에서 'PDF로 저장' 선택">
                <FileDown className="mr-1 h-4 w-4" /> PDF
              </Button>
              <Button variant="ghost" size="icon" onClick={handlePrint} title="인쇄">
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 결제내역 테이블 */}
          <Card>
            <CardContent className="p-0">
              {/* T-20260525-foot-CLOSING-NAV-BUG AC-4: ref + onScroll으로 스크롤 위치 보존 */}
              <div
                ref={paymentsTableRef}
                className="overflow-auto"
                onScroll={(e) => { scrollTopRef.current = e.currentTarget.scrollTop; }}
              >
                {/* ════ T-20260804-foot-DAYCLOSE-PAYHIST-LAYOUT-3CHG ════
                    AC-1 컬럼 순서 재배치: [시간][성함|차트번호][진료구분][내원경로][담당자][결제금액]…[구분][환불].
                      · [성함]+[차트번호] 병합(성함 상단 + 차트번호 하단, 차트번호 클릭→2번차트 팝업 보존).
                      · [진료구분](구 초진/재진) ↔ [내원경로] 순서 스왑, [담당자](구 결제담당) 라벨 통일.
                      · [날짜]/[과세]/[비과세]는 '삭제 아님' 원칙에 따라 보존(리포터 shorthand 생략분).
                      · ⚠ [시술명] 컬럼은 AC-3(수납 상세 팝업·상병명/구분 신규필드, DA CONSULT-REPLY GO 대기)
                        랜딩 시 [내원경로]-[담당자] 사이에 삽입 예정 — 본 랜딩은 view층(AC-1/AC-2)만.
                    AC-2 레이아웃 통일: 환자별 탭(SalesPatientTab) 스타일 기준 — text-xs·py-1.5·border-collapse·hover:bg-teal-50/50. */}
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur-sm">
                    <tr>
                      <th className="whitespace-nowrap border-b px-3 py-1.5 text-left font-medium text-muted-foreground w-24">날짜</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium text-muted-foreground w-14">시간</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium text-muted-foreground w-28">성함 | 차트번호</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium text-muted-foreground w-16">진료구분</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium text-muted-foreground w-20">내원경로</th>
                      {/* T-20260805-foot-DAYCLOSE-AC3-DXGUBUN-POPUP: [시술명] 컬럼(신규) — [내원경로]-[담당자] 사이 삽입(AC-1 예정 위치). 셀 클릭 → 수납 상세 팝업. */}
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium text-muted-foreground w-28">시술명</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium text-muted-foreground w-20">담당자</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-right font-medium text-muted-foreground w-24">결제금액</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-right font-medium text-muted-foreground w-20">과세</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-right font-medium text-muted-foreground w-20">비과세</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-center font-medium text-muted-foreground w-16">현금영수증</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium text-muted-foreground w-16">결제수단</th>
                      {/* T-20260804-foot-DAYCLOSE-PAYHIST-REFUND-BADGE-VERTICAL: 환불 시 배지 2~3개 수용 위해 w-16→w-24 */}
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-center font-medium text-muted-foreground w-24">구분</th>
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-center font-medium text-muted-foreground w-16">환불</th>
                      {/* ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3): 기존 [환불] 컬럼 오른쪽 신규 컬럼(플랜A 환불 BETA).
                          ★T-20260810-foot-CONSULTROOM-PAYBTN-ADD-REFUNDCOL-RENAME(AC-2): 컬럼 헤더 표기 '플랜A 환불'→'CRM 환불 BETA'로 rename(현장 직관성·'플랜A'는 내부명칭). 버튼 내부문구 '단말기 취소' 및 짝맞춤 로직(VG-4) 무변경. */}
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-center font-medium text-muted-foreground w-20">CRM 환불 BETA</th>
                      {/* ★T-20260813-foot-PLANA-PAYINFO-CONFIRM-COLUMN: [CRM 환불 BETA] 컬럼 오른쪽 신규 [결제정보 확인] 컬럼.
                          플랜A(코밴 CAT 단말기 직결결제) 승인응답(cband_payment_attempts.raw_response) 상세 열람 → 플랜A 강점 현장 노출.
                          활성=플랜A행(payment_attempt_id ∧ external_approval_no) / 비활성=기존·현금·이체행(회색+안내문구). 조회 전용. */}
                      <th className="whitespace-nowrap border-b px-2 py-1.5 text-center font-medium text-muted-foreground w-20">결제정보 확인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEnrichedRows.length === 0 && (
                      <tr>
                        <td colSpan={16} className="py-8 text-center text-sm text-muted-foreground">
                          결제내역이 없습니다
                        </td>
                      </tr>
                    )}
                    {/* T-20260715-foot-DAYCLOSE-PAYGATE-REFUNDROW REQ②: 병합된 환불행은 표시 스킵(원결제행에 annotate). */}
                    {/* T-20260715-foot-DAYCLOSE-LIST-PATIENT-GROUP: 동일 환자(차트+성함) 그룹 묶음 render.
                        groupedDisplayRows = filteredEnrichedRows(merged_refund 스킵)를 환자 그룹으로 재배열. */}
                    {groupedDisplayRows.map(({ row: r, indexInGroup, groupSize }, i) => {
                      const isContinuation = indexInGroup > 0;      // 그룹 2번째 이후 행 → 들여쓰기
                      const isGroupStart = indexInGroup === 0;
                      const isMultiGroup = groupSize > 1;
                      return (
                      <tr
                        key={`row-${i}`}
                        data-testid="closing-pay-row"
                        data-group-index={indexInGroup}
                        data-group-size={groupSize}
                        className={cn(
                          // AC-2: 환자별 탭(SalesPatientTab) hover 통일
                          'border-b transition-colors hover:bg-teal-50/50',
                          r.payment_type === 'refund' && 'bg-red-50 text-red-700',
                          // T-20260715 REQ②: 환불된 원결제행 — 옅은 적색 틴트로 환불 표기
                          r.refunded && 'bg-red-50/40',
                          r.source === 'manual' && 'bg-sky-50',
                          // PATIENT-GROUP: 새 다건 그룹 시작 행(첫 행 제외)에 그룹 구분선
                          isMultiGroup && isGroupStart && i > 0 && 'border-t-2 border-t-emerald-100',
                          // PATIENT-GROUP: 그룹 연속 행 — 좌측 emerald 강조선(묶음 시각 표시)
                          isContinuation && 'border-l-2 border-l-emerald-300',
                        )}
                      >
                        <td className="px-3 py-1.5 tabular-nums text-xs text-muted-foreground">{r.pay_date}</td>
                        <td className="px-2 py-1.5 tabular-nums text-xs">
                          {r.pay_time}
                          {/* T-20260715 REQ②: 결제 업로드 시각(위) + 환불 신청 시각(아래) 각각 표기 */}
                          {r.refunded && (
                            <div className="text-[10px] text-red-600 leading-tight" data-testid="refund-requested-at">
                              환불 {r.refund_date && r.refund_date !== r.pay_date ? `${r.refund_date} ` : ''}{r.refund_time}
                            </div>
                          )}
                        </td>
                        {/* AC-1: [성함 | 차트번호] 병합 셀 — 성함(상단) + 차트번호(하단).
                            PATIENT-GROUP 연속행 들여쓰기·↳ 커넥터 보존.
                            T-20260717-foot-CLOSING-CHARTNUM-POPUP: 차트번호 클릭 → 2번차트(/chart/:customerId) 별도 팝업창(window.open)
                              row_customer_id 있는 행만 클릭/hover 활성(수기행 비활성). 병합 후에도 팝업 동선 보존. */}
                        <td className={cn('px-2 py-1.5', isContinuation && 'pl-5')}>
                          <div className="font-medium">
                            {isContinuation ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="text-emerald-500/70" data-testid="group-connector">↳</span>
                                {r.customer_name}
                              </span>
                            ) : (
                              r.customer_name
                            )}
                          </div>
                          <div
                            className={cn(
                              'text-[10px] text-muted-foreground',
                              r.row_customer_id && 'cursor-pointer hover:text-primary hover:underline',
                            )}
                            onClick={
                              r.row_customer_id
                                ? () =>
                                    window.open(
                                      `${window.location.origin}/chart/${r.row_customer_id}`,
                                      `foot-chart-${r.row_customer_id}`,
                                      'width=1200,height=900,scrollbars=yes,resizable=yes',
                                    )
                                : undefined
                            }
                            data-testid="closing-chartno-cell"
                          >
                            {r.chart_number ?? '-'}
                          </div>
                        </td>
                        {/* AC-1: [진료구분](구 초진/재진) ↔ [내원경로] 순서 스왑 — 진료구분 먼저 */}
                        <td className="px-2 py-1.5 text-xs">{r.visit_type_label}</td>
                        <td className="px-2 py-1.5 text-xs">{r.lead_source ?? '-'}</td>
                        {/* T-20260805-foot-DAYCLOSE-AC3-DXGUBUN-POPUP: [시술명] 셀 — 클릭 시 수납 상세 팝업(payment 소스 + payment_id 有 행만 활성).
                            시술명 = 그 결제 check_in 의 시술 항목명(serviceNamesByCheckIn). 패키지/수기 행은 '-' 비활성. */}
                        {(() => {
                          const svcName = (r.source === 'payment' && r.pay_check_in_id)
                            ? (serviceNamesByCheckIn.get(r.pay_check_in_id) ?? null)
                            : null;
                          const clickable = r.source === 'payment' && !!r.payment_id;
                          return (
                            <td
                              className={cn(
                                'px-2 py-1.5 text-xs max-w-[160px] truncate',
                                clickable && 'cursor-pointer text-teal-700 hover:underline',
                              )}
                              data-testid="closing-service-name-cell"
                              title={clickable ? '수납 상세 보기' : undefined}
                              role={clickable ? 'button' : undefined}
                              onClick={clickable ? () => setSusuDetailPaymentId(r.payment_id!) : undefined}
                            >
                              {svcName ?? '-'}
                            </td>
                          );
                        })()}
                        {/* T-20260522-foot-DAILY-SETTLE-STAFF AC-3: NULL → '미지정' (AC-1 라벨 결제담당→담당자) */}
                        {/* T-20260806-foot-CLOSING-REFUND-PROCESSOR-BADGE-REPOSITION: '환불처리 직원명' 서브라인을
                            담당자(중앙) 컬럼 → 오른쪽 배지 셀(패키지/환불/완료 배지 옆)로 이동(김주연 총괄, 스크린샷 빨간 화살표 위치).
                            담당자 셀은 staff_name(배정담당)만 표시로 원복. 표시 로직/null 가드는 predecessor(9802b523) 그대로 유지·포지셔닝만 변경. */}
                        <td className="px-2 py-1.5 text-xs">
                          {r.staff_name ?? <span className="text-muted-foreground/60">미지정</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {r.payment_type === 'refund' ? '-' : ''}{formatAmount(r.amount)}
                          {/* T-20260715 REQ②: 원결제행에 병합된 환불액(양수) 병기 */}
                          {/* T-20260713 [FOLD] AC-B2: 같은날 병합액 없을 때도 교차일 누적 환불액을 병기 */}
                          {r.refunded && r.refund_amount ? (
                            <div className="text-[10px] text-red-600 leading-tight" data-testid="refund-amount">
                              환불 -{formatAmount(r.refund_amount)}
                            </div>
                          ) : !r.refunded && refundedTotalForRow(r) > 0 ? (
                            <div className="text-[10px] text-red-600 leading-tight" data-testid="refund-amount">
                              환불 -{formatAmount(refundedTotalForRow(r))}
                            </div>
                          ) : null}
                        </td>
                        {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세/현금영수증 */}
                        <td className="px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                          {r.taxable_amount != null && r.taxable_amount > 0 ? formatAmount(r.taxable_amount) : '-'}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                          {r.tax_exempt_amount != null && r.tax_exempt_amount > 0 ? formatAmount(r.tax_exempt_amount) : '-'}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {r.cash_receipt_issued === true ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700 text-xs">
                              <span>✅</span>
                              <span className="text-[10px]">
                                {r.cash_receipt_type === 'income_deduction' ? '소득' : r.cash_receipt_type === 'expense_proof' ? '지출' : ''}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant="outline" className="text-xs">
                            {METHOD_KO[r.method] ?? r.method}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {/* T-20260804-foot-DAYCLOSE-PAYHIST-REFUND-BADGE-VERTICAL: 환불 시 배지 2~3개가 좁은 셀에서
                              flex-shrink + CJK 문자단위 break 로 한 글자 폭까지 줄어 '환/불' 세로 쌓임 발생.
                              → 각 배지 whitespace-nowrap(문자 세로쪼갬 차단) + shrink-0(수축 차단), 컨테이너 flex-wrap(넘치면 줄내림·각 배지는 가로 유지). */}
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            <Badge
                              variant={r.payment_type === 'refund' ? 'destructive' : r.source === 'manual' ? 'default' : 'secondary'}
                              className="text-xs whitespace-nowrap shrink-0"
                            >
                              {r.payment_type === 'refund' ? '환불' : r.source === 'manual' ? '수기' : r.source === 'package' ? '패키지' : '단건'}
                            </Badge>
                            {/* T-20260715 REQ②: 환불된 원결제행 — '환불' 표기(새 빨간 행 대신 기존 행 annotate) */}
                            {/* T-20260713 [FOLD] AC-B2: 교차일 환불(같은날 병합 미발생)도 배지 노출 */}
                            {(r.refunded || refundedTotalForRow(r) > 0) && (
                              <Badge variant="destructive" className="text-xs whitespace-nowrap shrink-0" data-testid="refunded-badge">환불</Badge>
                            )}
                            {/* AC-B1: 완전환불(잔여 0) 시각 표시 */}
                            {isFullyRefunded(r) && (
                              <Badge variant="outline" className="text-[10px] whitespace-nowrap shrink-0 border-red-300 text-red-500" data-testid="fully-refunded-badge">완료</Badge>
                            )}
                          </div>
                          {/* T-20260806-foot-CLOSING-REFUND-PROCESSOR-BADGE-REPOSITION: '환불처리 직원명'을 담당자(중앙) 컬럼에서
                              여기 배지 셀(패키지/환불/완료 배지 아래·환불 버튼 쪽)로 이동 표시(김주연 총괄, 스크린샷 빨간 화살표 위치).
                              표시 판정(refundProcessorForRow)·null 가드('—')는 predecessor(9802b523) 그대로 재사용, 포지셔닝만 변경. */}
                          {(() => {
                            const rp = refundProcessorForRow(r);
                            if (!rp.has) return null;
                            return (
                              <div className="text-[10px] text-red-600 leading-tight text-center mt-0.5" data-testid="closing-paydetail-refund-processor">
                                환불처리 {rp.name ?? '—'}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {/* T-20260522-foot-CLOSING-REFUND: 환불 버튼 — admin/manager + 이미 환불 아닌 건 + payment/package 소스만 */}
                            {/* T-20260525-foot-ROLE-PERM-CUSTOM AC-5: canRefund(+consultant/coordinator/therapist)로 확장 */}
                            {/* T-20260713-ITEMSELECT: 클릭 시 같은 고객의 환불 가능 행 묶음을 창으로 전달(유형별 구분+항목 선택) */}
                            {/* [FOLD] AC-B1: 완전환불(잔여 0) 행은 재환불 클릭 차단 → 버튼 숨김 */}
                            {canRefund && r.payment_type !== 'refund' && (r.source === 'payment' || r.source === 'package') && !isFullyRefunded(r) && (
                              rowIsPlanAPayment(r) ? (
                                /* ★AC-3 짝맞춤(VG-4): 플랜A(단말기 직결) 결제행 → 기존 환불 [비활성] 강제. 옆의 BETA 환불 사용.
                                   안내문 회피가 아니라 버튼 자체를 disabled(오환불 사고 차단). hover tooltip 으로 대체 경로 안내. */
                                <span
                                  className="group relative inline-block"
                                  tabIndex={0}
                                  title="이 건은 단말기 직결결제 건입니다 → 옆의 BETA 환불을 사용하세요"
                                  data-testid={`refund-disabled-planA-${r.payment_id ?? r.pkg_payment_id ?? r.sort_key}`}
                                >
                                  <button type="button" disabled className="text-gray-300 cursor-not-allowed p-1">
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </button>
                                  <span
                                    role="tooltip"
                                    className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-56 max-w-[80vw] -translate-x-1/2 rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                                  >
                                    이 건은 단말기 직결결제 건입니다 → 옆의 BETA 환불을 사용하세요
                                  </span>
                                </span>
                              ) : (
                                <button
                                  data-testid="refund-open-btn"
                                  onClick={() => setRefundTarget(gatherCustomerRefundRows(r))}
                                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                  title="환불"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              )
                            )}
                            {/* 수기 수정/삭제 버튼 — 확정 후에는 '확정 편집' 모드에서만(원자 재확정+감사) */}
                            {r.source === 'manual' && r.manual_id && r.manual_raw && isAdminOrManager && (!isClosed || confirmedEditMode) && (
                              <>
                                <button
                                  onClick={() => { setManualEditTarget(r.manual_raw!); setShowManualDialog(true); }}
                                  className="text-muted-foreground hover:text-primary transition-colors p-1"
                                  title="수정"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteManual(r.manual_id!, r.manual_raw)}
                                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                  title="삭제"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                        {/* ★T-20260807-foot-CONSULTROOM-PLANA-PKG-PAY-LOCATION-CORRECT(AC-3) — 신규 컬럼: 플랜A 환불(BETA).
                            짝맞춤(VG-4): CbandTerminalCancelButton 이 플랜A 결제행에서만 활성, 기존방식 결제행에서는 자체 [비활성]+툴팁(AC-8).
                            결제방식으로만 판단(구분 패키지/단건 무관). 패키지행(source==='package')은 packageId 전달 → 취소 refund 가 package_payments 착지. */}
                        <td className="px-1 py-1.5 text-center" data-testid={`planA-refund-cell-${r.payment_id ?? r.pkg_payment_id ?? r.sort_key}`}>
                          {r.payment_type !== 'refund' && (r.source === 'payment' || r.source === 'package') && !isFullyRefunded(r) && clinic && (
                            <CbandTerminalCancelButton
                              payment={{
                                id: (r.source === 'package' ? r.pkg_payment_id : r.payment_id) ?? '',
                                amount: r.amount,
                                clinic_id: clinic.id,
                                check_in_id: r.pay_check_in_id ?? null,
                                external_approval_no: r.external_approval_no ?? null,
                                accounting_date: r.row_accounting_date ?? null,
                                payment_attempt_id: r.payment_attempt_id ?? null,
                                installment: r.pay_installment ?? null,
                              }}
                              clinicId={clinic.id}
                              customerId={r.row_customer_id ?? null}
                              packageId={r.source === 'package' ? (r.package_id ?? null) : null}
                              onDone={() => {
                                refreshPayments();
                                qc.invalidateQueries({ queryKey: ['closing-refund-alldates', clinic.id] });
                              }}
                            />
                          )}
                        </td>
                        {/* ★T-20260813-foot-PLANA-PAYINFO-CONFIRM-COLUMN — 신규 컬럼: [결제정보 확인] (조회 전용).
                            활성/비활성 분기는 CbandPayInfoButton 내부(isPayInfoAvailable = payment_attempt_id ∧ external_approval_no).
                            비활성 행(기존·현금·이체)은 회색 버튼 + 안내 문구("CRM 결제로 진행한 건만 확인할 수 있습니다"). 환불행은 셀 비움. */}
                        <td className="px-1 py-1.5 text-center" data-testid={`payinfo-cell-${r.payment_id ?? r.pkg_payment_id ?? r.sort_key}`}>
                          {r.payment_type !== 'refund' && (r.source === 'payment' || r.source === 'package') && (
                            <CbandPayInfoButton
                              payment={{
                                external_approval_no: r.external_approval_no ?? null,
                                payment_attempt_id: r.payment_attempt_id ?? null,
                              }}
                              rowKey={r.payment_id ?? r.pkg_payment_id ?? r.sort_key}
                            />
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                  {filteredEnrichedRows.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 bg-muted/50 font-semibold">
                        {/* T-20260805-foot-DAYCLOSE-AC3-DXGUBUN-POPUP: [시술명] 컬럼 삽입으로 6→7 (날짜·시간·성함차트·진료구분·내원경로·시술명·담당자) */}
                        <td colSpan={7} className="py-2 px-3 text-sm">합계{staffFilter && ` (${staffFilter})`}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-sm text-emerald-700">
                          {formatAmount(filteredEnrichedRows.reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0))}
                        </td>
                        {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세 합계 */}
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">
                          {(() => {
                            const t = filteredEnrichedRows.reduce((s, r) => s + (r.taxable_amount ?? 0), 0);
                            return t > 0 ? formatAmount(t) : '-';
                          })()}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-xs text-muted-foreground">
                          {(() => {
                            const t = filteredEnrichedRows.reduce((s, r) => s + (r.tax_exempt_amount ?? 0), 0);
                            return t > 0 ? formatAmount(t) : '-';
                          })()}
                        </td>
                        <td className="py-2 px-2 text-center text-xs text-muted-foreground">
                          {(() => {
                            const n = filteredEnrichedRows.filter(r => r.cash_receipt_issued === true).length;
                            return n > 0 ? `${n}건` : '-';
                          })()}
                        </td>
                        {/* 결제수단 · 구분 · 환불 · CRM 환불 BETA · 결제정보 확인 5개 컬럼(T-20260813 컬럼 추가로 4→5). */}
                        <td colSpan={5}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 결제수단별 소계 (결제내역 탭 하단) */}
          {filteredEnrichedRows.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['card', 'cash', 'transfer', 'membership'] as const).map(method => {
                const subtotal = filteredEnrichedRows
                  .filter(r => r.method === method)
                  .reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
                if (subtotal === 0) return null;
                return (
                  <div key={method} className="rounded-lg border bg-card p-3 text-center">
                    <div className="text-xs text-muted-foreground mb-1">{METHOD_KO[method] ?? method}</div>
                    <div className="tabular-nums font-semibold text-sm">{formatAmount(subtotal)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* T-20260515-foot-RECEIPT-TAX-SPLIT AC-4: 과세/비과세/현금영수증 합계 */}
          {filteredEnrichedRows.some(r => r.taxable_amount != null || r.tax_exempt_amount != null || r.cash_receipt_issued != null) && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-card p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">과세 합계</div>
                <div className="tabular-nums font-semibold text-sm">
                  {formatAmount(filteredEnrichedRows.reduce((s, r) => s + (r.taxable_amount ?? 0), 0))}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">비과세 합계</div>
                <div className="tabular-nums font-semibold text-sm">
                  {formatAmount(filteredEnrichedRows.reduce((s, r) => s + (r.tax_exempt_amount ?? 0), 0))}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">현금영수증 발행</div>
                <div className="tabular-nums font-semibold text-sm">
                  {filteredEnrichedRows.filter(r => r.cash_receipt_issued === true).length}건
                </div>
              </div>
            </div>
          )}

          {/* T-20260522-foot-DAILY-SETTLE-STAFF AC-2: 담당자별 매출 집계 — 카드/현금/이체 소계 (전체 기준 — 필터 무관) */}
          {staffTotals.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">담당자별 매출</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-1.5 px-3 text-left font-medium">담당자</th>
                      <th className="py-1.5 px-2 text-right font-medium">카드</th>
                      <th className="py-1.5 px-2 text-right font-medium">현금</th>
                      <th className="py-1.5 px-2 text-right font-medium">이체</th>
                      <th className="py-1.5 px-3 text-right font-medium">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffTotals.map(({ name, total, card, cash, transfer }) => (
                      <tr
                        key={name}
                        className={cn(
                          'border-b cursor-pointer hover:bg-muted/40 transition-colors',
                          staffFilter === name && 'bg-teal-50',
                        )}
                        onClick={() => setStaffFilter(staffFilter === name ? '' : name)}
                        title={`클릭하면 ${name} 결제내역만 보기`}
                      >
                        <td className="py-1.5 px-3">
                          {name}
                          {staffFilter === name && (
                            <span className="ml-1.5 text-[10px] bg-teal-100 text-teal-700 rounded px-1">필터 중</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">{card !== 0 ? formatAmount(card) : '-'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">{cash !== 0 ? formatAmount(cash) : '-'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">{transfer !== 0 ? formatAmount(transfer) : '-'}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums font-medium text-emerald-700">{formatAmount(total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold bg-muted/50">
                      <td className="py-1.5 px-3 text-sm">합계</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">
                        {formatAmount(staffTotals.reduce((s, x) => s + x.card, 0))}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">
                        {formatAmount(staffTotals.reduce((s, x) => s + x.cash, 0))}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">
                        {formatAmount(staffTotals.reduce((s, x) => s + x.transfer, 0))}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-sm text-emerald-700">
                        {formatAmount(staffTotals.reduce((s, x) => s + x.total, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          )}
            </TabsContent>

            {/* T-20260708-foot-REDPAY-CLOSING-TAB: 레드페이 하위탭 (카드단말기 자동수집 + 대조) */}
            <TabsContent value="redpay" className="space-y-4">
              {clinic && <RedpayReconcileTab date={date} clinicId={clinic.id} />}
            </TabsContent>

            {/* T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD: 영수증 수납 하위탭 (OCR 영수증 첨부 수납 5컬럼 대조) */}
            <TabsContent value="receipt" className="space-y-4">
              {clinic && <ReceiptSettlementTab date={date} clinicId={clinic.id} />}
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ════════════════════════ 탭 3: 총 매출 ════════════════════════ */}
        {/* T-20260809-foot-DAYCLOSE-TOTALREVENUE-REDESIGN: '총 매출' 탭 = 통계>MTM매출 대시보드 뷰 3항목 재배치.
            신규 산식/쿼리 창작 0 — 3항목 모두 통계 대시보드 기존 컴포넌트/뷰를 그대로 소비(쌍방향 연동 정책).
            순서: 1)이번달 목표매출(read-only) 2)전월대비 매출추이(2단 15일) 3)실장별 일별매출.
            item5 접근권한: canViewTotalRevenue(has_ops_authority) 게이트 — 트리거 숨김 + NAV-BOUNCE(위 useEffect). */}
        <TabsContent value="compare" className="space-y-4">
          {/* T-20260819-foot-DAYCLOSE-TOTALREV-EXCEL-DOWNLOAD: 화면 표시 두 표(일자별비교·실장별일별)를
              그대로 .xlsx(한 파일 2시트)로. 로딩 중이거나 데이터 없으면 비활성. */}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="closing-totalrev-export-btn"
              disabled={compareLoading || staffDailyLoading || (!monthlyCompare?.points.length && !staffDaily?.staff.length)}
              onClick={exportTotalRevenue}
            >
              엑셀 다운로드
            </Button>
          </div>
          {/* 1. 이번달 목표 매출 — 통계 대시보드 [이번달 목표매출] 뷰 재사용, [수정] 버튼만 제거(read-only). */}
          <MonthlyTargetSection clinicId={clinic?.id} refISO={date} readOnly />
          {/* 2. 전월 대비 매출 추이(2단 15일) + 3. 실장별 일별 매출 — 통계 공유 렌더러(MonthlyComparisonSection).
              staffBreakdown 주입 + showStaffBreakdown=true → 통계 대시보드 [실장별 일별매출]과 동일 뷰를 3번 항목으로 노출.
              (item5로 매출 surface 열람권 게이트가 적용됐으므로 실장 개인성과 노출 경계 충족.) */}
          <MonthlyComparisonSection
            data={monthlyCompare}
            staffBreakdown={staffDaily}
            loading={compareLoading || staffDailyLoading}
            showStaffBreakdown={true}
            /* T-20260810-foot-DAYCLOSE-MOMTREND-TITLE-REMOVE: 마감일 '총 매출' 탭에서만 섹션 제목 라벨 숨김
               (통계 화면 Stats.tsx 는 prop 미전달 → 제목 유지, AC-3 회귀 가드). */
            hideTitle={true}
          />
        </TabsContent>

        {/* ════════════════════════ 탭 4: 총매출(치료) ════════════════════════ */}
        {/* T-20260811-foot-SALESAGG-THERAPIST-TAB (김주연 총괄 확정, reply ts=1786502240.795299):
            매출집계 > [담당치료사별](SalesStaffTab) '내용 그대로 연동/미러'. 기존 컴포넌트·산식·grain·drill-down
            재사용 — 신규 산식/쿼리 창작 0. 필터바(기간·검색)도 매출집계와 동일 UX 로 병기.
            권한: admin+therapist(canViewTherapistSales) 한정 — 트리거 숨김 + NAV-BOUNCE(위 useEffect). */}
        {canViewTherapistSales && (
          <TabsContent value="therapist_sales" className="space-y-4">
            <SalesFilterBar value={therapistSalesFilter} onChange={setTherapistSalesFilter} />
            {/* T-20260819-foot-DAYCLOSE-TOTALREV-EXCEL-DOWNLOAD: '총매출(치료)' 표 화면표시값 그대로 .xlsx (표 내부 버튼). */}
            <SalesStaffTab
              filter={therapistSalesFilter}
              enableExcelExport
              exportFilenameBase="일마감_총매출치료"
            />
          </TabsContent>
        )}
      </Tabs>

      {/* 수기 추가/수정 다이얼로그 */}
      {showManualDialog && clinic && (
        <ManualEntryDialog
          clinicId={clinic.id}
          closeDate={date}
          staffList={staffList}
          editTarget={manualEditTarget}
          /* T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 편집 모드면 저장을 원자 재확정 RPC로 라우팅 */
          confirmedEdit={isClosed && confirmedEditMode}
          onConfirmedSave={saveConfirmedEdit}
          onClose={() => { setShowManualDialog(false); setManualEditTarget(null); }}
          onSaved={() => {
            setShowManualDialog(false);
            setManualEditTarget(null);
            qc.invalidateQueries({ queryKey: ['closing-manual', clinic.id, date] });
          }}
        />
      )}

      {/* T-20260805-foot-DAYCLOSE-AC3-DXGUBUN-POPUP: [시술명] 셀 클릭 → 수납 상세 팝업(view-layer only, read-only) */}
      {susuDetailPaymentId && (
        <PaymentSusuDetailModal
          paymentId={susuDetailPaymentId}
          onClose={() => setSusuDetailPaymentId(null)}
        />
      )}

      {/* T-20260522-foot-CLOSING-REFUND: 환불 처리 다이얼로그 */}
      {refundTarget && clinic && (
        <ClosingRefundDialog
          open={!!refundTarget}
          rows={refundTarget}
          clinicId={clinic.id}
          onClose={() => setRefundTarget(null)}
          onSuccess={() => {
            setRefundTarget(null);
            refreshPayments();
            qc.invalidateQueries({ queryKey: ['closing-refund-alldates', clinic.id] });
          }}
        />
      )}

      {/* T-20260616-foot-CLOSING-PAYWAIT-PMW-SWAP: 미수 클릭 시 결제 미니창 (레거시 PaymentDialog → PaymentMiniWindow) */}
      <PaymentMiniWindow
        key={`closing-mini-${payTarget?.id ?? 'none'}-${payAttemptCounter}`}
        checkIn={payTarget}
        onClose={() => setPayTarget(null)}
        onComplete={() => {
          setPayTarget(null);
          setPayAttemptCounter((c) => c + 1);
          refreshPayments();
        }}
        onSettled={() => {
          // T-20260727-foot-PMW-SETTLE-KEEPMINIWINDOW-OPEN: [수납] 후 미니창 유지(같은 창에서 [출력] 이어감).
          //   미수 갱신만 수행 — setPayTarget(null)(닫기)·counter++(리마운트) 미수행 → 창/내부상태 보존.
          refreshPayments();
        }}
        onSaved={() => {
          // 시술 저장 후 미수금(결제대기) 즉시 갱신
          refreshPayments();
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 수기 추가 다이얼로그
// ──────────────────────────────────────────────────────────────

interface ManualEntryDialogProps {
  clinicId: string;
  closeDate: string;
  staffList: Staff[];
  /** 수정 모드용 — null이면 신규 추가 모드 */
  editTarget: ManualPaymentRow | null;
  /** T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정(closed) 편집 모드 — 저장을 원자 재확정 RPC로 라우팅 */
  confirmedEdit?: boolean;
  onConfirmedSave?: (
    manualOp: Record<string, unknown> | null,
    audit: { field: string; old_value: string | null; new_value: string | null }[],
  ) => Promise<boolean>;
  onClose: () => void;
  onSaved: () => void;
}

function ManualEntryDialog({ clinicId, closeDate, staffList, editTarget, confirmedEdit = false, onConfirmedSave, onClose, onSaved }: ManualEntryDialogProps) {
  const isEdit = editTarget !== null;
  const [payTime, setPayTime] = useState(editTarget?.pay_time ?? format(new Date(), 'HH:mm'));
  const [chartNumber, setChartNumber] = useState(editTarget?.chart_number ?? '');
  const [customerName, setCustomerName] = useState(editTarget?.customer_name ?? '');
  const [leadSource, setLeadSource] = useState(editTarget?.lead_source ?? '');
  const [visitType, setVisitType] = useState(editTarget?.visit_type ?? '');
  const [staffName, setStaffName] = useState(editTarget?.staff_name ?? '');
  const [amount, setAmount] = useState(editTarget ? String(editTarget.amount) : '');
  const [method, setMethod] = useState<'card' | 'cash' | 'transfer'>(
    (editTarget?.method as 'card' | 'cash' | 'transfer' | undefined) ?? 'card',
  );
  const [memo, setMemo] = useState(editTarget?.memo ?? '');
  const [saving, setSaving] = useState(false);
  const { profile } = useAuth();

  // ── T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC: 분할결제(카드+이체 등 다-결제수단) ──
  //   기본 결제금액/결제수단 = leg1. extraLegs = leg2+. 미지정(빈 배열) 시 기존 단일 leg 동선 무회귀.
  //   수정 모드는 단일 closing_manual_payments 행 편집이라 분할 비대상.
  const [extraLegs, setExtraLegs] = useState<{ method: 'card' | 'cash' | 'transfer'; amount: string }[]>([]);
  const isSplit = !isEdit && extraLegs.length > 0;
  const parseAmt = (s: string) => parseInt((s || '').replace(/[^\d]/g, ''), 10) || 0;
  const splitTotal = parseAmt(amount) + extraLegs.reduce((s, l) => s + parseAmt(l.amount), 0);

  // ── T-20260714-foot-DAYCLOSE-MANUAL-PAY (옵션A): 차트번호 → 고객 연동 정본 귀속 ──
  //   차트번호가 이 클리닉 내 고객 1인으로 유일 해소되면, 활성 패키지 잔금 / 수납대기 내원으로
  //   정본(package_payments/payments) 귀속 가능. 귀속 시 closing_manual_payments 는 만들지 않아
  //   매출 이중계상 없음(net-zero). 기본값 = '수기(rollup)' — 기존 동선 무회귀.
  const [resolvedCust, setResolvedCust] = useState<{ id: string; name: string } | null>(null);
  const [custPkgs, setCustPkgs] = useState<{ id: string; name: string; totalSessions: number }[]>([]);
  const [custWaitingCIs, setCustWaitingCIs] = useState<(ManualPayCheckIn & { label: string })[]>([]);
  const [attrSel, setAttrSel] = useState<string>('manual'); // 'manual' | 'pkg:<id>' | 'ci:<id>' | 'single'

  useEffect(() => {
    if (isEdit) return; // 수정 모드는 기존 rollup 행만 편집 (귀속 전환 비대상)
    const cn = chartNumber.trim();
    if (!cn) { setResolvedCust(null); setCustPkgs([]); setCustWaitingCIs([]); setAttrSel('manual'); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data: custs } = await supabase
        .from('customers')
        .select('id, name')
        .eq('clinic_id', clinicId)
        .eq('chart_number', cn)
        .limit(2);
      if (cancelled) return;
      if (!custs || custs.length !== 1) { setResolvedCust(null); setCustPkgs([]); setCustWaitingCIs([]); setAttrSel('manual'); return; }
      const cust = custs[0] as { id: string; name: string };
      setResolvedCust(cust);
      const { data: pkgs } = await supabase
        .from('packages')
        .select('id, package_name, total_sessions')
        .eq('customer_id', cust.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      const { data: cis } = await supabase
        .from('check_ins')
        .select('id, clinic_id, status, status_flag_history, customer_id, checked_in_at')
        .eq('customer_id', cust.id)
        .eq('status', 'payment_waiting')
        .order('checked_in_at', { ascending: false });
      if (cancelled) return;
      setCustPkgs((pkgs ?? []).map((p: { id: string; package_name: string; total_sessions: number }) =>
        ({ id: p.id, name: p.package_name, totalSessions: p.total_sessions ?? 0 })));
      setCustWaitingCIs((cis ?? []).map((c: {
        id: string; clinic_id: string; status: string; status_flag_history: unknown[];
        customer_id: string | null; checked_in_at: string | null;
      }) => ({
        id: c.id, clinic_id: c.clinic_id, status: c.status,
        status_flag_history: c.status_flag_history ?? [], customer_id: c.customer_id,
        label: `수납대기 내원${c.checked_in_at ? ` · ${format(new Date(c.checked_in_at), 'MM/dd HH:mm')}` : ''}`,
      })));
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [chartNumber, clinicId, isEdit]);

  /** T-20260512-foot-OCR-RECEIPT: OCR 추출 결과 자동기입 콜백 */
  const handleReceiptExtracted = (data: { amount?: number; method?: 'card' | 'cash' | 'transfer'; storagePath?: string }) => {
    if (data.amount) setAmount(String(data.amount));
    if (data.method) setMethod(data.method);
    if (data.storagePath && !memo) setMemo(`영수증: ${data.storagePath}`);
  };

  const save = async () => {
    if (!customerName.trim()) { toast.error('성함을 입력하세요'); return; }
    const amt = parseAmt(amount);
    if (!amt || amt <= 0) { toast.error('결제금액을 입력하세요'); return; }

    // ── T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK: 확정 편집 모드 = 단일행 원자 재확정 RPC 라우팅 ──
    //   확정(closed) 후 수기수납 편집/추가는 unlock→edit→re-confirm(revision+1)+감사를 한 트랜잭션으로.
    //   분할/정본귀속은 확정편집에서 비대상(단일 closing_manual_payments 행 leg1만).
    if (confirmedEdit && onConfirmedSave) {
      const methodKo = (m: string) =>
        (({ card: '카드', cash: '현금', transfer: '이체' }) as Record<string, string>)[m] ?? m;
      const fields = {
        pay_time: payTime || null,
        chart_number: chartNumber || null,
        customer_name: customerName.trim(),
        lead_source: leadSource || null,
        visit_type: visitType || null,
        staff_name: staffName || null,
        amount: amt,
        method,
        memo: memo || null,
      };
      setSaving(true);
      let ok = false;
      if (isEdit && editTarget) {
        ok = await onConfirmedSave(
          { kind: 'update', id: editTarget.id, fields },
          [{
            field: '수기수납 수정',
            old_value: `${editTarget.customer_name} ${editTarget.amount.toLocaleString('ko-KR')} ${methodKo(editTarget.method)}`,
            new_value: `${customerName.trim()} ${amt.toLocaleString('ko-KR')} ${methodKo(method)}`,
          }],
        );
      } else {
        ok = await onConfirmedSave(
          { kind: 'insert', fields },
          [{
            field: '수기수납 추가',
            old_value: null,
            new_value: `${customerName.trim()} ${amt.toLocaleString('ko-KR')} ${methodKo(method)}`,
          }],
        );
      }
      setSaving(false);
      if (ok) onSaved();
      return;
    }

    // ── T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC: 분할결제 splits 구성 ──
    //   행1 = 기본 금액/수단, 행2+ = extraLegs(금액>0만). 단일 행 시 [행1] → 기존 동선 동치.
    //   (영수증 팝업과 동일한 splits 규약으로 단일 write-path recordManualPayment 에 수렴)
    const splits: PaymentSplit[] = [
      { method, amount: amt },
      ...extraLegs.map((l) => ({ method: l.method, amount: parseAmt(l.amount) })).filter((l) => l.amount > 0),
    ];
    if (isSplit && splits.length < 2) { toast.error('분할결제 금액을 입력하세요'); return; }

    // ── T-20260714 옵션A: 정본 귀속 선택 시 canonical write-path 경유(closing_manual_payments 미생성) ──
    if (!isEdit && resolvedCust && attrSel !== 'manual') {
      setSaving(true);
      // 매출은 마감일(closeDate) 기준 반영 — created_at 을 마감일+시간(KST)로 세팅.
      const createdAtOverride = `${closeDate}T${(payTime && payTime.length === 5) ? payTime : '12:00'}:00+09:00`;
      let attribution: ManualPayAttribution | null = null;
      if (attrSel.startsWith('pkg:')) attribution = { kind: 'package', packageId: attrSel.slice(4) };
      else if (attrSel.startsWith('ci:')) {
        const ci = custWaitingCIs.find((c) => c.id === attrSel.slice(3));
        if (ci) attribution = { kind: 'checkin', checkIn: ci };
      } else if (attrSel === 'single') attribution = { kind: 'single' };
      if (!attribution) { setSaving(false); toast.error('귀속 대상을 확인하세요'); return; }
      try {
        // 분할결제면 splits 전달(각 행 canonical 1행), 단건이면 기존 시그니처 유지(무회귀).
        const res = await recordManualPayment({
          clinicId, customerId: resolvedCust.id,
          ...(isSplit ? { splits } : { amount: amt, method }),
          attribution, memo: memo || undefined, createdAtOverride,
          actor: { id: profile?.id ?? null, name: profile?.name ?? null, role: profile?.role ?? null },
        });
        setSaving(false);
        const splitTag = res.splitCount > 1 ? ` (분할 ${res.splitCount}건)` : '';
        toast.success(
          (res.route === 'package' ? '패키지 잔금 결제로 기록 (미수 반영)'
          : res.route === 'checkin' ? (res.kanbanResolved ? '수납 완료 — 대기목록 해소' : '수납 기록됨')
          : '단건 결제로 기록') + splitTag,
        );
        onSaved();
      } catch (e) {
        setSaving(false);
        toast.error(e instanceof Error ? e.message : '정본 결제 기록 실패');
      }
      return;
    }

    setSaving(true);
    const basePayload = {
      clinic_id: clinicId,
      close_date: closeDate,
      pay_time: payTime || null,
      chart_number: chartNumber || null,
      customer_name: customerName.trim(),
      lead_source: leadSource || null,
      visit_type: visitType || null,
      staff_name: staffName || null,
      memo: memo || null,
    };

    let error;
    if (isEdit && editTarget) {
      ({ error } = await supabase
        .from('closing_manual_payments')
        .update({ ...basePayload, amount: amt, method, updated_at: new Date().toISOString() })
        .eq('id', editTarget.id));
    } else {
      // 분할결제: 행 별 closing_manual_payments 1행씩(카드/이체 subtotal 정합). 단건이면 1행(무회귀).
      const rows = splits.map((s) => ({ ...basePayload, amount: s.amount, method: s.method }));
      ({ error } = await supabase.from('closing_manual_payments').insert(rows));
    }
    setSaving(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success(isEdit ? '수기 결제내역 수정됨' : (isSplit ? `수기 결제내역 추가됨 (분할 ${splits.length}건)` : '수기 결제내역 추가됨'));
    onSaved();
  };

  return (
    <Dialog open onOpenChange={o => !o && !saving && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '수기 결제내역 수정' : '수기 결제내역 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* T-20260512-foot-OCR-RECEIPT / T-20260522-foot-RECEIPT-OCR-AUTO: 영수증 업로드 + OCR 자동기입 */}
          {!isEdit && (
            <ReceiptUpload onExtracted={handleReceiptExtracted} clinicId={clinicId} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>시간</Label>
              <Input type="time" value={payTime} onChange={e => setPayTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>차트번호</Label>
              <Input placeholder="F-2026-001" value={chartNumber} onChange={e => setChartNumber(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>성함 <span className="text-destructive">*</span></Label>
            <Input placeholder="홍길동" value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </div>
          {/* T-20260714-foot-DAYCLOSE-MANUAL-PAY (옵션A): 차트번호 해소 시 고객 정본 귀속 선택 */}
          {!isEdit && resolvedCust && (
            <div className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50/60 p-2">
              <Label className="text-emerald-800">
                고객 연동 <span className="font-normal text-emerald-700">— {resolvedCust.name} 확인됨</span>
              </Label>
              <select
                data-testid="manual-attribution-select"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={attrSel}
                onChange={e => setAttrSel(e.target.value)}
              >
                <option value="manual">수기 내역만 기록 (고객 미연동)</option>
                {custPkgs.map(p => (
                  <option key={p.id} value={`pkg:${p.id}`}>패키지 잔금 · {p.name} (미수 해소)</option>
                ))}
                {custWaitingCIs.map(c => (
                  <option key={c.id} value={`ci:${c.id}`}>{c.label} (수납·대기해소)</option>
                ))}
                <option value="single">단건 결제 (고객 귀속)</option>
              </select>
              {attrSel !== 'manual' && (
                <p className="text-[11px] leading-relaxed text-emerald-700">
                  고객 수납내역·미수에 반영됩니다. (수기 결제내역에는 중복 기록되지 않음)
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>내원경로</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={leadSource}
                onChange={e => setLeadSource(e.target.value)}
              >
                <option value="">— 선택 —</option>
                {LEAD_SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>초진/재진</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={visitType}
                onChange={e => setVisitType(e.target.value)}
              >
                <option value="">— 선택 —</option>
                {VISIT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>결제담당</Label>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={staffName}
              onChange={e => setStaffName(e.target.value)}
            >
              <option value="">— 선택 —</option>
              {/* T-20260522-foot-STAFF-NAME-UNIFY: 수기결제 담당자도 display_name fallback */}
              {staffList.map(s => <option key={s.id} value={s.display_name || s.name}>{s.display_name || s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>결제금액 <span className="text-destructive">*</span></Label>
              <AmountInput
                placeholder="0"
                value={amount}
                onChange={(raw) => setAmount(raw)}
              />
            </div>
            <div className="space-y-1">
              <Label>결제수단</Label>
              <select
                data-testid="manual-method-select"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={method}
                onChange={e => setMethod(e.target.value as 'card' | 'cash' | 'transfer')}
              >
                <option value="card">카드</option>
                <option value="cash">현금</option>
                <option value="transfer">이체</option>
              </select>
            </div>
          </div>
          {/* T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC: 분할결제(카드+이체 등) leg 추가 */}
          {!isEdit && (
            <div className="space-y-2">
              {extraLegs.map((leg, i) => (
                <div key={i} className="grid grid-cols-2 gap-3" data-testid={`manual-split-leg-${i}`}>
                  <div className="space-y-1">
                    <Label>분할 금액 {i + 2}</Label>
                    <AmountInput
                      placeholder="0"
                      value={leg.amount}
                      onChange={(raw) => setExtraLegs(prev => prev.map((l, j) => j === i ? { ...l, amount: raw } : l))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>결제수단 {i + 2}</Label>
                    <div className="flex gap-1">
                      <select
                        data-testid={`manual-split-method-${i}`}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={leg.method}
                        onChange={e => setExtraLegs(prev => prev.map((l, j) => j === i ? { ...l, method: e.target.value as 'card' | 'cash' | 'transfer' } : l))}
                      >
                        <option value="card">카드</option>
                        <option value="cash">현금</option>
                        <option value="transfer">이체</option>
                      </select>
                      <Button
                        type="button" variant="outline" size="icon" className="shrink-0"
                        data-testid={`manual-split-remove-${i}`}
                        onClick={() => setExtraLegs(prev => prev.filter((_, j) => j !== i))}
                      >✕</Button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button
                  type="button" variant="outline" size="sm"
                  data-testid="manual-split-add"
                  onClick={() => setExtraLegs(prev => [...prev, { method: 'transfer', amount: '' }])}
                >+ 분할결제 추가 (다른 결제수단)</Button>
                {isSplit && (
                  <span className="text-sm font-medium text-emerald-700" data-testid="manual-split-total">
                    합계 {splitTotal.toLocaleString()}원
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label>메모</Label>
            <Input placeholder="특이사항" value={memo} onChange={e => setMemo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>취소</Button>
          <Button disabled={saving} onClick={save}>
            {saving ? '저장 중…' : isEdit ? '수정' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// 요약 카드 (총 합계 탭)
// ──────────────────────────────────────────────────────────────

// T-20260526-foot-CLOSING-PAYCOUNT: rows 3번째 요소(선택)에 건 수, totalCount 합계 행 건 수
function SummaryCard({
  title,
  rows,
  total,
  totalCount,
  highlight,
}: {
  title: string;
  /** [label, amount, count?] — count 전달 시 "N건" 표시 (0건도 표기) */
  rows: [string, number, number?][];
  total: number;
  /** 합계 행 건 수 (선택) */
  totalCount?: number;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-primary/40 bg-primary/5' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className={cn('text-sm', highlight && 'text-primary')}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 text-sm">
          {rows.map(([label, val, count]) => (
            <div key={label} className="flex justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className="flex items-center gap-1.5 tabular-nums">
                {count !== undefined && (
                  <span className="text-xs text-muted-foreground">{count}건</span>
                )}
                {formatAmount(val)}
              </span>
            </div>
          ))}
        </div>
        <div className={cn(
          'mt-3 flex justify-between border-t pt-2 font-semibold',
          highlight ? 'text-base text-primary' : 'text-sm',
        )}>
          <span>합계</span>
          <span className="flex items-center gap-1.5 tabular-nums">
            {totalCount !== undefined && (
              <span className={cn('font-normal text-muted-foreground', highlight ? 'text-sm' : 'text-xs')}>
                {totalCount}건
              </span>
            )}
            {formatAmount(total)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL — 일일 미수금 박스.
 * 합계(결제수단별) 박스 옆에 동일한 Card 박스 형태로 병치(reporter 스크린샷 핀, F0BB8UA0RDH).
 * §4-A 준수: 패키지 미수 / 진료비 미수를 **별도 줄**로 표기하고, 둘을 합산한 단일 '총 미수금'은
 * 표기하지 않는다(매출 합계와도 묶지 않음). 금액 소스 = footBilling loadCustomerOutstanding(SSOT) 재사용.
 * 미수 없으면 '미수 없음 ₩0' 1줄(공간 낭비/스크롤 없음).
 */
function DailyOutstandingCard({
  packageDue,
  consultationDue,
  dueCustomerCount,
}: {
  packageDue: number;
  consultationDue: number;
  dueCustomerCount: number;
}) {
  const hasDue = packageDue > 0 || consultationDue > 0;
  return (
    <Card data-testid="closing-daily-outstanding" className="border-rose-300/60 bg-rose-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm text-rose-700">
          일일 미수금
          {hasDue && (
            <span className="text-xs font-normal text-rose-500">{dueCustomerCount}명</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasDue ? (
          <div className="space-y-1.5 text-sm">
            {packageDue > 0 && (
              <div data-testid="closing-outstanding-package" className="flex justify-between">
                <span className="text-muted-foreground">패키지 미수</span>
                <span className="tabular-nums font-semibold text-rose-700">{formatAmount(packageDue)}</span>
              </div>
            )}
            {consultationDue > 0 && (
              <div data-testid="closing-outstanding-consultation" className="flex justify-between">
                <span className="text-muted-foreground">진료비 미수</span>
                <span className="tabular-nums font-semibold text-rose-700">{formatAmount(consultationDue)}</span>
              </div>
            )}
          </div>
        ) : (
          <div data-testid="closing-outstanding-none" className="flex justify-between text-sm">
            <span className="text-muted-foreground">미수 없음</span>
            <span className="tabular-nums text-muted-foreground">{formatAmount(0)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────
// T-20260522-foot-CLOSING-REFUND: 환불 처리 다이얼로그
// T-20260713-foot-CLOSING-REFUND-PAYTYPE-GROUPING-ITEMSELECT:
//   단일행 → 고객의 환불 가능 결제행 묶음(rows[])을 유형별(패키지/진료비/단건)로 구분 표기 +
//   항목 선택(체크박스) + 선택 합산 표시 후 일괄 환불. money-path 는 기존 RPC 재사용:
//     단건(source='payment'): 금액(잔여 이내 편집 가능)+수단+사유 → refund_single_payment RPC
//     패키지(source='package'): 선택 결제행 amount 바인딩 → refund_package_payment RPC
//   (T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH: 견적 refund_package_atomic 폐용)
//   [FOLD] AC-B1: 완전환불(잔여 0) 행은 체크박스 비활성(재환불 차단).
// ──────────────────────────────────────────────────────────────

interface ClosingRefundDialogProps {
  open: boolean;
  /** 같은 고객의 환불 가능 결제행 묶음(payment/package, 환불행 제외). */
  rows: EnrichedRow[];
  clinicId: string;
  onClose: () => void;
  onSuccess: () => void;
}

// 유형별 그룹 정의 — AC-1(패키지/진료비/단건 3종 시각 구분).
//   ⚠ 진료비 vs 단건: 확정 카테고리 필드가 스키마에 없어 pay_check_in_id(내원 종속) 유무로 heuristic 분류.
//     label 전용이며 환불 금액 산출(money-path)에는 영향 없음. planner FOLLOWUP(scenario_missing)로 구분키 확인.
const REFUND_GROUP_DEFS: { key: string; label: string; sub: string; match: (r: EnrichedRow) => boolean }[] = [
  { key: 'package', label: '패키지(회차권) 결제', sub: '남은 결제 금액 기준', match: r => r.source === 'package' },
  { key: 'consult', label: '진료비', sub: '수납 금액 기준', match: r => r.source === 'payment' && !!r.pay_check_in_id },
  { key: 'single', label: '단건 결제', sub: '수납 금액 기준', match: r => r.source === 'payment' && !r.pay_check_in_id },
];

function refundRowKey(r: EnrichedRow): string {
  return r.source === 'package' ? `pkg:${r.pkg_payment_id}` : `pay:${r.payment_id}`;
}

// ──────────────────────────────────────────────────────────────
// T-20260715-foot-REFUND-BACKDATE-NAV-ERROR-HOTFIX (AC-4): 환불 RPC 오류 → 현장 친화 메시지.
//   RC = 배포 직후 PostgREST 스키마 캐시가 아직 신규 환불 RPC(refund_package_payment)를
//   인지하지 못한 순간(PGRST202 "Could not find the function … in the schema cache")에
//   환불을 시도하면 raw 영문 스택이 토스트로 노출됐다(현장 스샷 F0BH8BP2VH9).
//   화면 갇힘/크래시는 아니었으나(toast) 문구가 비친화적 → 명확한 안내로 치환.
//   ★ 환불 경로/RPC 신설 없음(REDEFINITION_RISK 회피). 기존 배치 핸들러 error 분기(failMsgs)만 보강.
//   prefix = 배치 요약(failMsgs[0]) 표기 구분용(단건 '환불 실패' / 패키지 '패키지 환불 실패').
//   단, 스키마 캐시 미스는 prefix 무관하게 동일한 한국어 안내로 매핑.
function refundErrorMessage(
  error: { code?: string; message?: string } | null | undefined,
  prefix = '환불 실패',
): string {
  const msg = error?.message ?? '';
  const isSchemaCacheMiss =
    error?.code === 'PGRST202' || /schema cache|Could not find the function/i.test(msg);
  if (isSchemaCacheMiss) {
    return '환불 기능이 아직 서버에 반영되지 않았습니다. 잠시 후 다시 시도하시고, 계속되면 관리자에게 문의해 주세요.';
  }
  return `${prefix}: ${msg || '알 수 없는 오류'}`;
}

function ClosingRefundDialog({ open, rows, clinicId, onClose, onSuccess }: ClosingRefundDialogProps) {
  const customerName = rows[0]?.customer_name ?? '-';

  const [method, setMethod] = useState<'card' | 'cash' | 'transfer'>(
    (['card', 'cash', 'transfer'].includes(rows[0]?.method ?? '') ? rows[0]!.method : 'card') as 'card' | 'cash' | 'transfer',
  );
  const [refundMemo, setRefundMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 행별 잔여 환불가능액(원결제 − 기존 환불). null = 로딩 전.
  const [remainingMap, setRemainingMap] = useState<Record<string, number> | null>(null);
  // 선택된 행 키.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 단건(payment) 행별 환불 입력 금액(문자열). 기본값 = 잔여. 패키지는 잔여 고정(편집 불가).
  const [amountMap, setAmountMap] = useState<Record<string, string>>({});

  // 오픈 시 rows 전체의 기존 환불액 조회 → 잔여 산출 + 입력 기본값 세팅.
  //   (T-20260713-SINGLE-PAY-MISSING AC-3 / T-20260714 잔여 산출 로직을 행 묶음으로 확장 — money-path 동일.)
  useEffect(() => {
    if (!open) return;
    (async () => {
      const payIds = rows.filter(r => r.source === 'payment' && r.payment_id).map(r => r.payment_id!) as string[];
      const pkgIds = rows.filter(r => r.source === 'package' && r.pkg_payment_id).map(r => r.pkg_payment_id!) as string[];
      const priorPay: Record<string, number> = {};
      const priorPkg: Record<string, number> = {};
      if (payIds.length > 0) {
        const { data } = await supabase
          .from('payments')
          .select('linked_payment_id, amount')
          .eq('payment_type', 'refund')
          .neq('status', 'deleted')
          .in('linked_payment_id', payIds);
        for (const r of (data ?? []) as { linked_payment_id: string | null; amount: number | null }[]) {
          if (r.linked_payment_id) priorPay[r.linked_payment_id] = (priorPay[r.linked_payment_id] ?? 0) + (r.amount ?? 0);
        }
      }
      if (pkgIds.length > 0) {
        const { data } = await supabase
          .from('package_payments')
          .select('parent_payment_id, amount')
          .eq('payment_type', 'refund')
          .in('parent_payment_id', pkgIds);
        for (const r of (data ?? []) as { parent_payment_id: string | null; amount: number | null }[]) {
          if (r.parent_payment_id) priorPkg[r.parent_payment_id] = (priorPkg[r.parent_payment_id] ?? 0) + (r.amount ?? 0);
        }
      }
      const remMap: Record<string, number> = {};
      const amtMap: Record<string, string> = {};
      for (const r of rows) {
        const key = refundRowKey(r);
        let prior = 0;
        if (r.source === 'payment' && r.payment_id) prior = priorPay[r.payment_id] ?? 0;
        if (r.source === 'package' && r.pkg_payment_id) prior = priorPkg[r.pkg_payment_id] ?? 0;
        const rem = Math.max(0, r.amount - prior);
        remMap[key] = rem;
        amtMap[key] = String(rem);
      }
      setRemainingMap(remMap);
      setAmountMap(amtMap);
    })();
  }, [open, rows]);

  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 단건 행 선택 시 금액 검증(1원 ≤ 입력 ≤ 잔여).
  const paymentItemError = (r: EnrichedRow): string | null => {
    const key = refundRowKey(r);
    const rem = remainingMap?.[key];
    if (rem == null) return null;
    if (rem <= 0) return '이미 전액 환불됨';
    const a = parseInt((amountMap[key] ?? '').replace(/[^\d]/g, ''), 10);
    if (!a || a <= 0) return '금액 입력 필요';
    if (a > rem) return `잔여 ${formatAmount(rem)} 초과`;
    return null;
  };

  // 선택 항목 환불 금액 합산(AC-3): 단건=입력액, 패키지=잔여.
  //   money-path 가드: 단건 입력이 잔여 초과/0/NaN이면 합산에서 무효(0 처리)
  //   → 선택 합계가 환불 가능 금액을 초과 표기하지 않음(E2E selectedSum helper와 동기화).
  const selectedSum = rows.reduce((s, r) => {
    const key = refundRowKey(r);
    if (!selected.has(key)) return s;
    if (r.source === 'package') return s + (remainingMap?.[key] ?? 0);
    const rem = remainingMap?.[key] ?? 0;
    const a = parseInt((amountMap[key] ?? '').replace(/[^\d]/g, ''), 10);
    return s + (!isNaN(a) && a > 0 && a <= rem ? a : 0);
  }, 0);

  // 선택된 단건 중 금액 오류가 하나라도 있으면 확정 불가(money-path 가드).
  const hasSelectedError = rows.some(
    r => selected.has(refundRowKey(r)) && r.source === 'payment' && paymentItemError(r) != null,
  );

  // AC-5: 선택 0건 / 사유 미입력 / 금액 오류 → 확정 비활성.
  const confirmDisabled = submitting || selected.size === 0 || !refundMemo.trim() || hasSelectedError;

  const handleSubmit = async () => {
    if (selected.size === 0) { toast.error('환불할 항목을 선택해 주세요.'); return; }
    if (!refundMemo.trim()) { toast.error('환불 사유를 입력해 주세요.'); return; }
    if (hasSelectedError) { toast.error('선택한 항목의 환불 금액을 확인해 주세요.'); return; }

    const targets = rows.filter(r => selected.has(refundRowKey(r)));
    if (!window.confirm(`선택한 ${targets.length}개 항목 · 합계 ${formatAmount(selectedSum)}을 환불하시겠습니까?`)) return;

    setSubmitting(true);
    let okCount = 0;
    const failMsgs: string[] = [];

    // 선택 항목을 순차 처리(각 건은 기존 단건/패키지 RPC 재사용 — 신규 파라미터/스키마 무접점).
    for (const r of targets) {
      const key = refundRowKey(r);
      const rem = remainingMap?.[key] ?? 0;
      if (rem <= 0) { failMsgs.push(`${r.customer_name}: 이미 전액 환불됨`); continue; }

      if (r.source === 'package') {
        if (!r.pkg_payment_id) { failMsgs.push('패키지 결제행 없음'); continue; }
        const { data, error } = await supabase.rpc('refund_package_payment', {
          p_payment_id: r.pkg_payment_id,
          p_method: method,
        });
        if (error) { failMsgs.push(refundErrorMessage(error, '패키지 환불 실패')); continue; }
        const result = data as { ok?: boolean; error?: string };
        if (result?.error) { failMsgs.push(result.error); continue; }
        okCount += 1;
      } else {
        if (!r.payment_id) { failMsgs.push('결제행 없음'); continue; }
        const amt = parseInt((amountMap[key] ?? '').replace(/[^\d]/g, ''), 10);
        if (!amt || amt <= 0 || amt > rem) { failMsgs.push(`${r.customer_name}: 환불 금액 오류`); continue; }
        const { data, error } = await supabase.rpc('refund_single_payment', {
          p_payment_id: r.payment_id,
          p_clinic_id: clinicId,
          p_amount: amt,
          p_method: method,
          p_memo: refundMemo.trim(),
        });
        if (error) { failMsgs.push(refundErrorMessage(error, '환불 실패')); continue; }
        const result = data as { ok?: boolean; error?: string };
        if (result?.error) { failMsgs.push(result.error); continue; }
        okCount += 1;
      }
    }

    setSubmitting(false);

    if (okCount > 0 && failMsgs.length === 0) {
      toast.success(`환불 처리 완료 (${okCount}건)`);
    } else if (okCount > 0) {
      toast.error(`일부만 처리됨 (성공 ${okCount}건 / 실패 ${failMsgs.length}건): ${failMsgs[0]}`);
    } else {
      toast.error(failMsgs[0] ?? '환불 처리 실패');
    }
    if (okCount > 0) onSuccess();
  };

  const loading = remainingMap == null;
  // 표기 그룹 구성(빈 그룹은 렌더 스킵).
  const groups = REFUND_GROUP_DEFS
    .map(def => ({ ...def, items: rows.filter(def.match) }))
    .filter(g => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !submitting) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="closing-refund-dialog">
        <DialogHeader>
          <DialogTitle>환불 처리 — {customerName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">환불할 항목을 선택하세요. 유형별로 구분되어 표시됩니다.</p>

          {loading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">불러오는 중…</div>
          ) : (
            <div className="space-y-3" data-testid="refund-item-list">
              {/* AC-1/AC-2: 유형별(패키지/진료비/단건) 섹션 구분 + 각 항목 환불 가능 금액 표기 */}
              {groups.map(g => (
                <div key={g.key} className="space-y-1.5" data-testid={`refund-group-${g.key}`}>
                  <div className="flex items-baseline justify-between border-b border-teal-100 pb-0.5">
                    <span className="text-xs font-semibold text-teal-700">{g.label}</span>
                    <span className="text-[10px] text-muted-foreground">{g.sub}</span>
                  </div>
                  {g.items.map(r => {
                    const key = refundRowKey(r);
                    const rem = remainingMap?.[key] ?? 0;
                    const fully = rem <= 0;
                    const checked = selected.has(key);
                    const itemErr = r.source === 'payment' && checked ? paymentItemError(r) : null;
                    return (
                      <div
                        key={key}
                        data-testid="refund-item"
                        className={cn(
                          'rounded-lg border p-2.5 space-y-1.5 transition-colors',
                          checked ? 'border-teal-500 bg-teal-50/60' : 'border-input',
                          fully && 'opacity-60',
                        )}
                      >
                        <label className={cn('flex items-center gap-2.5', fully ? 'cursor-not-allowed' : 'cursor-pointer')}>
                          <input
                            type="checkbox"
                            data-testid="refund-item-checkbox"
                            className="h-5 w-5 accent-teal-600"
                            checked={checked}
                            disabled={fully}
                            onChange={() => toggleSelect(key)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground">
                                {r.pay_time} · {METHOD_KO[r.method as keyof typeof METHOD_KO] ?? r.method}
                              </span>
                              <span className="tabular-nums text-sm font-medium">{formatAmount(r.amount)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">
                                {fully ? '환불 가능 잔여 없음' : '환불 가능'}
                              </span>
                              <span className={cn('tabular-nums text-[11px]', fully ? 'text-destructive' : 'text-teal-700 font-medium')} data-testid="refund-item-remaining">
                                {formatAmount(rem)}
                              </span>
                            </div>
                          </div>
                        </label>

                        {/* [FOLD] AC-B1: 완전환불행 → 재환불 불가 표시 */}
                        {fully && (
                          <div className="text-[10px] text-destructive" data-testid="refund-item-fully">이미 전액 환불된 결제입니다 (재환불 불가)</div>
                        )}

                        {/* 단건(진료비/단건) 선택 시 부분 환불 금액 편집 유지(무회귀) — 패키지는 잔여 고정 */}
                        {checked && !fully && r.source === 'payment' && (
                          <div className="pl-7 space-y-1" data-testid="refund-item-amount-field">
                            <AmountInput
                              data-testid="refund-item-amount-input"
                              value={amountMap[key] ?? ''}
                              onChange={raw => setAmountMap(prev => ({ ...prev, [key]: raw }))}
                              placeholder={String(rem)}
                              className={cn('h-9', itemErr && 'border-destructive')}
                            />
                            {itemErr ? (
                              <p className="text-[11px] text-destructive" data-testid="refund-item-amount-error">{itemErr}</p>
                            ) : (
                              <p className="text-[10px] text-muted-foreground">최대 {formatAmount(rem)} · 일부 금액만도 환불 가능</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* AC-3: 선택 항목 환불 금액 합산 */}
              <div className="rounded-lg bg-muted/60 px-3 py-2 flex items-center justify-between" data-testid="refund-selected-sum">
                <span className="text-xs text-muted-foreground">선택 {selected.size}건 환불 합계</span>
                <span className="tabular-nums text-lg font-bold text-teal-700">{formatAmount(selectedSum)}</span>
              </div>
            </div>
          )}

          {/* 환불수단 선택 */}
          <div className="space-y-1">
            <Label>환불수단 <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-3 gap-2">
              {(['card', 'cash', 'transfer'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    'min-h-[40px] rounded-md border text-sm transition-colors',
                    method === m
                      ? 'border-teal-600 bg-teal-50 text-teal-700 font-medium'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {METHOD_KO[m]}
                </button>
              ))}
            </div>
          </div>

          {/* 사유 (필수) */}
          <div className="space-y-1">
            <Label>환불 사유 <span className="text-destructive">*</span></Label>
            <Textarea
              rows={2}
              value={refundMemo}
              onChange={e => setRefundMemo(e.target.value)}
              placeholder="예: 고객 요청, 시술 불만족 등"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={onClose}>취소</Button>
          <Button
            data-testid="refund-submit"
            variant="destructive"
            disabled={confirmDisabled}
            onClick={handleSubmit}
          >
            {submitting ? '처리 중…' : `환불 확정${selected.size > 0 ? ` (${selected.size}건)` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// 정산 행 (총 합계 탭)
// ──────────────────────────────────────────────────────────────

function ReconRow({
  label,
  system,
  actual,
  diff,
  onChange,
  disabled,
}: {
  label: string;
  system: number;
  actual: number;
  diff: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          시스템: <span className="tabular-nums">{formatAmount(system)}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <AmountInput
          value={actual}
          onChange={(raw) => onChange(Number(raw) || 0)}
          disabled={disabled}
        />
        <div className={
          'w-28 shrink-0 text-right text-sm tabular-nums ' +
          (diff === 0 ? 'text-muted-foreground' : diff > 0 ? 'text-emerald-700' : 'text-destructive')
        }>
          차이 {diff > 0 ? '+' : ''}{formatAmount(diff)}
        </div>
      </div>
    </div>
  );
}
