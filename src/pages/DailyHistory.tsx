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
import { getClinic } from '@/lib/clinic';
import { formatAmount } from '@/lib/format';
import type { CheckIn, CheckInStatus, Clinic, Reservation } from '@/lib/types';
import { STATUS_KO, VISIT_TYPE_KO, STATUS_COLOR, VISIT_TYPE_COLOR } from '@/lib/status';
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
  payment_type: 'payment' | 'refund';
  memo: string | null;
  created_at: string;
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
type SortMode = 'queue' | 'time';

/* STATUS_COLOR, VISIT_TYPE_COLOR → @/lib/status 공유 상수 사용 */

const METHOD_KO: Record<string, string> = {
  card: '카드',
  cash: '현금',
  transfer: '이체',
  membership: '멤버십',
};

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
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [date, setDate] = useState(todayStr());
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [transitions, setTransitions] = useState<StatusTransition[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [pkgPayments, setPkgPayments] = useState<PackagePaymentRow[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterTab>('all');
  const [sort, setSort] = useState<SortMode>('queue');
  const [showNoshow, setShowNoshow] = useState(false);

  // Load clinic
  useEffect(() => {
    getClinic().then(setClinic).catch(() => setClinic(null));
  }, []);

  // Fetch data when clinic or date changes
  const fetchData = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { start, end } = dayBounds(date);

    const [ciRes, trRes, payRes, pkgPayRes, resvRes] = await Promise.all([
      supabase
        .from('check_ins')
        .select('*')
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
        .select('id, check_in_id, customer_id, amount, method, payment_type, memo, created_at')
        .eq('clinic_id', clinic.id)
        .gte('created_at', start)
        .lte('created_at', end),
      supabase
        .from('package_payments')
        .select('id, package_id, customer_id, amount, method, payment_type, memo, created_at')
        .eq('clinic_id', clinic.id)
        .gte('created_at', start)
        .lte('created_at', end),
      supabase
        .from('reservations')
        .select('*')
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
    const byVisit = { new: 0, returning: 0, experience: 0 };
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

    if (sort === 'time') {
      return [...list].sort(
        (a, b) => new Date(a.checked_in_at).getTime() - new Date(b.checked_in_at).getTime(),
      );
    }
    // queue sort (default) - already sorted from DB, but ensure
    return [...list].sort((a, b) => (a.queue_number ?? 0) - (b.queue_number ?? 0));
  }, [checkIns, filter, sort]);

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
    <div className="flex flex-col gap-6 p-6">
      {/* ---- Header: Date picker ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-bold">일일 이력</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={goPrev}>
            <ChevronLeft className="size-4" />
          </Button>
          <button
            onClick={goToday}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition"
          >
            <Calendar className="size-4 text-teal-600" />
            <span>{dateLabel}</span>
          </button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={goNext}
            disabled={isToday}
          >
            <ChevronRight className="size-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={goToday} className="text-teal-600">
              오늘
            </Button>
          )}
        </div>
      </div>

      {/* ---- Summary Cards (Row 1: 방문 통계) ---- */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">총 접수</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}<span className="text-sm font-normal text-muted-foreground ml-1">건</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">신규 / 재진 / 체험</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2 text-lg font-bold">
              <span className="text-teal-600">{summary.byVisit.new}</span>
              <span className="text-muted-foreground text-sm">/</span>
              <span className="text-emerald-600">{summary.byVisit.returning}</span>
              <span className="text-muted-foreground text-sm">/</span>
              <span className="text-amber-600">{summary.byVisit.experience}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">완료 / 취소</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2 text-lg font-bold">
              <span className="text-emerald-600">{summary.doneCount}</span>
              <span className="text-muted-foreground text-sm">/</span>
              <span className="text-red-500">{summary.cancelledCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="size-3" />
              평균 소요시간
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.avgMinutes !== null ? (
                elapsedLabel(summary.avgMinutes)
              ) : (
                <span className="text-muted-foreground text-sm font-normal">데이터 없음</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- Summary Cards (Row 2: 매출 + 운영 알림) ---- */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Banknote className="size-3" />
              일 매출
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {formatAmount(revenueSummary.netTotal)}
              <span className="text-sm font-normal text-muted-foreground ml-1">원</span>
            </div>
            {(revenueSummary.singleRefund > 0 || revenueSummary.pkgRefund > 0) && (
              <p className="text-xs text-red-500 mt-1">
                환불 -{formatAmount(revenueSummary.singleRefund + revenueSummary.pkgRefund)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <CreditCard className="size-3" />
              단건 / 패키지
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2 text-lg font-bold tabular-nums">
              <span className="text-teal-600">{formatAmount(revenueSummary.singleTotal)}</span>
              <span className="text-muted-foreground text-sm">/</span>
              <span className="text-emerald-600">{formatAmount(revenueSummary.pkgTotal)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className={summary.unpaidCount > 0 ? 'border-amber-300 bg-amber-50/50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <AlertCircle className="size-3" />
              미결제
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.unpaidCount > 0 ? 'text-amber-600' : ''}`}>
              {summary.unpaidCount}
              <span className="text-sm font-normal text-muted-foreground ml-1">건</span>
            </div>
          </CardContent>
        </Card>

        <Card className={summary.noshowCount > 0 ? 'border-red-300 bg-red-50/50' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <UserX className="size-3" />
              추정 노쇼
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.noshowCount > 0 ? 'text-red-500' : ''}`}>
              {summary.noshowCount}
              <span className="text-sm font-normal text-muted-foreground ml-1">건</span>
            </div>
            {summary.noshowCount > 0 && (
              <button
                onClick={() => setShowNoshow((v) => !v)}
                className="text-xs text-red-500 underline mt-1 hover:text-red-700"
              >
                {showNoshow ? '닫기' : '상세 보기'}
              </button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- 추정 노쇼 목록 (토글) ---- */}
      {showNoshow && unmatchedReservations.length > 0 && (
        <Card className="border-red-200 bg-red-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-red-600">
              <UserX className="size-4" />
              미체크인 예약 (추정 노쇼) — {unmatchedReservations.length}건
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">예약 시간</th>
                    <th className="pb-2 font-medium">고객명</th>
                    <th className="pb-2 font-medium">연락처</th>
                    <th className="pb-2 font-medium">방문 유형</th>
                    <th className="pb-2 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedReservations
                    .sort((a, b) => a.reservation_time.localeCompare(b.reservation_time))
                    .map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 tabular-nums">{r.reservation_time?.slice(0, 5)}</td>
                        <td className="py-2 font-medium">{r.customer_name ?? '—'}</td>
                        <td className="py-2 text-muted-foreground">{r.customer_phone ?? '—'}</td>
                        <td className="py-2">
                          <Badge className={VISIT_TYPE_COLOR[r.visit_type]}>
                            {VISIT_TYPE_KO[r.visit_type]}
                          </Badge>
                        </td>
                        <td className="py-2">
                          <Badge className={r.status === 'noshow' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}>
                            {r.status === 'noshow' ? '노쇼' : r.status === 'confirmed' ? '미내원' : r.status}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
          <TabsList>
            <TabsTrigger value="all">
              <Filter className="mr-1 size-3" />
              전체 ({summary.total})
            </TabsTrigger>
            <TabsTrigger value="in_progress">
              진행중 ({summary.total - summary.doneCount - summary.cancelledCount})
            </TabsTrigger>
            <TabsTrigger value="done">
              완료 ({summary.doneCount})
            </TabsTrigger>
            <TabsTrigger value="cancelled">
              취소 ({summary.cancelledCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button variant="outline" size="sm" onClick={toggleSort}>
          <ArrowUpDown className="mr-1 size-3" />
          {sort === 'queue' ? '대기번호순' : '접수시간순'}
        </Button>
      </div>

      {/* ---- Timeline List ---- */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          데이터 로딩 중...
        </div>
      ) : filteredCheckIns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
          <User className="mb-2 size-8 text-muted-foreground/40" />
          해당 조건의 접수 내역이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredCheckIns.map((ci) => {
            const expanded = expandedIds.has(ci.id);
            const ciTransitions = transitionMap.get(ci.id) ?? [];
            const elapsed = minutesBetween(ci.checked_in_at, ci.completed_at);

            return (
              <Card key={ci.id} className="overflow-hidden">
                {/* Main row */}
                <button
                  onClick={() => toggleExpand(ci.id)}
                  className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/50 transition"
                >
                  {/* Expand indicator */}
                  <span className="shrink-0 text-muted-foreground">
                    {expanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRightIcon className="size-4" />
                    )}
                  </span>

                  {/* Queue number */}
                  <span className="shrink-0 flex size-8 items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-700">
                    {ci.queue_number ?? '-'}
                  </span>

                  {/* Name + visit type */}
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate font-medium">{ci.customer_name}</span>
                    <Badge className={VISIT_TYPE_COLOR[ci.visit_type]}>
                      {VISIT_TYPE_KO[ci.visit_type]}
                    </Badge>
                  </div>

                  {/* Status badge */}
                  <Badge className={STATUS_COLOR[ci.status]}>
                    {STATUS_KO[ci.status]}
                  </Badge>

                  {/* Times */}
                  <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground sm:flex">
                    <span className="flex items-center gap-1">
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
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                        {elapsedLabel(elapsed)}
                      </span>
                    )}
                  </div>
                </button>

                {/* Mobile time row */}
                <div className="flex items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground sm:hidden">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    접수 {formatTime(ci.checked_in_at)}
                  </span>
                  {ci.completed_at && (
                    <span>완료 {formatTime(ci.completed_at)}</span>
                  )}
                  {elapsed !== null && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                      {elapsedLabel(elapsed)}
                    </span>
                  )}
                </div>

                {/* Expanded: Status transitions + Payment details */}
                {expanded && (
                  <div className="border-t bg-muted/30 px-4 py-3">
                    {/* Status transitions */}
                    {ciTransitions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">상태 전환 기록이 없습니다.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">상태 전환 이력</p>
                        <div className="flex flex-wrap items-center gap-1 text-xs">
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
                                    <Badge className={`${STATUS_COLOR[t.from_status]} text-[10px] px-1.5 py-0`}>
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
                                <Badge className={`${STATUS_COLOR[t.to_status]} text-[10px] px-1.5 py-0`}>
                                  {STATUS_KO[t.to_status]}
                                </Badge>
                              </span>
                            );
                          })}
                        </div>

                        {/* Transition detail table */}
                        <div className="mt-3 overflow-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b text-left text-[10px] text-muted-foreground">
                                <th className="pb-1.5 font-medium">시각</th>
                                <th className="pb-1.5 font-medium">변경 전</th>
                                <th className="pb-1.5 font-medium">변경 후</th>
                                <th className="pb-1.5 font-medium text-right">소요</th>
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
                                    <td className="py-1.5 tabular-nums text-muted-foreground">
                                      {formatTime(t.transitioned_at)}
                                    </td>
                                    <td className="py-1.5">
                                      <Badge className={`${STATUS_COLOR[t.from_status]} text-[10px] px-1.5 py-0`}>
                                        {STATUS_KO[t.from_status]}
                                      </Badge>
                                    </td>
                                    <td className="py-1.5">
                                      <Badge className={`${STATUS_COLOR[t.to_status]} text-[10px] px-1.5 py-0`}>
                                        {STATUS_KO[t.to_status]}
                                      </Badge>
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums">
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
                            <div className="mt-3 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                              <AlertCircle className="size-3.5" />
                              <span>결제 기록 없음 (미결제)</span>
                            </div>
                          );
                        }
                        if (ci.package_id) {
                          return (
                            <div className="mt-3 flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-700">
                              <CreditCard className="size-3.5" />
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
                        <div className="mt-3">
                          <p className="mb-2 text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <CreditCard className="size-3" />
                            결제 내역
                            <span className="ml-auto font-bold tabular-nums">
                              합계 {formatAmount(payTotal)}원
                            </span>
                          </p>
                          <div className="overflow-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b text-left text-[10px] text-muted-foreground">
                                  <th className="pb-1.5 font-medium">시각</th>
                                  <th className="pb-1.5 font-medium">방식</th>
                                  <th className="pb-1.5 font-medium">유형</th>
                                  <th className="pb-1.5 font-medium text-right">금액</th>
                                  <th className="pb-1.5 font-medium">메모</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ciPayments.map((p) => (
                                  <tr key={p.id} className="border-b last:border-0">
                                    <td className="py-1.5 tabular-nums text-muted-foreground">
                                      {formatTime(p.created_at)}
                                    </td>
                                    <td className="py-1.5">{METHOD_KO[p.method] ?? p.method}</td>
                                    <td className="py-1.5">
                                      <Badge
                                        className={
                                          p.payment_type === 'refund'
                                            ? 'bg-red-100 text-red-600 text-[10px] px-1.5 py-0'
                                            : 'bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0'
                                        }
                                      >
                                        {p.payment_type === 'refund' ? '환불' : '결제'}
                                      </Badge>
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums font-medium">
                                      {p.payment_type === 'refund' ? '-' : ''}
                                      {formatAmount(p.amount)}
                                    </td>
                                    <td className="py-1.5 text-muted-foreground truncate max-w-[120px]">
                                      {p.memo || '—'}
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
    </div>
  );
}
