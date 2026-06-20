// TreatmentStatusPanel.tsx — 당일 치료 환자 데이터테이블 (구 TreatmentTable 본문, 보존)
// T-20260502-foot-DAILY-TREATMENT-TABLE
// 원장뷰(처방·차팅) / 실장뷰(패키지·결제·다음예약) / 치료사뷰 + 날짜 범위 선택
//
// T-20260620-foot-TREATTABLE-2SECTION-REVAMP: 치료테이블 메뉴가 2탭(진료 환자 이력 / 균·피검사 대상자)으로
//   재편되며, 이 4뷰 치료현황 패널은 페이지에서 분리·보존(데이터 손실 0, 재노출 가능). 현재 라우트 미연결.
//   STAFFFILTER/STAFF-SOURCE-FIX 등 기존 deployed 로직 무변경 보존.

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
import { formatAmount, chartNoBadge, chartNoDisplay } from '@/lib/format';
// T-20260616-foot-PKG-OUTSTANDING-BALANCE ②: 대기열 '잔금 O원' 뱃지
import { loadCustomerOutstanding, type CustomerOutstanding } from '@/lib/footBilling';
import { PkgOutstandingBadge } from '@/components/PkgOutstandingBadge';
// T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX (AC-2): 처방 요약을 '약물명 1/3/2' 단일 토큰 경로로 수렴.
import { formatRxConfirmedSummary, normalizeRxItem } from '@/lib/rxTooltip';
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
  // T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX (AC-2): 구 '{medication_name} {dosage}' raw text →
  //   SSOT 토큰 경로(normalizeRxItem→formatRxConfirmedSummary)로 '약물명 1/3/2 *' 통일.
  //   빠른처방/정식/묶음처방 흡수분 shape 모두 normalizeRxItem 으로 흡수. 상위 3건만 미리보기.
  const out = formatRxConfirmedSummary(items.slice(0, 3).map(normalizeRxItem)).trim();
  return out || '—';
}

/* ─── 컴포넌트 ─────────────────────────────────────────────────── */

export default function TreatmentStatusPanel() {
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
  // T-20260612-foot-CHARTNO-B2-P1: customer_id → chart_number 맵(환자명 옆 차트번호 인접 표기). read-only.
  const [chartMap, setChartMap] = useState<Map<string, string>>(new Map());
  // T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX:
  //   담당 실장 = customers.assigned_staff_id (2번차트 1구역 '담당자', T-20260508-foot-C2-STAFF-DROPDOWN 확정).
  //     기존 check_ins.consultant_id(접수 컨설턴트) → 담당자 필드로 표시 소스 교체(check_ins 컬럼 보존).
  const [assignedStaffMap, setAssignedStaffMap] = useState<Map<string, string>>(new Map());
  //   담당 치료사 = 금일(session_date) package_sessions.performed_by WHERE status='used' (실제 차감 치료사).
  //     지정치료사(designated_therapist_id) 미사용. 날짜범위 뷰 대응 위해 key="customer_id|yyyy-MM-dd".
  const [deductTherapistMap, setDeductTherapistMap] = useState<Map<string, string>>(new Map());
  // T-20260616-foot-PKG-OUTSTANDING-BALANCE ②: customer_id → 패키지/진료비 미수금
  const [outstandingMap, setOutstandingMap] = useState<Map<string, CustomerOutstanding>>(new Map());
  const [dutyDoctors, setDutyDoctors] = useState<DutyDoctor[]>([]);
  const [loading, setLoading] = useState(false);

  /* ── 데이터 로드 ───────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { start, end } = dayBoundsRange(dateFrom, dateTo);

    // T-20260522-foot-PERF-TUNING OPT-6: check_ins + staff + duty_roster 병렬 실행
    // (이전: check_ins → staff(순차) → packages(순차) → payments(순차) → reservations(순차) → duty_roster(순차))
    const [{ data: ciData }, { data: staffData }, { data: dutyData }] = await Promise.all([
      supabase.from('check_ins').select('*').eq('clinic_id', clinic.id)
        .gte('checked_in_at', start).lte('checked_in_at', end)
        .order('checked_in_at', { ascending: true }),
      supabase.from('staff').select('*').eq('clinic_id', clinic.id).eq('active', true).order('name'),
      supabase.from('duty_roster').select('date, doctor_id, staff:doctor_id(name)')
        .eq('clinic_id', clinic.id).gte('date', dateFrom).lte('date', dateTo).order('date'),
    ]);

    const ciRows = (ciData ?? []) as CheckIn[];
    setCheckIns(ciRows);
    setStaffList((staffData ?? []) as Staff[]);
    setDutyDoctors(
      (dutyData ?? []).map((d: Record<string, unknown>) => ({
        date: d.date as string,
        doctor_id: d.doctor_id as string,
        staff: d.staff as { name: string } | undefined,
      })),
    );

    // check_ins 의존 쿼리: packages + payments + 다음 예약 병렬 실행
    const pkgIds  = [...new Set(ciRows.map((c) => c.package_id).filter(Boolean))] as string[];
    const ciIds   = ciRows.map((c) => c.id);
    const custIds = [...new Set(ciRows.map((c) => c.customer_id).filter(Boolean))] as string[];

    const [pkgRes, payRes, resvRes, chartRes, deductRes] = await Promise.all([
      pkgIds.length > 0
        ? supabase.from('packages').select('id, package_name, package_type, total_sessions, total_amount').in('id', pkgIds)
        : Promise.resolve({ data: [] as PackageInfo[] }),
      ciIds.length > 0
        ? supabase.from('payments').select('check_in_id, amount, method, payment_type').in('check_in_id', ciIds)
        : Promise.resolve({ data: [] as { check_in_id: string; amount: number; method: string; payment_type: string }[] }),
      custIds.length > 0
        ? supabase.from('reservations').select('customer_id, reservation_date, reservation_time')
            .eq('clinic_id', clinic.id).in('customer_id', custIds)
            .gt('reservation_date', today).in('status', ['confirmed', 'checked_in'])
            .order('reservation_date', { ascending: true })
        : Promise.resolve({ data: [] as NextReservation[] }),
      // T-20260612-foot-CHARTNO-B2-P1: 환자명 옆 차트번호 인접 표기용(read-only, DB 무변경).
      // T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX: assigned_staff_id(담당 실장 소스) 동반 조회(기존 쿼리 재사용).
      custIds.length > 0
        ? supabase.from('customers').select('id, chart_number, assigned_staff_id').in('id', custIds)
        : Promise.resolve({ data: [] as { id: string; chart_number: string | null; assigned_staff_id: string | null }[] }),
      // T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX: 담당 치료사 = 금일 차감 치료사.
      //   package_sessions(status='used') → performed_by, session_date 기준. clinic_id는 packages에 존재(packages!inner).
      //   AC-6: session_date 를 현재 뷰의 날짜범위(dateFrom~dateTo)로 제한(전체 차감이력 조회 금지). custId 교집합.
      custIds.length > 0
        ? supabase.from('package_sessions')
            .select('customer_id, performed_by, session_date, packages!inner(clinic_id)')
            .eq('packages.clinic_id', clinic.id)
            .eq('status', 'used')
            .not('performed_by', 'is', null)
            .in('customer_id', custIds)
            .gte('session_date', dateFrom)
            .lte('session_date', dateTo)
        : Promise.resolve({ data: [] as { customer_id: string | null; performed_by: string | null; session_date: string }[] }),
    ]);

    setPackages((pkgRes.data ?? []) as PackageInfo[]);

    const pmap = new Map<string, PaymentSummary>();
    for (const p of (payRes.data ?? []) as {
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
    setPaymentMap(ciIds.length > 0 ? pmap : new Map());

    const rmap = new Map<string, NextReservation>();
    for (const r of (resvRes.data ?? []) as NextReservation[]) {
      if (r.customer_id && !rmap.has(r.customer_id)) rmap.set(r.customer_id, r);
    }
    setNextResvMap(custIds.length > 0 ? rmap : new Map());

    // T-20260612-foot-CHARTNO-B2-P1: customer_id → chart_number 맵 구성(미발번은 미수록 → 렌더 시 '#미발번').
    // T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX: 동일 customers 행에서 assigned_staff_id(담당 실장) 맵 동시 구성.
    const cmap = new Map<string, string>();
    const amap = new Map<string, string>();
    for (const c of (chartRes.data ?? []) as { id: string; chart_number: string | null; assigned_staff_id: string | null }[]) {
      if (c.id && c.chart_number) cmap.set(c.id, c.chart_number);
      if (c.id && c.assigned_staff_id) amap.set(c.id, c.assigned_staff_id);
    }
    setChartMap(custIds.length > 0 ? cmap : new Map());
    setAssignedStaffMap(custIds.length > 0 ? amap : new Map());

    // T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX: 담당 치료사 = 금일 차감 치료사.
    //   key="customer_id|session_date" → performed_by. 같은 고객·같은 날 2회 이상 차감 시 가장 마지막 행 사용.
    const dmap = new Map<string, string>();
    for (const s of (deductRes.data ?? []) as { customer_id: string | null; performed_by: string | null; session_date: string }[]) {
      if (s.customer_id && s.performed_by && s.session_date) {
        dmap.set(`${s.customer_id}|${s.session_date}`, s.performed_by);
      }
    }
    setDeductTherapistMap(custIds.length > 0 ? dmap : new Map());

    // T-20260616-foot-PKG-OUTSTANDING-BALANCE ②: 활성 패키지 미수금 일괄 조회(카드별 N+1 방지).
    setOutstandingMap(custIds.length > 0 ? await loadCustomerOutstanding(custIds, clinic.id) : new Map());

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

  // T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX: 담당 실장/치료사 소스 리졸버(필터·렌더·CSV 공용 단일 경로).
  //   담당 실장 = customers.assigned_staff_id, 담당 치료사 = 당일(접수일) package_sessions 차감 performed_by.
  const consultantIdOf = useCallback(
    (ci: CheckIn): string | null => (ci.customer_id ? assignedStaffMap.get(ci.customer_id) ?? null : null),
    [assignedStaffMap],
  );
  const therapistIdOf = useCallback(
    (ci: CheckIn): string | null => {
      if (!ci.customer_id) return null;
      const d = format(new Date(ci.checked_in_at), 'yyyy-MM-dd');
      return deductTherapistMap.get(`${ci.customer_id}|${d}`) ?? null;
    },
    [deductTherapistMap],
  );

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

  // T-20260613-foot-TREATMENTTABLE-STAFFFILTER-DIRECTORONLY:
  // duty_roster가 출퇴근 import로 금일 출근 전 직원으로 확장되며 '당직 원장:' 배너가
  // 비-원장(상담실장·치료사 등)까지 노출하는 문제 차단. 배너/안내 표시 직전 staffMap의
  // role==='director' 만 필터(표시 레벨, duty_roster·staff 쿼리 무변경).
  const dutyDirectors = useMemo(
    () => dutyDoctors.filter((d) => staffMap.get(d.doctor_id)?.role === 'director'),
    [dutyDoctors, staffMap],
  );

  /* ── 필터 적용 ───────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    let list = checkIns;

    /* 뷰 프리셋별 기본 필터 */
    if (view === 'doctor') {
      // 원장뷰: 초진 환자 (진찰실을 거치는 환자) 우선 표시
      list = list.filter((c) => c.visit_type === 'new');
    }

    /* 담당 치료사 필터 — 금일 차감 치료사(package_sessions.performed_by) 기준 (T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX) */
    if (filterTherapistId !== 'all') {
      list = list.filter((c) => therapistIdOf(c) === filterTherapistId);
    }

    /* 담당 실장 필터 — customers.assigned_staff_id 기준 (T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX) */
    if (filterConsultantId !== 'all') {
      list = list.filter((c) => consultantIdOf(c) === filterConsultantId);
    }

    return list;
  }, [checkIns, view, filterTherapistId, filterConsultantId, therapistIdOf, consultantIdOf]);

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
        // T-20260612-foot-CHARTNO-B2-P1: 내보내기에도 차트번호 동반(미발번이면 '(미발번)').
        차트번호: chartNoDisplay(c.customer_id ? (chartMap.get(c.customer_id) ?? null) : null),
        방문유형: VISIT_TYPE_KO[c.visit_type],
        상태: STATUS_KO[c.status],
        // T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX: 화면과 동일 소스(담당자/당일 차감 치료사).
        담당실장: (() => { const id = consultantIdOf(c); return id ? (staffMap.get(id)?.name ?? '') : ''; })(),
        담당치료사: (() => { const id = therapistIdOf(c); return id ? (staffMap.get(id)?.name ?? '') : ''; })(),
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
    <div className="h-full overflow-auto flex flex-col gap-5 p-6">
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

      {/* 당직 원장 배너 — role=director 만 노출 (T-20260613-foot-TREATMENTTABLE-STAFFFILTER-DIRECTORONLY) */}
      {dutyDirectors.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-muted-foreground text-xs font-medium">당직 원장:</span>
          {dutyDirectors.map((d, i) => (
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
              {dutyDirectors.length > 0 && (
                <span className="ml-1 font-medium">
                  · 당직: {dutyDirectors.map((d) => d.staff?.name ?? '원장').join(', ')}
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
                // T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX: 담당 실장=assigned_staff_id, 담당 치료사=당일 차감 performed_by.
                const consultantId = consultantIdOf(ci);
                const therapistId = therapistIdOf(ci);
                const consultant = consultantId ? staffMap.get(consultantId) : undefined;
                const therapist = therapistId ? staffMap.get(therapistId) : undefined;

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

                    {/* 환자명 — T-20260612-foot-CHARTNO-B2-P1: 차트번호 인접 표기(동명이인 오인 방지). 미발번도 '#미발번' 명시. */}
                    <td className="px-4 py-3 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {ci.priority_flag && (
                          <span className="rounded bg-red-100 px-1 py-0 text-[10px] font-bold text-red-600">
                            {ci.priority_flag}
                          </span>
                        )}
                        <span>{ci.customer_name}</span>
                        <span className="font-mono text-[11px] font-normal text-muted-foreground/70" data-testid="treatment-chartno">
                          {chartNoBadge(ci.customer_id ? (chartMap.get(ci.customer_id) ?? null) : null)}
                        </span>
                        {/* T-20260616-foot-PKG-OUTSTANDING-BALANCE ②: 활성 패키지 잔금 뱃지(잔금>0만) */}
                        <PkgOutstandingBadge data={ci.customer_id ? outstandingMap.get(ci.customer_id) : undefined} />
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
