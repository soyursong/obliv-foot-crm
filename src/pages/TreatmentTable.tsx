// TreatmentTable.tsx — 당일 치료 환자 데이터테이블
// T-20260502-foot-DAILY-TREATMENT-TABLE
// 원장뷰(처방·차팅) / 실장뷰(패키지·결제·다음예약) / 치료사뷰 + 날짜 범위 선택

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Users,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Stethoscope,
  Download,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatAmount } from '@/lib/format';
import type { CheckIn, Staff } from '@/lib/types';
import {
  STATUS_KO,
  VISIT_TYPE_KO,
  STATUS_COLOR,
  VISIT_TYPE_COLOR,
} from '@/lib/status';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/* ─── 타입 ──────────────────────────────────────────────────────── */

type ViewPreset = 'all' | 'doctor' | 'consultant' | 'therapist';

interface PaymentSummary {
  check_in_id: string;
  total: number;
  methods: string[];
}

interface PackageInfo {
  id: string;
  package_name: string;
  package_type: string;
  total_sessions: number;
  total_amount: number;
}

interface NextReservation {
  customer_id: string;
  reservation_date: string;
  reservation_time: string;
}

interface DutyDoctor {
  date: string;
  doctor_id: string;
  staff?: { name: string };
}

/* ─── 헬퍼 ──────────────────────────────────────────────────────── */

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

function dayBoundsRange(from: string, to: string) {
  return {
    start: `${from}T00:00:00+09:00`,
    end: `${to}T23:59:59+09:00`,
  };
}

function formatDateKo(dateStr: string) {
  return format(new Date(dateStr), 'M월 d일 (EEEE)', { locale: ko });
}

function prescriptionSummary(items: unknown): string {
  if (!items || !Array.isArray(items) || items.length === 0) return '—';
  return items
    .slice(0, 3)
    .map((it: Record<string, unknown>) =>
      [it.medication_name, it.dosage].filter(Boolean).join(' '),
    )
    .join(', ');
}

/* ─── 컴포넌트 ─────────────────────────────────────────────────── */

export default function TreatmentTable() {
  const clinic = useClinic();
  const today = todayStr();

  /* 날짜 범위 */
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  /* 뷰 프리셋 */
  const [view, setView] = useState<ViewPreset>('all');

  /* 담당자 필터 */
  const [filterConsultantId, setFilterConsultantId] = useState<string>('all');
  const [filterTherapistId, setFilterTherapistId] = useState<string>('all');

  /* 데이터 */
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [paymentMap, setPaymentMap] = useState<Map<string, PaymentSummary>>(new Map());
  const [nextResvMap, setNextResvMap] = useState<Map<string, NextReservation>>(new Map());
  const [dutyDoctors, setDutyDoctors] = useState<DutyDoctor[]>([]);
  const [loading, setLoading] = useState(false);

  /* ── 데이터 로드 ───────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { start, end } = dayBoundsRange(dateFrom, dateTo);

    /* check_ins */
    const { data: ciData } = await supabase
      .from('check_ins')
      .select('*')
      .eq('clinic_id', clinic.id)
      .gte('checked_in_at', start)
      .lte('checked_in_at', end)
      .order('checked_in_at', { ascending: true });

    const ciRows = (ciData ?? []) as CheckIn[];
    setCheckIns(ciRows);

    /* staff */
    const { data: staffData } = await supabase
      .from('staff')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('active', true)
      .order('name');
    setStaffList((staffData ?? []) as Staff[]);

    /* packages (check_ins 중 package_id 있는 것만) */
    const pkgIds = [...new Set(ciRows.map((c) => c.package_id).filter(Boolean))] as string[];
    if (pkgIds.length > 0) {
      const { data: pkgData } = await supabase
        .from('packages')
        .select('id, package_name, package_type, total_sessions, total_amount')
        .in('id', pkgIds);
      setPackages((pkgData ?? []) as PackageInfo[]);
    } else {
      setPackages([]);
    }

    /* payments — check_in_id 기준 합산 */
    const ciIds = ciRows.map((c) => c.id);
    if (ciIds.length > 0) {
      const { data: payData } = await supabase
        .from('payments')
        .select('check_in_id, amount, method, payment_type')
        .in('check_in_id', ciIds);

      const pmap = new Map<string, PaymentSummary>();
      for (const p of (payData ?? []) as {
        check_in_id: string;
        amount: number;
        method: string;
        payment_type: string;
      }[]) {
        if (!p.check_in_id) continue;
        const prev = pmap.get(p.check_in_id) ?? { check_in_id: p.check_in_id, total: 0, methods: [] };
        prev.total += p.payment_type === 'refund' ? -p.amount : p.amount;
        if (!prev.methods.includes(p.method)) prev.methods.push(p.method);
        pmap.set(p.check_in_id, prev);
      }
      setPaymentMap(pmap);
    } else {
      setPaymentMap(new Map());
    }

    /* 다음 예약 — customer_id 기준 (오늘 이후 첫 예약) */
    const custIds = [...new Set(ciRows.map((c) => c.customer_id).filter(Boolean))] as string[];
    if (custIds.length > 0) {
      const { data: resvData } = await supabase
        .from('reservations')
        .select('customer_id, reservation_date, reservation_time')
        .eq('clinic_id', clinic.id)
        .in('customer_id', custIds)
        .gt('reservation_date', today)
        .in('status', ['confirmed', 'checked_in'])
        .order('reservation_date', { ascending: true });

      const rmap = new Map<string, NextReservation>();
      for (const r of (resvData ?? []) as NextReservation[]) {
        if (r.customer_id && !rmap.has(r.customer_id)) {
          rmap.set(r.customer_id, r);
        }
      }
      setNextResvMap(rmap);
    } else {
      setNextResvMap(new Map());
    }

    /* 당직 원장 (duty_roster) */
    const { data: dutyData } = await supabase
      .from('duty_roster')
      .select('date, doctor_id, staff:doctor_id(name)')
      .eq('clinic_id', clinic.id)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date');
    setDutyDoctors(
      (dutyData ?? []).map((d: Record<string, unknown>) => ({
        date: d.date as string,
        doctor_id: d.doctor_id as string,
        staff: d.staff as { name: string } | undefined,
      })),
    );

    setLoading(false);
  }, [clinic, dateFrom, dateTo, today]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── 보조 맵 ─────────────────────────────────────────────────── */
  const staffMap = useMemo(() => {
    const m = new Map<string, Staff>();
    for (const s of staffList) m.set(s.id, s);
    return m;
  }, [staffList]);

  const pkgMap = useMemo(() => {
    const m = new Map<string, PackageInfo>();
    for (const p of packages) m.set(p.id, p);
    return m;
  }, [packages]);

  const consultants = useMemo(
    () => staffList.filter((s) => s.role === 'consultant'),
    [staffList],
  );
  const therapists = useMemo(
    () => staffList.filter((s) => s.role === 'therapist'),
    [staffList],
  );
  const directors = useMemo(
    () => staffList.filter((s) => s.role === 'director'),
    [staffList],
  );

  /* ── 필터 적용 ───────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    let list = checkIns;

    /* 뷰 프리셋별 기본 필터 */
    if (view === 'doctor') {
      // 원장뷰: 초진 환자 (진찰실을 거치는 환자) 우선 표시
      list = list.filter((c) => c.visit_type === 'new' || c.visit_type === 'experience');
    }

    /* 담당 치료사 필터 */
    if (filterTherapistId !== 'all') {
      list = list.filter((c) => c.therapist_id === filterTherapistId);
    }

    /* 담당 실장 필터 */
    if (filterConsultantId !== 'all') {
      list = list.filter((c) => c.consultant_id === filterConsultantId);
    }

    return list;
  }, [checkIns, view, filterTherapistId, filterConsultantId]);

  /* ── 요약 통계 ───────────────────────────────────────────────── */
  const summary = useMemo(() => {
    const total = filtered.length;
    const done = filtered.filter((c) => c.status === 'done').length;
    const netRevenue = filtered.reduce((sum, c) => {
      const p = paymentMap.get(c.id);
      return sum + (p?.total ?? 0);
    }, 0);
    return { total, done, netRevenue };
  }, [filtered, paymentMap]);

  /* ── 날짜 네비게이션 ─────────────────────────────────────────── */
  function setToday() {
    setDateFrom(today);
    setDateTo(today);
  }
  function goPrevDay() {
    const d = format(subDays(new Date(dateFrom), 1), 'yyyy-MM-dd');
    setDateFrom(d);
    setDateTo(d);
  }
  function goNextDay() {
    const d = format(new Date(dateFrom + 'T12:00:00'), 'yyyy-MM-dd');
    const next = format(new Date(d).setDate(new Date(d).getDate() + 1), 'yyyy-MM-dd');
    if (next <= today) {
      setDateFrom(next);
      setDateTo(next);
    }
  }

  const isToday = dateFrom === today && dateTo === today;
  const dateLabel =
    dateFrom === dateTo
      ? formatDateKo(dateFrom)
      : `${format(new Date(dateFrom), 'M.d')} ~ ${format(new Date(dateTo), 'M.d')}`;

  /* ── CSV 내보내기 ────────────────────────────────────────────── */
  function exportCsv() {
    const METHOD_KO: Record<string, string> = {
      card: '카드', cash: '현금', transfer: '이체', membership: '멤버십',
    };

    const rows = filtered.map((c) => {
      const pkg = c.package_id ? pkgMap.get(c.package_id) : undefined;
      const pay = paymentMap.get(c.id);
      const nextResv = c.customer_id ? nextResvMap.get(c.customer_id) : undefined;
      return {
        접수시간: format(new Date(c.checked_in_at), 'HH:mm'),
        대기번호: c.queue_number ?? '',
        환자명: c.customer_name,
        방문유형: VISIT_TYPE_KO[c.visit_type],
        상태: STATUS_KO[c.status],
        담당실장: c.consultant_id ? (staffMap.get(c.consultant_id)?.name ?? '') : '',
        담당치료사: c.therapist_id ? (staffMap.get(c.therapist_id)?.name ?? '') : '',
        패키지: pkg?.package_name ?? '',
        결제금액: pay?.total ?? 0,
        결제수단: pay?.methods.map((m) => METHOD_KO[m] ?? m).join('+') ?? '',
        다음예약: nextResv
          ? `${nextResv.reservation_date} ${nextResv.reservation_time?.slice(0, 5)}`
          : '',
        차팅: (c.doctor_note ?? '').replace(/\n/g, ' '),
        처방: prescriptionSummary(c.prescription_items as unknown[]),
      };
    });

    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((r) =>
        headers.map((h) => `"${String(r[h as keyof typeof r]).replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `치료현황_${dateFrom}${dateFrom !== dateTo ? `~${dateTo}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── 렌더 ────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-5 p-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Stethoscope className="size-5 text-teal-600" />
          치료 현황 테이블
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 날짜 네비 */}
          <Button variant="outline" size="icon-sm" onClick={goPrevDay}>
            <ChevronLeft className="size-4" />
          </Button>
          <button
            onClick={setToday}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition"
          >
            <Calendar className="size-4 text-teal-600" />
            <span>{dateLabel}</span>
          </button>
          <Button variant="outline" size="icon-sm" onClick={goNextDay} disabled={isToday}>
            <ChevronRight className="size-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={setToday} className="text-teal-600">
              오늘
            </Button>
          )}

          {/* 날짜 범위 직접 입력 */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground border rounded-md px-2 py-1">
            <input
              type="date"
              value={dateFrom}
              max={today}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent outline-none text-xs w-28"
            />
            <span>~</span>
            <input
              type="date"
              value={dateTo}
              max={today}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent outline-none text-xs w-28"
            />
          </div>

          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`size-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="size-3.5 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {/* 당직 원장 배너 */}
      {dutyDoctors.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-muted-foreground text-xs font-medium">당직 원장:</span>
          {dutyDoctors.map((d, i) => (
            <Badge key={i} className="bg-blue-50 text-blue-700 border border-blue-200">
              {d.staff?.name ?? '원장'} {dateFrom !== dateTo && `(${format(new Date(d.date), 'M.d')})`}
            </Badge>
          ))}
        </div>
      )}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="size-3" />총 접수
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{summary.total}</span>
            <span className="text-sm text-muted-foreground ml-1">건</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="size-3" />완료
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold text-emerald-600">{summary.done}</span>
            <span className="text-sm text-muted-foreground ml-1">건</span>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="size-3" />단건 결제 합계
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold tabular-nums">{formatAmount(summary.netRevenue)}</span>
            <span className="text-sm text-muted-foreground ml-1">원</span>
          </CardContent>
        </Card>
      </div>

      {/* 뷰 프리셋 + 담당자 필터 */}
      <div className="flex flex-col gap-3">
        {/* 뷰 탭 */}
        <Tabs value={view} onValueChange={(v) => setView(v as ViewPreset)}>
          <TabsList>
            <TabsTrigger value="all">전체 뷰</TabsTrigger>
            <TabsTrigger value="doctor">
              <Stethoscope className="size-3 mr-1" />
              원장 뷰
            </TabsTrigger>
            <TabsTrigger value="consultant">실장 뷰</TabsTrigger>
            <TabsTrigger value="therapist">치료사 뷰</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* 담당자 필터 */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* 담당 실장 필터 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">상담실장:</span>
            <Select value={filterConsultantId} onValueChange={setFilterConsultantId}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {consultants.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
                {consultants.length === 0 && (
                  <SelectItem value="_none">
                    등록된 실장 없음
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* 담당 치료사 필터 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">치료사:</span>
            <Select value={filterTherapistId} onValueChange={setFilterTherapistId}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {therapists.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
                {therapists.length === 0 && (
                  <SelectItem value="_none">
                    등록된 치료사 없음
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* 원장뷰 안내 */}
          {view === 'doctor' && directors.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-2.5 py-1">
              <Stethoscope className="size-3" />
              초진·체험 환자만 표시 (진찰실 경유)
              {dutyDoctors.length > 0 && (
                <span className="ml-1 font-medium">
                  · 당직: {dutyDoctors.map((d) => d.staff?.name ?? '원장').join(', ')}
                </span>
              )}
            </div>
          )}

          {/* 필터 초기화 */}
          {(filterConsultantId !== 'all' || filterTherapistId !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground h-8"
              onClick={() => {
                setFilterConsultantId('all');
                setFilterTherapistId('all');
              }}
            >
              필터 초기화
            </Button>
          )}
        </div>
      </div>

      {/* 데이터 테이블 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <RefreshCw className="size-4 mr-2 animate-spin" />
          데이터 로딩 중...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
          <Users className="size-8 opacity-30" />
          <p>해당 조건의 데이터가 없습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  #
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  접수
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  환자
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  방문
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                  상태
                </th>

                {/* 원장 뷰 전용 컬럼 */}
                {view === 'doctor' && (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      처방
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground min-w-[160px]">
                      차팅
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      진료 확인
                    </th>
                  </>
                )}

                {/* 실장 뷰 전용 컬럼 */}
                {view === 'consultant' && (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      담당 실장
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      패키지
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      결제금액
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      다음 예약
                    </th>
                  </>
                )}

                {/* 치료사 뷰 전용 컬럼 */}
                {view === 'therapist' && (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      담당 치료사
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      관리 메모
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      처치 단계
                    </th>
                  </>
                )}

                {/* 전체 뷰 컬럼 */}
                {view === 'all' && (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      담당 실장
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      담당 치료사
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      패키지
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">
                      단건 결제
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ci, idx) => {
                const pkg = ci.package_id ? pkgMap.get(ci.package_id) : undefined;
                const pay = paymentMap.get(ci.id);
                const nextResv = ci.customer_id ? nextResvMap.get(ci.customer_id) : undefined;
                const consultant = ci.consultant_id ? staffMap.get(ci.consultant_id) : undefined;
                const therapist = ci.therapist_id ? staffMap.get(ci.therapist_id) : undefined;

                return (
                  <tr
                    key={ci.id}
                    className={`border-b last:border-0 transition-colors hover:bg-muted/30 ${
                      ci.status === 'done' ? 'opacity-70' : ''
                    }`}
                  >
                    {/* 번호 */}
                    <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">
                      {idx + 1}
                    </td>

                    {/* 접수시간 */}
                    <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(ci.checked_in_at), 'HH:mm')}
                    </td>

                    {/* 환자명 */}
                    <td className="px-4 py-3 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {ci.priority_flag && (
                          <span className="rounded bg-red-100 px-1 py-0 text-[10px] font-bold text-red-600">
                            {ci.priority_flag}
                          </span>
                        )}
                        {ci.customer_name}
                      </div>
                    </td>

                    {/* 방문유형 */}
                    <td className="px-4 py-3">
                      <Badge className={`${VISIT_TYPE_COLOR[ci.visit_type]} text-[11px] px-1.5 py-0`}>
                        {VISIT_TYPE_KO[ci.visit_type]}
                      </Badge>
                    </td>

                    {/* 상태 */}
                    <td className="px-4 py-3">
                      <Badge className={`${STATUS_COLOR[ci.status]} text-[11px] px-1.5 py-0`}>
                        {STATUS_KO[ci.status]}
                      </Badge>
                    </td>

                    {/* ── 원장 뷰 ── */}
                    {view === 'doctor' && (
                      <>
                        <td className="px-4 py-3 text-xs max-w-[180px]">
                          <span className="line-clamp-2 text-muted-foreground">
                            {prescriptionSummary(ci.prescription_items as unknown[])}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs max-w-[220px]">
                          <span className="line-clamp-3 text-muted-foreground whitespace-pre-line">
                            {ci.doctor_note || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5 text-[11px]">
                            <span className={ci.doctor_confirm_charting ? 'text-emerald-600' : 'text-gray-400'}>
                              {ci.doctor_confirm_charting ? '✓ 차팅' : '○ 차팅'}
                            </span>
                            <span className={ci.doctor_confirm_prescription ? 'text-emerald-600' : 'text-gray-400'}>
                              {ci.doctor_confirm_prescription ? '✓ 처방' : '○ 처방'}
                            </span>
                          </div>
                        </td>
                      </>
                    )}

                    {/* ── 실장 뷰 ── */}
                    {view === 'consultant' && (
                      <>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          {consultant ? (
                            <span className="font-medium">{consultant.name}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-[160px]">
                          {pkg ? (
                            <div>
                              <span className="font-medium text-teal-700">{pkg.package_name}</span>
                              <br />
                              <span className="text-muted-foreground text-[11px]">
                                {formatAmount(pkg.total_amount)}원 · {pkg.total_sessions}회
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">단건</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs whitespace-nowrap">
                          {pay && pay.total !== 0 ? (
                            <span className={pay.total < 0 ? 'text-red-500' : 'font-medium'}>
                              {pay.total < 0 && '-'}
                              {formatAmount(Math.abs(pay.total))}원
                            </span>
                          ) : ci.package_id ? (
                            <span className="text-teal-600 text-[11px]">회차 소진</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          {nextResv ? (
                            <div>
                              <span className="font-medium text-blue-600">
                                {format(new Date(nextResv.reservation_date), 'M.d')}
                              </span>
                              <span className="text-muted-foreground ml-1">
                                {nextResv.reservation_time?.slice(0, 5)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">미정</span>
                          )}
                        </td>
                      </>
                    )}

                    {/* ── 치료사 뷰 ── */}
                    {view === 'therapist' && (
                      <>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          {therapist ? (
                            <span className="font-medium">{therapist.name}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-[200px]">
                          <span className="line-clamp-2 text-muted-foreground whitespace-pre-line">
                            {(ci.treatment_memo as { details?: string } | null)?.details || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                            {ci.preconditioning_done && (
                              <span className="text-teal-600">✓ 사전처치</span>
                            )}
                            {ci.pododulle_done && (
                              <span className="text-emerald-600">✓ 포도둘</span>
                            )}
                            {ci.laser_minutes != null && (
                              <span className="text-blue-600">레이저 {ci.laser_minutes}분</span>
                            )}
                            {!ci.preconditioning_done && !ci.pododulle_done && ci.laser_minutes == null && '—'}
                          </div>
                        </td>
                      </>
                    )}

                    {/* ── 전체 뷰 ── */}
                    {view === 'all' && (
                      <>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          {consultant ? (
                            <span>{consultant.name}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          {therapist ? (
                            <span>{therapist.name}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-[140px]">
                          {pkg ? (
                            <span className="font-medium text-teal-700 truncate block">
                              {pkg.package_name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs whitespace-nowrap">
                          {pay && pay.total !== 0 ? (
                            <span className={pay.total < 0 ? 'text-red-500' : ''}>
                              {pay.total < 0 && '-'}
                              {formatAmount(Math.abs(pay.total))}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>

            {/* 집계 행 */}
            {view === 'consultant' && (
              <tfoot>
                <tr className="border-t bg-muted/40">
                  <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-right text-muted-foreground">
                    합계 ({filtered.length}건)
                  </td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-right text-xs font-bold tabular-nums">
                    {formatAmount(summary.netRevenue)}원
                  </td>
                  <td className="px-4 py-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* 뷰별 안내 */}
      <div className="text-xs text-muted-foreground mt-1">
        {view === 'doctor' && (
          <p>
            💡 원장 뷰: 초진·체험 환자만 표시합니다. 차팅·처방은 원장 확인 후 업데이트됩니다.
            진료원장 배정은 당직표 기준으로 표시됩니다.
          </p>
        )}
        {view === 'consultant' && (
          <p>
            💡 실장 뷰: 담당 실장별 환자 현황·패키지·결제금액·다음 예약을 확인합니다.
            "상담실장" 필터로 특정 실장 담당 환자만 볼 수 있습니다.
          </p>
        )}
        {view === 'therapist' && (
          <p>
            💡 치료사 뷰: 담당 치료사별 시술 처치 현황을 확인합니다.
            "치료사" 필터로 특정 치료사 담당 환자만 볼 수 있습니다.
          </p>
        )}
        {view === 'all' && (
          <p>
            💡 전체 뷰: 당일 접수 전체 현황입니다. 담당 실장·치료사 필터를 함께 사용하세요.
          </p>
        )}
      </div>
    </div>
  );
}
