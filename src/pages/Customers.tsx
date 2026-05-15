/**
 * 고객관리 페이지
 *
 * T-20260506-foot-CHART-CONSOLIDATE:
 *   고객관리 메뉴의 차트(CustomerDetailSheet)를 폐지하고
 *   행 클릭 → 2번차트(미니홈피, /chart/:id) 새 창으로 통합.
 *   CRM 차트는 1번(간편차트=대시보드 우측 패널) / 2번(미니홈피) 두 가지만 존재.
 *   수정 기능은 EditCustomerDialog(수정 전용 다이얼로그)로 분리.
 *
 * T-20260510-foot-CUSTMGMT-CHART-PATTERN:
 *   대시보드와 접근 패턴 통일.
 *   클릭 → 1번차트(간편요약, 우측 패널), 우클릭 → 2번차트(미니홈피) 새 창
 *
 * T-20260514-foot-CHART2-OPEN-BUG (3차 재오픈):
 *   openChart() window.open() → CustomerChartSheet DrawerSheet로 전환.
 *   window.open() 팝업 차단 시 2번차트 안열리는 버그 해소.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { BookOpen, ExternalLink, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
import { CheckInDetailSheet } from '@/components/CheckInDetailSheet';
import { CustomerChartSheet } from '@/components/CustomerChartSheet';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount, formatPhone } from '@/lib/format';
import type { Customer, LeadSource } from '@/lib/types';

interface CustomerStats {
  visit_count: number;
  last_visit: string | null;
  total_revenue: number;
  has_package: boolean;
}

const LEAD_SOURCE_OPTIONS: LeadSource[] = ['TM', '인바운드', '워크인', '지인소개', '온라인', '기타'];

const PAGE_SIZE = 30;

/** 페이지네이션 버튼 번호 목록 생성 (숫자 | '…') */
function getPageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}


export default function Customers() {
  const location = useLocation();
  const clinic = useClinic();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  // T-20260506-foot-CHART-CONSOLIDATE: selected → editingCustomer (수정 전용)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  // T-20260510-foot-CUSTMGMT-CHART-PATTERN: 1번차트 우측 패널
  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET: CheckInDetailSheet customerMode로 교체
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  // T-20260514-foot-CHART2-OPEN-BUG: 2번차트 팝업 차단 해소 → CustomerChartSheet 슬라이드 패널
  const [chart2Id, setChart2Id] = useState<string | null>(null);
  const openChart = (customerId: string) => setChart2Id(customerId);
  // 우클릭 컨텍스트 메뉴
  const [ctxMenu, setCtxMenu] = useState<{ customer: Customer; x: number; y: number } | null>(null);
  const [statsMap, setStatsMap] = useState<Map<string, CustomerStats>>(new Map());
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navStateConsumed = useRef(false);

  const runSearch = useCallback(
    async (q: string, pageNum = 1) => {
      if (!clinic) return;
      const trimmed = q.trim();
      setLoading(true);
      const from = (pageNum - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let req = supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .eq('clinic_id', clinic.id)
        .order('updated_at', { ascending: false })
        .range(from, to);
      if (trimmed) {
        const safe = trimmed.replace(/[%_(),.]/g, '');
        if (safe) req = req.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,birth_date.ilike.%${safe}%,chart_number.ilike.%${safe}%`);
      }
      const { data, error, count } = await req;
      setLoading(false);
      if (error) {
        toast.error('검색 실패');
        return;
      }
      setTotalCount(count ?? 0);
      const customers = (data ?? []) as Customer[];
      setResults(customers);

      if (customers.length > 0) {
        const ids = customers.map((c) => c.id);
        const [checkInsRes, paymentsRes, pkgPaymentsRes, pkgsRes] = await Promise.all([
          supabase
            .from('check_ins')
            .select('customer_id, checked_in_at')
            .in('customer_id', ids)
            .neq('status', 'cancelled'),
          supabase
            .from('payments')
            .select('customer_id, amount, payment_type')
            .in('customer_id', ids),
          supabase
            .from('package_payments')
            .select('customer_id, amount, payment_type')
            .in('customer_id', ids),
          supabase
            .from('packages')
            .select('customer_id')
            .in('customer_id', ids)
            .eq('status', 'active'),
        ]);

        const map = new Map<string, CustomerStats>();
        for (const id of ids) map.set(id, { visit_count: 0, last_visit: null, total_revenue: 0, has_package: false });

        for (const row of (checkInsRes.data ?? []) as { customer_id: string; checked_in_at: string }[]) {
          const s = map.get(row.customer_id);
          if (!s) continue;
          s.visit_count++;
          if (!s.last_visit || row.checked_in_at > s.last_visit) s.last_visit = row.checked_in_at;
        }
        for (const row of (paymentsRes.data ?? []) as { customer_id: string | null; amount: number; payment_type: string }[]) {
          if (!row.customer_id) continue;
          const s = map.get(row.customer_id);
          if (s) s.total_revenue += row.payment_type === 'refund' ? -row.amount : row.amount;
        }
        for (const row of (pkgPaymentsRes.data ?? []) as { customer_id: string; amount: number; payment_type: string }[]) {
          const s = map.get(row.customer_id);
          if (s) s.total_revenue += row.payment_type === 'refund' ? -row.amount : row.amount;
        }
        for (const row of (pkgsRes.data ?? []) as { customer_id: string }[]) {
          const s = map.get(row.customer_id);
          if (s) s.has_package = true;
        }
        setStatsMap(map);
      } else {
        setStatsMap(new Map());
      }
    },
    [clinic],
  );

  useEffect(() => {
    if (!clinic) return;
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, 1), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, clinic, runSearch]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    runSearch(query, newPage);
  };

  // 대시보드 고객차트 바로가기 → location.state.openCustomerId → 2번차트(미니홈피) 새 창
  // T-20260506-foot-CHART-CONSOLIDATE: CustomerDetailSheet 열기 → openChart로 교체
  useEffect(() => {
    if (navStateConsumed.current) return;
    if (!clinic) return;
    const state = location.state as { openCustomerId?: string } | null;
    if (!state?.openCustomerId) return;
    navStateConsumed.current = true;
    window.history.replaceState({}, '');
    openChart(state.openCustomerId);
  }, [clinic, location.state]);

  // T-20260510-foot-CUSTMGMT-CHART-PATTERN: 1번차트 패널 열기
  // T-20260511-foot-CUSTMGMT-DETAIL-SHEET: CheckInDetailSheet customerMode 사용 (stats 불필요)
  const handleRowClick = useCallback((c: Customer) => {
    setSelectedCustomer(c);
  }, []);

  // 우클릭 → 컨텍스트 메뉴
  const handleRowContextMenu = useCallback((e: React.MouseEvent, c: Customer) => {
    e.preventDefault();
    setCtxMenu({ customer: c, x: e.clientX, y: e.clientY });
  }, []);

  const deleteCustomer = async (c: Customer) => {
    if (!window.confirm(`${c.name}님을 삭제하시겠습니까?\n체크인·패키지 이력이 없을 때만 삭제됩니다.`)) return;
    const [{ count: ciCount }, { count: pkgCount }] = await Promise.all([
      supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('customer_id', c.id),
      supabase.from('packages').select('id', { count: 'exact', head: true }).eq('customer_id', c.id),
    ]);
    if ((ciCount ?? 0) > 0 || (pkgCount ?? 0) > 0) {
      toast.error(`삭제 불가: 체크인 ${ciCount ?? 0}건·패키지 ${pkgCount ?? 0}건이 연결되어 있습니다`);
      return;
    }
    const { error } = await supabase.from('customers').delete().eq('id', c.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success(`${c.name}님 삭제됨`);
    runSearch(query, page);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const rangeFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, totalCount);

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="relative w-96">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 · 전화번호 · 생년월일(YYMMDD) · 차트번호"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-3">
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              전체 <span className="font-medium text-foreground">{totalCount}</span>명 중{' '}
              {rangeFrom}–{rangeTo}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            클릭=간편차트(1번) / 우클릭=고객차트(2번)
          </span>
        </div>
        <Button onClick={() => setOpenCreate(true)} className="gap-1">
          <Plus className="h-4 w-4" /> 신규 고객
        </Button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">이름</th>
              <th className="px-4 py-2 text-left font-medium">전화번호</th>
              <th className="px-4 py-2 text-left font-medium">생년월일</th>
              <th className="px-4 py-2 text-left font-medium">차트번호</th>
              <th className="px-4 py-2 text-right font-medium">방문</th>
              <th className="px-4 py-2 text-left font-medium">최종 방문</th>
              <th className="px-4 py-2 text-right font-medium">결제액</th>
              <th className="px-4 py-2 text-left font-medium">고객메모</th>
              <th className="px-4 py-2 text-center font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {results.map((c) => {
              const stats = statsMap.get(c.id);
              return (
                <tr
                  key={c.id}
                  onClick={() => handleRowClick(c)}
                  onContextMenu={(e) => handleRowContextMenu(e, c)}
                  className="cursor-pointer border-t hover:bg-teal-50/40"
                >
                  <td className="px-4 py-2 font-medium">
                    <span className="flex items-center gap-1.5">
                      {c.name}
                      {stats?.has_package && <Badge variant="teal" className="text-[10px] px-1 py-0">PKG</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatPhone(c.phone)}</td>
                  <td className="px-4 py-2 text-muted-foreground tabular-nums">{c.birth_date ?? '-'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.chart_number ?? '-'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{stats?.visit_count ?? 0}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {stats?.last_visit ? format(new Date(stats.last_visit), 'yyyy-MM-dd') : '-'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {stats?.total_revenue ? formatAmount(stats.total_revenue) : '-'}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-muted-foreground">
                    {/* T-20260504-foot-MEMO-RESTRUCTURE: customer_memo 표시 */}
                    {c.customer_memo ?? ''}
                  </td>
                  {/* 관리 열: 차트보기(모든 역할) + 수정·삭제(admin만) */}
                  <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); openChart(c.id); }}
                        className="rounded p-1.5 hover:bg-teal-50 transition"
                        title="2번차트(미니홈피) 열기"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-teal-600" />
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingCustomer(c); }}
                            className="rounded p-1.5 hover:bg-muted transition"
                            title="고객 정보 수정"
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteCustomer(c); }}
                            className="rounded p-1.5 hover:bg-red-50 transition"
                            title="삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && results.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {query ? '검색 결과 없음' : '고객이 없습니다'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1 || loading}
            className="h-8 px-3 text-xs"
          >
            이전
          </Button>
          {getPageNumbers(page, totalPages).map((p, idx) =>
            p === '…' ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-xs text-muted-foreground select-none">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? 'default' : 'outline'}
                size="sm"
                onClick={() => handlePageChange(p as number)}
                disabled={loading}
                className={`h-8 min-w-[32px] px-2 text-xs ${
                  p === page ? 'bg-teal-600 hover:bg-teal-700 border-teal-600' : ''
                }`}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page + 1)}
            disabled={page === totalPages || loading}
            className="h-8 px-3 text-xs"
          >
            다음
          </Button>
        </div>
      )}

      {/* T-20260506-foot-CHART-CONSOLIDATE: CustomerDetailSheet 폐지 → 수정 전용 다이얼로그 */}
      <EditCustomerDialog
        customer={editingCustomer}
        onOpenChange={(o) => { if (!o) setEditingCustomer(null); }}
        onUpdated={() => {
          setEditingCustomer(null);
          runSearch(query, page);
        }}
      />

      <CreateCustomerDialog
        open={openCreate}
        clinicId={clinic?.id}
        onOpenChange={setOpenCreate}
        onCreated={() => {
          setOpenCreate(false);
          setPage(1);
          runSearch(query, 1);
        }}
      />

      {/* T-20260511-foot-CUSTMGMT-DETAIL-SHEET: 간편요약 → CheckInDetailSheet 전체 양식 교체 */}
      <CheckInDetailSheet
        checkIn={null}
        customerMode={
          selectedCustomer && clinic
            ? {
                customerId: selectedCustomer.id,
                customerName: selectedCustomer.name,
                customerPhone: selectedCustomer.phone,
                clinicId: clinic.id,
                chartNumber: selectedCustomer.chart_number,
              }
            : undefined
        }
        onClose={() => setSelectedCustomer(null)}
        onUpdated={() => runSearch(query, page)}
        onPayment={() => {}} // 고객관리에서는 결제 진입 불필요
      />

      {/* T-20260510-foot-CUSTMGMT-CHART-PATTERN: 우클릭 컨텍스트 메뉴 */}
      {ctxMenu && (
        <CustomerContextMenu
          customer={ctxMenu.customer}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onOpenChart={(c) => { openChart(c.id); setCtxMenu(null); }}
          onEdit={(c) => { setEditingCustomer(c); setCtxMenu(null); }}
          isAdmin={isAdmin}
        />
      )}

      {/* T-20260514-foot-CHART2-OPEN-BUG: 2번차트 슬라이드 패널 (팝업 차단 해소) */}
      <CustomerChartSheet
        customerId={chart2Id}
        onClose={() => setChart2Id(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditCustomerDialog — 고객 정보 수정 전용 다이얼로그 (차트 섹션 없음)
// T-20260506-foot-CHART-CONSOLIDATE: CustomerDetailSheet 차트 UI 완전 폐지
// ─────────────────────────────────────────────────────────────────────────────
// T-20260508-foot-CUST-FORM-REVAMP: 고객등급 옵션
const CUSTOMER_GRADE_OPTIONS = ['일반', '1단계', '2단계', '3단계'] as const;

function EditCustomerDialog({
  customer,
  onOpenChange,
  onUpdated,
}: {
  customer: Customer | null;
  onOpenChange: (o: boolean) => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState('');
  // phone: 읽기전용 표시 (T-20260508-foot-CUST-FORM-REVAMP: 전화번호 기입칸 삭제)
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [chartNumber, setChartNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [customerMemo, setCustomerMemo] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [tmMemo, setTmMemo] = useState('');
  const [referrerName, setReferrerName] = useState('');
  // T-20260508-foot-CUST-FORM-REVAMP: 신규 필드
  const [customerGrade, setCustomerGrade] = useState<string>('일반');
  const [customerEmail, setCustomerEmail] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (customer) {
      setName(customer.name);
      setPhone(customer.phone);
      setBirthDate(customer.birth_date ?? '');
      setChartNumber(customer.chart_number ?? '');
      setMemo(customer.memo ?? '');
      setCustomerMemo(customer.customer_memo ?? '');
      setLeadSource(customer.lead_source ?? '');
      setTmMemo(customer.tm_memo ?? '');
      setReferrerName(customer.referrer_name ?? '');
      setCustomerGrade(customer.customer_grade ?? '일반');
      setCustomerEmail(customer.customer_email ?? '');
      setPassportNumber(customer.passport_number ?? '');
      setPostalCode(customer.postal_code ?? '');
    }
  }, [customer]);

  const save = async () => {
    if (!customer) return;
    setSubmitting(true);
    const { error } = await supabase
      .from('customers')
      .update({
        name: name.trim(),
        // phone 유지 (읽기전용 표시이지만 기존값 보존)
        birth_date: birthDate.trim() || null,
        // chart_number: 자동 부여 후 변경 불가 (T-20260505-foot-CHART-NUMBER-AUTO)
        memo: memo.trim() || null,
        customer_memo: customerMemo.trim() || null, // T-20260504-foot-MEMO-RESTRUCTURE
        lead_source: leadSource.trim() || null,
        tm_memo: tmMemo.trim() || null,
        referrer_name: referrerName.trim() || null,
        // T-20260508-foot-CUST-FORM-REVAMP
        customer_grade: customerGrade || '일반',
        customer_email: customerEmail.trim() || null,
        passport_number: passportNumber.trim() || null,
        postal_code: postalCode.trim() || null,
      })
      .eq('id', customer.id);
    setSubmitting(false);
    if (error) {
      toast.error(`수정 실패: ${error.message}`);
      return;
    }
    toast.success('수정 완료');
    onUpdated();
  };

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>고객 정보 수정 — {customer?.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto space-y-3 pr-1">
          {/* 이름 */}
          <div className="space-y-1.5">
            <Label>이름</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {/* 전화번호 — 읽기전용 표시 (T-20260508-foot-CUST-FORM-REVAMP: 기입칸 삭제) */}
          <div className="space-y-1.5">
            <Label>전화번호 <span className="text-xs text-muted-foreground font-normal">(변경 불가)</span></Label>
            <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground select-all">
              {formatPhone(phone) || '—'}
            </div>
          </div>
          {/* 생년월일 / 차트번호 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>생년월일 <span className="text-xs text-muted-foreground font-normal">(YYMMDD)</span></Label>
              <Input
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="예: 900515"
                maxLength={6}
              />
            </div>
            <div className="space-y-1.5">
              <Label>차트번호</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground select-all">
                {chartNumber || '—'}
              </div>
              <p className="text-[10px] text-muted-foreground">자동 부여됨 (변경 불가)</p>
            </div>
          </div>
          {/* 고객등급 — T-20260508-foot-CUST-FORM-REVAMP */}
          <div className="space-y-1.5">
            <Label>고객등급</Label>
            <div className="flex gap-1.5 flex-wrap">
              {CUSTOMER_GRADE_OPTIONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setCustomerGrade(g)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition border ${
                    customerGrade === g
                      ? g === '일반'
                        ? 'bg-teal-600 text-white border-teal-600'
                        : g === '1단계'
                        ? 'bg-yellow-500 text-white border-yellow-500'
                        : g === '2단계'
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-red-600 text-white border-red-600'
                      : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          {/* 이메일 — T-20260508-foot-CUST-FORM-REVAMP */}
          <div className="space-y-1.5">
            <Label>이메일</Label>
            <Input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="example@email.com"
            />
          </div>
          {/* 여권번호 — T-20260508-foot-CUST-FORM-REVAMP */}
          <div className="space-y-1.5">
            <Label>여권번호 <span className="text-xs text-muted-foreground font-normal">(외국인)</span></Label>
            <Input
              value={passportNumber}
              onChange={(e) => setPassportNumber(e.target.value.toUpperCase())}
              placeholder="예: M12345678"
              className="font-mono"
            />
          </div>
          {/* 우편번호 — T-20260508-foot-CUST-FORM-REVAMP */}
          <div className="space-y-1.5">
            <Label>우편번호</Label>
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              placeholder="12345"
              maxLength={5}
              className="font-mono"
            />
          </div>
          {/* 내원경로 */}
          <div className="space-y-1.5">
            <Label>내원경로</Label>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setLeadSource(leadSource === opt ? '' : opt)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    leadSource === opt
                      ? 'bg-teal-600 text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          {/* 추천인 */}
          <div className="space-y-1.5">
            <Label>추천인</Label>
            <Input value={referrerName} onChange={(e) => setReferrerName(e.target.value)} placeholder="추천인 이름" />
          </div>
          {/* 고객메모 */}
          <div className="space-y-1.5">
            <Label>고객메모 <span className="text-xs text-muted-foreground font-normal">(성향·주차)</span></Label>
            <Textarea
              value={customerMemo}
              onChange={(e) => setCustomerMemo(e.target.value)}
              rows={2}
              placeholder="고객 성향, 특이사항, 주차 정보 등"
            />
          </div>
          {/* 상담메모 */}
          <div className="space-y-1.5">
            <Label>상담메모</Label>
            <Textarea
              value={tmMemo}
              onChange={(e) => setTmMemo(e.target.value)}
              rows={2}
              placeholder="실비 보험사, 상한액, 고객 성향 등..."
            />
          </div>
          {/* 내부메모 */}
          <div className="space-y-1.5">
            <Label>내부메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={submitting || !name.trim()} onClick={save}>
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateCustomerDialog — 신규 고객 등록
// ─────────────────────────────────────────────────────────────────────────────
function CreateCustomerDialog({
  open,
  clinicId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  clinicId: string | undefined;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  // chart_number: DB 트리거 자동생성 (T-20260505-foot-CHART-NUMBER-AUTO)
  const [memo, setMemo] = useState('');
  const [referrerName, setReferrerName] = useState('');
  // 추천인 자동완성 — 기존 고객 검색
  const [referrerQuery, setReferrerQuery] = useState('');
  const [referrerSuggestions, setReferrerSuggestions] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [referrerId, setReferrerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 인라인 자동검색으로 선택된 기존 고객 (중복 등록 방지)
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setBirthDate('');
      setMemo('');
      setReferrerName('');
      setReferrerQuery('');
      setReferrerSuggestions([]);
      setReferrerId(null);
      setSelectedExistingId(null);
    }
  }, [open]);

  // 기존 고객 선택 시 폼 자동 채움
  const handleExistingSelect = useCallback((p: PatientMatch) => {
    setName(p.name);
    setPhone(p.phone);
    if (p.birth_date) setBirthDate(p.birth_date);
    setSelectedExistingId(p.id);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedExistingId(null);
  }, []);

  // 추천인 검색 — 300ms 디바운스
  useEffect(() => {
    if (!clinicId || referrerQuery.trim().length < 1) {
      setReferrerSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone')
        .eq('clinic_id', clinicId)
        .ilike('name', `%${referrerQuery.trim()}%`)
        .limit(5);
      setReferrerSuggestions((data ?? []) as { id: string; name: string; phone: string }[]);
    }, 300);
    return () => clearTimeout(timer);
  }, [referrerQuery, clinicId]);

  const save = async () => {
    if (!clinicId) return;
    // 기존 고객 선택 상태에서는 신규 등록 차단 (중복 등록 방지)
    if (selectedExistingId) {
      toast.info('이미 등록된 고객입니다. 목록에서 해당 고객을 선택해 주세요.');
      onCreated();
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('customers').insert({
      clinic_id: clinicId,
      name: name.trim(),
      phone: phone.trim(),
      birth_date: birthDate.trim() || null,
      // chart_number: DB BEFORE INSERT 트리거가 자동 채번 (F-XXXX 형식)
      memo: memo.trim() || null,
      referrer_id: referrerId || null,
      referrer_name: !referrerId && referrerName.trim() ? referrerName.trim() : null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.code === '23505' ? '이미 등록된 전화번호입니다' : `등록 실패: ${error.message}`);
      return;
    }
    toast.success('고객 등록 완료');
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>신규 고객 등록</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>이름</Label>
            <InlinePatientSearch
              value={name}
              onChange={(v) => {
                setName(v);
                if (selectedExistingId) setSelectedExistingId(null);
              }}
              onSelect={handleExistingSelect}
              onClearSelection={clearSelection}
              searchField="name"
              clinicId={clinicId}
              selectedCustomerId={selectedExistingId}
              autoFocus
              placeholder="이름 (2글자 이상 입력 시 기존 고객 자동 검색)"
            />
          </div>
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <InlinePatientSearch
              value={phone}
              onChange={(v) => {
                setPhone(v);
                if (selectedExistingId) setSelectedExistingId(null);
              }}
              onSelect={handleExistingSelect}
              onClearSelection={clearSelection}
              searchField="phone"
              clinicId={clinicId}
              selectedCustomerId={selectedExistingId}
              inputMode="tel"
              placeholder="전화번호 (4자리 이상 입력 시 자동 검색)"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>생년월일 <span className="text-xs text-muted-foreground font-normal">(YYMMDD)</span></Label>
              <Input
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="예: 900515"
                maxLength={6}
              />
            </div>
            {/* 차트번호: DB 트리거 자동생성 — 등록 후 F-XXXX 자동 부여 */}
          </div>
          <div className="space-y-1.5">
            <Label>메모</Label>
            <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
          </div>
          {/* 추천인 */}
          <div className="space-y-1.5">
            <Label>추천인 <span className="text-xs text-muted-foreground font-normal">(선택)</span></Label>
            {referrerId ? (
              <div className="flex items-center gap-2 rounded-md border bg-teal-50 px-3 py-2 text-sm">
                <span className="flex-1 font-medium text-teal-800">
                  {referrerSuggestions.find((s) => s.id === referrerId)?.name ?? referrerName}
                </span>
                <button
                  type="button"
                  onClick={() => { setReferrerId(null); setReferrerName(''); setReferrerQuery(''); }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="추천인 이름 검색 또는 직접 입력"
                  value={referrerQuery || referrerName}
                  onChange={(e) => {
                    setReferrerQuery(e.target.value);
                    setReferrerName(e.target.value);
                    setReferrerId(null);
                  }}
                />
                {referrerSuggestions.length > 0 && (
                  <ul className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-md text-sm">
                    {referrerSuggestions.map((s) => (
                      <li
                        key={s.id}
                        className="cursor-pointer px-3 py-2 hover:bg-teal-50"
                        onMouseDown={() => {
                          setReferrerId(s.id);
                          setReferrerName(s.name);
                          setReferrerQuery('');
                          setReferrerSuggestions([]);
                        }}
                      >
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-muted-foreground">{formatPhone(s.phone)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button disabled={submitting || !name.trim() || !phone.trim()} onClick={save}>
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── T-20260510-foot-CUSTMGMT-CHART-PATTERN: 우클릭 컨텍스트 메뉴 ─────────────

interface CustomerContextMenuProps {
  customer: Customer;
  x: number;
  y: number;
  onClose: () => void;
  onOpenChart: (c: Customer) => void;
  onEdit: (c: Customer) => void;
  isAdmin: boolean;
}

function CustomerContextMenu({ customer, x, y, onClose, onOpenChart, onEdit, isAdmin }: CustomerContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const safeX = Math.min(x, window.innerWidth - 190);
  const safeY = Math.min(y, window.innerHeight - 120);

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[170px] rounded-lg border bg-white shadow-xl py-1 select-none"
      style={{ top: safeY, left: safeX }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-xs font-semibold text-teal-700 border-b truncate">
        {customer.name}
      </div>
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-teal-50 transition text-left"
        onClick={() => onOpenChart(customer)}
      >
        <BookOpen className="h-4 w-4 text-teal-600 shrink-0" />
        고객차트 (2번)
      </button>
      {isAdmin && (
        <button
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted/50 transition text-left"
          onClick={() => onEdit(customer)}
        >
          <Pencil className="h-4 w-4 text-muted-foreground shrink-0" />
          정보 수정
        </button>
      )}
    </div>
  );
}
