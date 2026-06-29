import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  User,
  UserX,
  Filter,
  ArrowUpDown,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  AlertCircle,
  Banknote,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount, chartNoBadge, chartNoDisplay } from '@/lib/format';
// T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
import { PaymentEditDialog, PaymentAuditLogsPanel } from '@/components/PaymentEditDialog';
import type { EditMode, PaymentRowForEdit } from '@/components/PaymentEditDialog';
import type { CheckIn, CheckInStatus, Reservation } from '@/lib/types';
import { STATUS_KO, VISIT_TYPE_KO, METHOD_KO } from '@/lib/status';
import { elapsedLabel } from '@/lib/elapsed';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* ---------- types ---------- */

interface StatusTransition {
  id: string;
  check_in_id: string;
  from_status: CheckInStatus;
  to_status: CheckInStatus;
  transitioned_at: string;
}

interface PaymentRow {
  id: string;
  check_in_id: string | null;
  customer_id: string | null;
  amount: number;
  method: string;
  installment: number | null;
  payment_type: 'payment' | 'refund';
  memo: string | null;
  created_at: string;
  // T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
  status?: string | null;
  clinic_id?: string | null;
}

interface PackagePaymentRow {
  id: string;
  package_id: string;
  customer_id: string;
  amount: number;
  method: string;
  payment_type: 'payment' | 'refund';
  memo: string | null;
  created_at: string;
}

type FilterTab = 'all' | 'in_progress' | 'done' | 'cancelled' | 'noshow';
type VisitFilter = 'all' | 'new' | 'returning';
type SortMode = 'queue' | 'time';

/* METHOD_KO → @/lib/status 공유 상수 사용 */
/* T-20260629-foot-SIDEBAR-DAYHIST-COMPACT-MONOTONE:
 * 일일 이력 화면 한정 모노톤(그레이스케일) 토큰. 공유 STATUS_COLOR/VISIT_TYPE_COLOR(타 화면 영향)
 * 는 건드리지 않고 본 화면에서만 색을 제거한다. 상태 구분은 텍스트 라벨 + 채움 농도/굵기로 보존. */
function statusMono(status: CheckInStatus): string {
  if (status === 'cancelled') return 'bg-gray-50 text-gray-400 border border-gray-200';
  if (status === 'done') return 'bg-gray-100 text-gray-600 border border-gray-200';
  return 'bg-gray-200 text-gray-800 font-semibold border border-gray-300';
}
const VISIT_MONO = 'bg-gray-100 text-gray-700 border border-gray-200';

/* ---------- helpers ---------- */

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function dayBounds(dateStr: string) {
  return {
    start: `${dateStr}T00:00:00+09:00`,
    end: `${dateStr}T23:59:59+09:00`,
  };
}

/** Minutes between two ISO timestamps. Returns null if either is missing. */
function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const diff = (new Date(to).getTime() - new Date(from).getTime()) / 60000;
  return diff > 0 ? Math.round(diff) : null;
}

function formatTime(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

function isInProgress(status: CheckInStatus): boolean {
  return status !== 'done' && status !== 'cancelled';
}

/** 결제대기 이후 단계인지 판정 */
const PAID_EXPECTED_STATUSES: CheckInStatus[] = [
  'treatment_waiting',
  'preconditioning',
  'laser',
  'done',
];

/* ---------- component ---------- */

export default function DailyHistory() {
  const clinic = useClinic();
  const [date, setDate] = useState(todayStr());
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [transitions, setTransitions] = useState<StatusTransition[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [pkgPayments, setPkgPayments] = useState<PackagePaymentRow[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterTab>('all');
  const [visitFilter, setVisitFilter] = useState<VisitFilter>('all');
  const [sort, setSort] = useState<SortMode>('queue');
  const [showNoshow, setShowNoshow] = useState(false);
  // T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE
  const [payEditTarget, setPayEditTarget] = useState<PaymentRowForEdit | null>(null);
  const [payEditMode, setPayEditMode] = useState<EditMode>('edit');

  // Fetch data when clinic or date changes
  const fetchData = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { start, end } = dayBounds(date);

    const [ciRes, trRes, payRes, pkgPayRes, resvRes] = await Promise.all([
      supabase
        .from('check_ins')
        // T-20260612-foot-CHARTNO-B2-P2: 체크인 카드 환자명 옆 차트번호 인접 표시용 embed
        .select('*, customers(name, chart_number)')
        .eq('clinic_id', clinic.id)
        .gte('checked_in_at', start)
        .lte('checked_in_at', end)
        .order('queue_number', { ascending: true }),
      supabase
        .from('status_transitions')
        .select('id, check_in_id, from_status, to_status, transitioned_at')
        .eq('clinic_id', clinic.id)
        .gte('transitioned_at', start)
        .lte('transitioned_at', end)
        .order('transitioned_at', { ascending: true }),
      supabase
        .from('payments')
        .select('id, check_in_id, customer_id, amount, method, installment, payment_type, memo, created_at, status, clinic_id')
        .eq('clinic_id', clinic.id)
        .gte('created_at', start)
        .lte('created_at', end)
        .neq('status', 'deleted'),
      supabase
        .from('package_payments')
        .select('id, package_id, customer_id, amount, method, payment_type, memo, created_at')
        .eq('clinic_id', clinic.id)
        .gte('created_at', start)
        .lte('created_at', end),
      supabase
        .from('reservations')
        // T-20260612-foot-CHARTNO-B2-P2: 미내원 예약 테이블 차트번호 칼럼용 embed
        .select('*, customers(name, chart_number)')
        .eq('clinic_id', clinic.id)
        .eq('reservation_date', date),
    ]);

    setCheckIns((ciRes.data ?? []) as CheckIn[]);
    setTransitions((trRes.data ?? []) as StatusTransition[]);
    setPayments((payRes.data ?? []) as PaymentRow[]);
    setPkgPayments((pkgPayRes.data ?? []) as PackagePaymentRow[]);
    setReservations((resvRes.data ?? []) as Reservation[]);
    setExpandedIds(new Set());
    setLoading(false);
  }, [clinic, date]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Transitions grouped by check_in_id
  const transitionMap = useMemo(() => {
    const map = new Map<string, StatusTransition[]>();
    for (const t of transitions) {
      const list = map.get(t.check_in_id) ?? [];
      list.push(t);
      map.set(t.check_in_id, list);
    }
    return map;
  }, [transitions]);

  // Payments grouped by check_in_id
  const paymentMap = useMemo(() => {
    const map = new Map<string, PaymentRow[]>();
    for (const p of payments) {
      if (!p.check_in_id) continue;
      const list = map.get(p.check_in_id) ?? [];
      list.push(p);
      map.set(p.check_in_id, list);
    }
    return map;
  }, [payments]);

  // 미체크인 예약 (추정 노쇼) — 당일 예약 중 check_in 매칭되지 않은 건
  const unmatchedReservations = useMemo(() => {
    const checkedInResvIds = new Set(
      checkIns.map((ci) => ci.reservation_id).filter(Boolean),
    );
    const checkedInPhones = new Set(
      checkIns.map((ci) => ci.customer_phone).filter(Boolean),
    );
    return reservations.filter((r) => {
      if (r.status === 'cancelled') return false;
      if (checkedInResvIds.has(r.id)) return false;
      // 예약 전화번호로도 체크인 매칭 시도
      if (r.customer_phone && checkedInPhones.has(r.customer_phone)) return false;
      return true;
    });
  }, [reservations, checkIns]);

  // Revenue summary
  const revenueSummary = useMemo(() => {
    let singleTotal = 0;
    let singleRefund = 0;
    for (const p of payments) {
      if (p.payment_type === 'refund') singleRefund += p.amount;
      else singleTotal += p.amount;
    }
    let pkgTotal = 0;
    let pkgRefund = 0;
    for (const p of pkgPayments) {
      if (p.payment_type === 'refund') pkgRefund += p.amount;
      else pkgTotal += p.amount;
    }
    return {
      singleTotal,
      singleRefund,
      pkgTotal,
      pkgRefund,
      netTotal: singleTotal - singleRefund + pkgTotal - pkgRefund,
    };
  }, [payments, pkgPayments]);

  // Summary calculations
  const summary = useMemo(() => {
    const total = checkIns.length;
    const byVisit = { new: 0, returning: 0 };
    let doneCount = 0;
    let cancelledCount = 0;
    let totalElapsed = 0;
    let elapsedCount = 0;

    // 미결제 건수: 결제대기 이후 단계이면서 결제 내역이 없는 건
    let unpaidCount = 0;

    for (const ci of checkIns) {
      if (ci.visit_type in byVisit) {
        byVisit[ci.visit_type as keyof typeof byVisit]++;
      }
      if (ci.status === 'done') {
        doneCount++;
        const mins = minutesBetween(ci.checked_in_at, ci.completed_at);
        if (mins !== null && mins < 8 * 60) {
          totalElapsed += mins;
          elapsedCount++;
        }
      }
      if (ci.status === 'cancelled') cancelledCount++;

      // 결제대기 이후 단계인데 결제 기록이 없으면 미결제
      if (PAID_EXPECTED_STATUSES.includes(ci.status) && !paymentMap.has(ci.id) && !ci.package_id) {
        unpaidCount++;
      }
    }

    const avgMinutes = elapsedCount > 0 ? Math.round(totalElapsed / elapsedCount) : null;

    return {
      total,
      byVisit,
      doneCount,
      cancelledCount,
      avgMinutes,
      unpaidCount,
      noshowCount: unmatchedReservations.length,
    };
  }, [checkIns, paymentMap, unmatchedReservations]);

  // Filtered & sorted list
  const filteredCheckIns = useMemo(() => {
    let list = checkIns;

    if (filter === 'in_progress') {
      list = list.filter((ci) => isInProgress(ci.status));
    } else if (filter === 'done') {
      list = list.filter((ci) => ci.status === 'done');
    } else if (filter === 'cancelled') {
      list = list.filter((ci) => ci.status === 'cancelled');
    }

    // 방문유형 필터
    if (visitFilter !== 'all') {
      list = list.filter((ci) => ci.visit_type === visitFilter);
    }

    if (sort === 'time') {
      return [...list].sort(
        (a, b) => new Date(a.checked_in_at).getTime() - new Date(b.checked_in_at).getTime(),
      );
    }
    // queue sort (default) - already sorted from DB, but ensure
    return [...list].sort((a, b) => (a.queue_number ?? 0) - (b.queue_number ?? 0));
  }, [checkIns, filter, visitFilter, sort]);

  // Date navigation
  const goToday = () => setDate(todayStr());
  const goPrev = () => setDate(format(subDays(new Date(date), 1), 'yyyy-MM-dd'));
  const goNext = () => {
    const next = format(addDays(new Date(date), 1), 'yyyy-MM-dd');
    if (next <= todayStr()) setDate(next);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSort = () => setSort((prev) => (prev === 'queue' ? 'time' : 'queue'));

  const dateLabel = format(new Date(date), 'yyyy년 M월 d일 (EEEE)', { locale: ko });
  const isToday = date === todayStr();

  if (loading && !clinic) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        로딩 중...
      </div>
    );
  }

  return (
    <div data-testid="daily-history-root" className="h-full overflow-auto flex flex-col gap-3 p-3">
      {/* ---- Header: Date picker ---- */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-sm font-bold">일일 이력</h1>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon-sm" onClick={goPrev} className="size-7">
            <ChevronLeft className="size-3.5" />
          </Button>
          <button
            onClick={goToday}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted transition"
          >
            <Calendar className="size-3.5 text-gray-400" />
            <span>{dateLabel}</span>
          </button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={goNext}
            disabled={isToday}
            className="size-7"
          >
            <ChevronRight className="size-3.5" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={goToday} className="h-7 px-2 text-xs">
              오늘
            </Button>
          )}
        </div>
      </div>

      {/* ---- Summary Cards (Row 1: 방문 통계) ---- */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="p-2 pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground leading-none">총 접수</CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="text-base font-bold">{summary.total}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">건</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-2 pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground leading-none">신규 / 재진 / 체험</CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="flex items-baseline gap-1.5 text-sm font-bold">
              <span className="text-foreground">{summary.byVisit.new}</span>
              <span className="text-muted-foreground text-xs">/</span>
              <span className="text-foreground">{summary.byVisit.returning}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-2 pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground leading-none">완료 / 취소</CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="flex items-baseline gap-1.5 text-sm font-bold">
              <span className="text-foreground">{summary.doneCount}</span>
              <span className="text-muted-foreground text-xs">/</span>
              <span className="text-muted-foreground">{summary.cancelledCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-2 pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground leading-none flex items-center gap-1">
              <Clock className="size-3" />
              평균 소요시간
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="text-base font-bold">
              {summary.avgMinutes !== null ? (
                elapsedLabel(summary.avgMinutes)
              ) : (
                <span className="text-muted-foreground text-xs font-normal">데이터 없음</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- Summary Cards (Row 2: 매출 + 운영 알림) ---- */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="p-2 pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground leading-none flex items-center gap-1">
              <Banknote className="size-3" />
              일 매출
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="text-base font-bold tabular-nums">
              {formatAmount(revenueSummary.netTotal)}
              <span className="text-[10px] font-normal text-muted-foreground ml-0.5">원</span>
            </div>
            {(revenueSummary.singleRefund > 0 || revenueSummary.pkgRefund > 0) && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                환불 -{formatAmount(revenueSummary.singleRefund + revenueSummary.pkgRefund)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-2 pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground leading-none flex items-center gap-1">
              <CreditCard className="size-3" />
              단건 / 패키지
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="flex items-baseline gap-1.5 text-sm font-bold tabular-nums">
              <span className="text-foreground">{formatAmount(revenueSummary.singleTotal)}</span>
              <span className="text-muted-foreground text-xs">/</span>
              <span className="text-foreground">{formatAmount(revenueSummary.pkgTotal)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className={summary.unpaidCount > 0 ? 'border-gray-400 bg-gray-50' : ''}>
          <CardHeader className="p-2 pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground leading-none flex items-center gap-1">
              <AlertCircle className="size-3" />
              미결제
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className={`text-base font-bold ${summary.unpaidCount > 0 ? 'text-gray-900' : ''}`}>
              {summary.unpaidCount}
              <span className="text-[10px] font-normal text-muted-foreground ml-0.5">건</span>
            </div>
          </CardContent>
        </Card>

        <Card className={summary.noshowCount > 0 ? 'border-gray-400 bg-gray-50' : ''}>
          <CardHeader className="p-2 pb-1">
            <CardTitle className="text-[11px] font-medium text-muted-foreground leading-none flex items-center gap-1">
              <UserX className="size-3" />
              추정 노쇼
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className={`text-base font-bold ${summary.noshowCount > 0 ? 'text-gray-900' : ''}`}>
              {summary.noshowCount}
              <span className="text-[10px] font-normal text-muted-foreground ml-0.5">건</span>
            </div>
            {summary.noshowCount > 0 && (
              <button
                onClick={() => setShowNoshow((v) => !v)}
                className="text-[10px] text-gray-600 underline mt-0.5 hover:text-gray-900"
              >
                {showNoshow ? '닫기' : '상세 보기'}
              </button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- 추정 노쇼 목록 (토글) ---- */}
      {showNoshow && unmatchedReservations.length > 0 && (
        <Card className="border-gray-300 bg-gray-50">
          <CardHeader className="p-2 pb-1">
            <CardTitle className="flex items-center gap-1 text-xs font-semibold text-gray-700">
              <UserX className="size-3.5" />
              미체크인 예약 (추정 노쇼) — {unmatchedReservations.length}건
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-[10px] text-muted-foreground">
                    <th className="pb-1 font-medium">예약 시간</th>
                    <th className="pb-1 font-medium">고객명</th>
                    {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접 칼럼(분리 유지) */}
                    <th className="pb-1 font-medium">차트번호</th>
                    <th className="pb-1 font-medium">연락처</th>
                    <th className="pb-1 font-medium">방문 유형</th>
                    <th className="pb-1 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedReservations
                    .sort((a, b) => a.reservation_time.localeCompare(b.reservation_time))
                    .map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-1 tabular-nums">{r.reservation_time?.slice(0, 5)}</td>
                        <td className="py-1 font-medium">{r.customer_name ?? '—'}</td>
                        {/* T-20260612-foot-CHARTNO-B2-P2: 차트번호 인접 칼럼(미발번 명시) */}
                        <td className="py-1 font-mono text-[10px] text-muted-foreground">{chartNoDisplay(r.customers?.chart_number ?? null)}</td>
                        <td className="py-1 text-muted-foreground">{r.customer_phone ?? '—'}</td>
                        <td className="py-1">
                          <Badge className={`${VISIT_MONO} text-[10px] px-1.5 py-0`}>
                            {VISIT_TYPE_KO[r.visit_type]}
                          </Badge>
                        </td>
                        <td className="py-1">
                          <Badge className={r.status === 'no_show' ? 'bg-gray-200 text-gray-800 font-semibold border border-gray-300 text-[10px] px-1.5 py-0' : 'bg-gray-100 text-gray-500 border border-gray-200 text-[10px] px-1.5 py-0'}>
                            {r.status === 'no_show' ? '노쇼' : r.status === 'confirmed' ? '미내원' : r.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Filters & Sort ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
            <TabsList className="h-7">
              <TabsTrigger value="all" className="text-xs px-2 py-0.5">
                <Filter className="mr-1 size-3" />
                전체 ({summary.total})
              </TabsTrigger>
              <TabsTrigger value="in_progress" className="text-xs px-2 py-0.5">
                진행중 ({summary.total - summary.doneCount - summary.cancelledCount})
              </TabsTrigger>
              <TabsTrigger value="done" className="text-xs px-2 py-0.5">
                완료 ({summary.doneCount})
              </TabsTrigger>
              <TabsTrigger value="cancelled" className="text-xs px-2 py-0.5">
                취소 ({summary.cancelledCount})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button variant="outline" size="sm" onClick={toggleSort} className="h-7 px-2 text-xs">
            <ArrowUpDown className="mr-1 size-3" />
            {sort === 'queue' ? '대기번호순' : '접수시간순'}
          </Button>
        </div>

        {/* 방문유형 필터 */}
        <div className="flex items-center gap-1.5">
          <User className="size-3 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground">방문유형:</span>
          <div className="flex gap-1">
            {([
              { value: 'all' as VisitFilter, label: '전체' },
              { value: 'new' as VisitFilter, label: `초진 (${summary.byVisit.new})` },
              { value: 'returning' as VisitFilter, label: `재진 (${summary.byVisit.returning})` },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setVisitFilter(opt.value)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                  visitFilter === opt.value
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Timeline List ---- */}
      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
          데이터 로딩 중...
        </div>
      ) : filteredCheckIns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-xs text-muted-foreground">
          <User className="mb-1 size-5 text-muted-foreground/40" />
          해당 조건의 접수 내역이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filteredCheckIns.map((ci) => {
            const expanded = expandedIds.has(ci.id);
            const ciTransitions = transitionMap.get(ci.id) ?? [];
            const elapsed = minutesBetween(ci.checked_in_at, ci.completed_at);

            return (
              <Card key={ci.id} data-testid="dayhist-ci-card" className="overflow-hidden">
                {/* Main row */}
                <button
                  onClick={() => toggleExpand(ci.id)}
                  className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50 transition"
                >
                  {/* Expand indicator */}
                  <span className="shrink-0 text-muted-foreground">
                    {expanded ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRightIcon className="size-3.5" />
                    )}
                  </span>

                  {/* Queue number */}
                  <span className="shrink-0 flex size-6 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-700">
                    {ci.queue_number ?? '-'}
                  </span>

                  {/* Name + visit type */}
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{ci.customer_name}</span>
                    {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
                    <span className="shrink-0 font-mono text-[10px] text-gray-500">{chartNoBadge(ci.customers?.chart_number ?? null)}</span>
                    <Badge className={`${VISIT_MONO} text-[10px] px-1.5 py-0`}>
                      {VISIT_TYPE_KO[ci.visit_type]}
                    </Badge>
                  </div>

                  {/* Status badge */}
                  <Badge className={`${statusMono(ci.status)} text-[10px] px-1.5 py-0`}>
                    {STATUS_KO[ci.status]}
                  </Badge>

                  {/* Times */}
                  <div className="hidden shrink-0 items-center gap-2 text-[10px] text-muted-foreground sm:flex">
                    <span className="flex items-center gap-0.5">
                      <Clock className="size-3" />
                      {formatTime(ci.checked_in_at)}
                    </span>
                    {ci.completed_at && (
                      <>
                        <span>→</span>
                        <span>{formatTime(ci.completed_at)}</span>
                      </>
                    )}
                    {elapsed !== null && (
                      <span className="rounded bg-gray-100 px-1 py-0 font-medium text-gray-700">
                        {elapsedLabel(elapsed)}
                      </span>
                    )}
                  </div>
                </button>

                {/* Mobile time row */}
                <div className="flex items-center gap-2 border-t px-2 py-1 text-[10px] text-muted-foreground sm:hidden">
                  <span className="flex items-center gap-0.5">
                    <Clock className="size-3" />
                    접수 {formatTime(ci.checked_in_at)}
                  </span>
                  {ci.completed_at && (
                    <span>완료 {formatTime(ci.completed_at)}</span>
                  )}
                  {elapsed !== null && (
                    <span className="rounded bg-gray-100 px-1 py-0 font-medium text-gray-700">
                      {elapsedLabel(elapsed)}
                    </span>
                  )}
                </div>

                {/* Expanded: Status transitions + Payment details */}
                {expanded && (
                  <div className="border-t bg-muted/30 px-2 py-2">
                    {/* Status transitions */}
                    {ciTransitions.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">상태 전환 기록이 없습니다.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">상태 전환 이력</p>
                        <div className="flex flex-wrap items-center gap-1 text-[11px]">
                          {ciTransitions.map((t, idx) => {
                            const prevTime =
                              idx === 0
                                ? ci.checked_in_at
                                : ciTransitions[idx - 1].transitioned_at;
                            const mins = minutesBetween(prevTime, t.transitioned_at);
                            const minsLabel = mins !== null ? `${mins}분` : '';

                            return (
                              <span key={t.id} className="flex items-center gap-1">
                                {idx === 0 && (
                                  <>
                                    <Badge className={`${statusMono(t.from_status)} text-[10px] px-1.5 py-0`}>
                                      {STATUS_KO[t.from_status]}
                                    </Badge>
                                  </>
                                )}
                                <span className="text-muted-foreground">
                                  →{' '}
                                  {minsLabel && (
                                    <span className="text-[10px] text-muted-foreground/70">({minsLabel})</span>
                                  )}{' '}
                                </span>
                                <Badge className={`${statusMono(t.to_status)} text-[10px] px-1.5 py-0`}>
                                  {STATUS_KO[t.to_status]}
                                </Badge>
                              </span>
                            );
                          })}
                        </div>

                        {/* Transition detail table */}
                        <div className="mt-2 overflow-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="border-b text-left text-[10px] text-muted-foreground">
                                <th className="pb-1 font-medium">시각</th>
                                <th className="pb-1 font-medium">변경 전</th>
                                <th className="pb-1 font-medium">변경 후</th>
                                <th className="pb-1 font-medium text-right">소요</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ciTransitions.map((t, idx) => {
                                const prevTime =
                                  idx === 0
                                    ? ci.checked_in_at
                                    : ciTransitions[idx - 1].transitioned_at;
                                const mins = minutesBetween(prevTime, t.transitioned_at);

                                return (
                                  <tr key={t.id} className="border-b last:border-0">
                                    <td className="py-1 tabular-nums text-muted-foreground">
                                      {formatTime(t.transitioned_at)}
                                    </td>
                                    <td className="py-1">
                                      <Badge className={`${statusMono(t.from_status)} text-[10px] px-1.5 py-0`}>
                                        {STATUS_KO[t.from_status]}
                                      </Badge>
                                    </td>
                                    <td className="py-1">
                                      <Badge className={`${statusMono(t.to_status)} text-[10px] px-1.5 py-0`}>
                                        {STATUS_KO[t.to_status]}
                                      </Badge>
                                    </td>
                                    <td className="py-1 text-right tabular-nums">
                                      {mins !== null ? `${mins}분` : '-'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Payment details for this check-in */}
                    {(() => {
                      const ciPayments = paymentMap.get(ci.id) ?? [];
                      if (ciPayments.length === 0) {
                        if (PAID_EXPECTED_STATUSES.includes(ci.status) && !ci.package_id) {
                          return (
                            <div className="mt-2 flex items-center gap-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-700">
                              <AlertCircle className="size-3" />
                              <span>결제 기록 없음 (미결제)</span>
                            </div>
                          );
                        }
                        if (ci.package_id) {
                          return (
                            <div className="mt-2 flex items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                              <CreditCard className="size-3" />
                              <span>패키지 결제 (회차 소진)</span>
                            </div>
                          );
                        }
                        return null;
                      }
                      const payTotal = ciPayments.reduce(
                        (acc, p) => acc + (p.payment_type === 'refund' ? -p.amount : p.amount),
                        0,
                      );
                      return (
                        <div className="mt-2">
                          <p className="mb-1 text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                            <CreditCard className="size-3" />
                            결제 내역
                            <span className="ml-auto font-bold tabular-nums">
                              합계 {formatAmount(payTotal)}원
                            </span>
                          </p>
                          <div className="overflow-auto">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="border-b text-left text-[10px] text-muted-foreground">
                                  <th className="pb-1 font-medium">시각</th>
                                  <th className="pb-1 font-medium">방식</th>
                                  <th className="pb-1 font-medium">유형</th>
                                  <th className="pb-1 font-medium text-right">금액</th>
                                  <th className="pb-1 font-medium">메모</th>
                                  <th className="pb-1 font-medium text-right">작업</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ciPayments.map((p) => (
                                  <tr key={p.id} className="border-b last:border-0">
                                    <td className="py-1 tabular-nums text-muted-foreground">
                                      {formatTime(p.created_at)}
                                    </td>
                                    <td className="py-1">{METHOD_KO[p.method] ?? p.method}</td>
                                    <td className="py-1">
                                      <Badge
                                        className={
                                          p.status === 'cancelled'
                                            ? 'bg-gray-50 text-gray-400 border border-gray-200 text-[10px] px-1.5 py-0'
                                            : p.payment_type === 'refund'
                                              ? 'bg-gray-100 text-gray-600 border border-gray-200 text-[10px] px-1.5 py-0'
                                              : 'bg-gray-200 text-gray-800 font-semibold border border-gray-300 text-[10px] px-1.5 py-0'
                                        }
                                      >
                                        {p.status === 'cancelled' ? '취소' : p.payment_type === 'refund' ? '환불' : '결제'}
                                      </Badge>
                                    </td>
                                    <td className={`py-1 text-right tabular-nums font-medium ${p.status === 'cancelled' ? 'line-through text-muted-foreground' : ''}`}>
                                      {p.payment_type === 'refund' ? '-' : ''}
                                      {formatAmount(p.amount)}
                                    </td>
                                    <td className="py-1 text-muted-foreground truncate max-w-[100px]">
                                      {p.memo || '—'}
                                    </td>
                                    {/* T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE */}
                                    <td className="py-1 text-right">
                                      <div className="flex items-center justify-end gap-0.5">
                                        {p.status !== 'cancelled' && (
                                          <button
                                            type="button"
                                            data-testid={`btn-edit-payment-${p.id}`}
                                            title="수납 수정"
                                            onClick={() => { setPayEditTarget(p as PaymentRowForEdit); setPayEditMode('edit'); }}
                                            className="rounded px-1 py-0.5 text-[10px] text-gray-600 hover:bg-gray-200 transition"
                                          >수정</button>
                                        )}
                                        {p.status !== 'cancelled' && (
                                          <button
                                            type="button"
                                            data-testid={`btn-cancel-payment-${p.id}`}
                                            title="수납 취소"
                                            onClick={() => { setPayEditTarget(p as PaymentRowForEdit); setPayEditMode('cancel'); }}
                                            className="rounded px-1 py-0.5 text-[10px] text-gray-500 hover:bg-gray-200 transition"
                                          >취소</button>
                                        )}
                                        <button
                                          type="button"
                                          data-testid={`btn-delete-payment-${p.id}`}
                                          title="수납 삭제"
                                          onClick={() => { setPayEditTarget(p as PaymentRowForEdit); setPayEditMode('delete'); }}
                                          className="rounded px-1 py-0.5 text-[10px] text-gray-700 font-medium hover:bg-gray-200 transition"
                                        >삭제</button>
                                        <PaymentAuditLogsPanel paymentId={p.id} />
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* T-20260514-foot-PAYMENT-EDIT-CANCEL-DELETE */}
      <PaymentEditDialog
        payment={payEditTarget}
        mode={payEditMode}
        onClose={() => setPayEditTarget(null)}
        onDone={() => { setPayEditTarget(null); fetchData(); }}
      />
    </div>
  );
}
