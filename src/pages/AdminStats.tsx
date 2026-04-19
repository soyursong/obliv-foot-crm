import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, startOfMonth, endOfMonth, subDays, startOfDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import { getSelectedClinic } from '@/lib/clinic';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

// 번들 최적화: recharts를 포함하는 차트 탭을 lazy load하여 AdminStats 청크에서 분리
const DailyTrendsTab = lazy(() => import('@/components/stats/DailyTrendsTab'));
const MonthlyPerfTab = lazy(() => import('@/components/stats/MonthlyPerfTab'));

interface ResRow {
  id: string;
  reservation_date: string;
  reservation_time?: string | null;
  created_at: string | null;
  created_by: string | null;
  status: string;
  customer_id: string | null;
}

interface CIRow {
  id: string;
  customer_id: string | null;
  reservation_id: string | null;
  created_date: string | null;
  created_by: string | null;
  status: string | null;
}

export default function AdminStats() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [clinicId, setClinicId] = useState('');
  const [clinicName, setClinicName] = useState('');
  // 박민지 Wave3 #6: 기본값 당일
  const [from, setFrom] = useState<Date>(startOfDay(new Date()));
  const [to, setTo] = useState<Date>(startOfDay(new Date()));

  // 박민지 정의: 3개 지표 각자 다른 날짜 기준
  // (A) 예약등록건수 = 해당기간에 예약 추가한 수 (reservations.created_at 기준)
  // (B) 예약수 = 해당기간에 예약되어있는 수 (reservations.reservation_date 기준, 취소 제외)
  // (C) 내원수 = 해당기간에 내원한 수 (check_ins.created_date 기준)
  const [registeredRes, setRegisteredRes] = useState<ResRow[]>([]);
  const [scheduledRes, setScheduledRes] = useState<ResRow[]>([]);
  const [visitedCI, setVisitedCI] = useState<CIRow[]>([]);
  // 박민지 Wave3 #7: customer_id → customer.created_by (최초 등록자) 맵
  const [customerCreatorMap, setCustomerCreatorMap] = useState<Record<string, string>>({});
  // 박민지 Wave3 #8: customer_id → {name, phone} 맵 (팝업·엑셀용)
  const [customerInfoMap, setCustomerInfoMap] = useState<Record<string, { name: string; phone: string }>>({});
  const [kpiDetail, setKpiDetail] = useState<null | 'registered' | 'scheduled' | 'visited'>(null);
  const [loading, setLoading] = useState(false);

  // staffMap for showing names instead of emails
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  const [staffRoleMap, setStaffRoleMap] = useState<Record<string, string>>({});
  const [onlyTmRole, setOnlyTmRole] = useState(false); // T-W3-ADD-02

  // 박민지 추가요청 #3: "내 예약만" 필터
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      setCurrentUserEmail(session.user?.email ?? null);

      // T-STAT-05: admin/manager만 접근 허용
      const { data: profile } = await (supabase.from('user_profiles') as any)
        .select('role').eq('id', session.user.id).single();
      if (!profile || !['admin', 'manager'].includes(profile.role)) {
        toast({ title: '접근 권한 없음', description: '관리자/매니저만 접근 가능합니다', variant: 'destructive' });
        navigate('/admin/dashboard');
        return;
      }

      const clinic = await getSelectedClinic();
      if (clinic) { setClinicId(clinic.id); setClinicName(clinic.name); }

      const { data: staffData } = await (supabase.from('user_profiles') as any)
        .select('email, name, role').eq('active', true);
      if (staffData) {
        const map: Record<string, string> = {};
        const roles: Record<string, string> = {};
        // PARKJG-0416 잔여 #1: 정용현 TM 집계 제외 (현장 요청)
        const TM_EXCLUDE = new Set(['yh.jung@medibuilder.com']);
        (staffData as any[]).forEach((u) => {
          if (u.email && u.name) map[u.email] = u.name;
          if (u.email && u.role) {
            roles[u.email] = TM_EXCLUDE.has(u.email) && u.role === 'tm' ? 'staff' : u.role;
          }
        });
        setStaffMap(map);
        setStaffRoleMap(roles);
      }
    })();
  }, [navigate]);

  useEffect(() => {
    if (!clinicId) return;
    (async () => {
      setLoading(true);
      const fromStr = format(from, 'yyyy-MM-dd');
      const toStr = format(to, 'yyyy-MM-dd');

      // 최적화: A/B/C 3개 쿼리를 Promise.all로 병렬 실행
      const [aResult, bResult, cResult] = await Promise.all([
        // (A) 해당기간에 등록된 예약 (created_at 기준)
        (supabase.from('reservations')
          .select('id, reservation_date, reservation_time, created_at, created_by, status, customer_id')
          .eq('clinic_id', clinicId)
          .gte('created_at', `${fromStr}T00:00:00`)
          .lte('created_at', `${toStr}T23:59:59`) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
        // (B) 해당기간에 잡혀있는 예약 (reservation_date 기준, 취소 포함 — 박민지 정정)
        (supabase.from('reservations')
          .select('id, reservation_date, reservation_time, created_at, created_by, status, customer_id')
          .eq('clinic_id', clinicId)
          .gte('reservation_date', fromStr).lte('reservation_date', toStr) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
        // (C) 해당기간에 내원한 모든 체크인
        // 박민지 정의: 내원 = 실제로 내원한 건
        // - no_show는 "부도(체크인 안 한 것)"이므로 제외
        // - abandoned/consult_left는 "내원은 했으나 진료 안 받은 것"이므로 포함 (박민지 추가요청 4)
        ((supabase.from('check_ins') as any)
          .select('id, customer_id, reservation_id, created_date, created_by, status')
          .eq('clinic_id', clinicId)
          .neq('status', 'no_show')
          .gte('created_date', fromStr).lte('created_date', toStr) as unknown as Promise<any>).catch(() => ({ data: null, error: null })),
      ]);

      const aData = aResult.data;
      const bData = bResult.data;
      const cData = cResult.data;
      setRegisteredRes((aData || []) as ResRow[]);
      setScheduledRes((bData || []) as ResRow[]);
      setVisitedCI((cData || []) as CIRow[]);

      // (D) 박민지 Wave3 #7: 위 데이터의 customer_id -> customers.created_by 맵 구축
      const custIds = new Set<string>();
      (aData || []).forEach((r: any) => r.customer_id && custIds.add(r.customer_id));
      (bData || []).forEach((r: any) => r.customer_id && custIds.add(r.customer_id));
      (cData || []).forEach((r: any) => r.customer_id && custIds.add(r.customer_id));
      if (custIds.size > 0) {
        const { data: custData } = await (supabase.from('customers') as any)
          .select('id, name, phone, created_by').in('id', Array.from(custIds));
        const creatorMap: Record<string, string> = {};
        const infoMap: Record<string, { name: string; phone: string }> = {};
        (custData as any[] || []).forEach((c) => {
          if (c.created_by) creatorMap[c.id] = c.created_by;
          infoMap[c.id] = { name: c.name || '', phone: c.phone || '' };
        });
        setCustomerCreatorMap(creatorMap);
        setCustomerInfoMap(infoMap);
      } else {
        setCustomerCreatorMap({});
        setCustomerInfoMap({});
      }

      setLoading(false);
    })();
  }, [clinicId, from, to]);

  // "내 예약만" 필터: created_by가 이메일 or 이름 형태 둘 다 있으므로 양쪽 매칭
  const isMyRecord = useMemo(() => {
    if (!currentUserEmail) return (_: string | null) => false;
    const myName = staffMap[currentUserEmail];
    return (createdBy: string | null) => {
      if (!createdBy) return false;
      if (createdBy === currentUserEmail) return true;
      return !!myName && createdBy === myName;
    };
  }, [currentUserEmail, staffMap]);

  // 박민지 추가요청 #3: "내 예약만" 토글 적용을 위한 필터링된 데이터셋
  const filteredRegistered = useMemo(
    () => onlyMine && currentUserEmail
      ? registeredRes.filter(r => isMyRecord(r.created_by))
      : registeredRes,
    [registeredRes, onlyMine, currentUserEmail, isMyRecord]
  );
  const filteredScheduled = useMemo(
    () => onlyMine && currentUserEmail
      ? scheduledRes.filter(r => isMyRecord(r.created_by))
      : scheduledRes,
    [scheduledRes, onlyMine, currentUserEmail, isMyRecord]
  );
  // 박민지 Wave3 #7 정정 (2026-04-14): "최초 등록자 = 해당 예약의 최초 예약자"
  // → reservation.created_by 고정 (예약 수정해도 insert 시점 값 유지됨)
  // → 리터치 등 새 예약은 그 예약의 created_by로 분리 집계
  const tmOfRes = (r: ResRow) => r.created_by || '미지정';
  const tmOfCheckIn = (ci: CIRow, allResMap: Map<string, ResRow>) => {
    if (ci.reservation_id && allResMap.has(ci.reservation_id)) return allResMap.get(ci.reservation_id)!.created_by || ci.created_by || '미지정';
    return ci.created_by || '워크인';
  };

  const filteredVisited = useMemo(() => {
    if (!onlyMine || !currentUserEmail) return visitedCI;
    const allResMap = new Map<string, ResRow>();
    [...registeredRes, ...scheduledRes].forEach(r => allResMap.set(r.id, r));
    return visitedCI.filter(ci => isMyRecord(tmOfCheckIn(ci, allResMap)));
  }, [visitedCI, registeredRes, scheduledRes, onlyMine, currentUserEmail, isMyRecord]);

  // T-PARKJG-STATS-FILTER: TM팀만 필터를 KPI·합계·팝업에도 적용
  const tmFilteredRegistered = useMemo(() => {
    if (!onlyTmRole) return filteredRegistered;
    return filteredRegistered.filter(r => staffRoleMap[tmOfRes(r)] === 'tm');
  }, [filteredRegistered, onlyTmRole, staffRoleMap]);

  const tmFilteredScheduled = useMemo(() => {
    if (!onlyTmRole) return filteredScheduled;
    return filteredScheduled.filter(r => staffRoleMap[tmOfRes(r)] === 'tm');
  }, [filteredScheduled, onlyTmRole, staffRoleMap]);

  const tmFilteredVisited = useMemo(() => {
    if (!onlyTmRole) return filteredVisited;
    const allResMap = new Map<string, ResRow>();
    [...registeredRes, ...scheduledRes].forEach(r => allResMap.set(r.id, r));
    return filteredVisited.filter(ci => staffRoleMap[tmOfCheckIn(ci, allResMap)] === 'tm');
  }, [filteredVisited, registeredRes, scheduledRes, onlyTmRole, staffRoleMap]);

  const labelFor = (email: string) => {
    if (email === '미지정' || email === '워크인') return email;
    return staffMap[email] || email.split('@')[0];
  };

  // TM별 집계 — 이름 기준 합산으로 중복 해소 + 내원율 추가
  const tmStats = useMemo(() => {
    const map = new Map<string, { tm: string; registered: number; scheduled: number; visited: number }>();
    const ensure = (tm: string) => {
      if (!map.has(tm)) map.set(tm, { tm, registered: 0, scheduled: 0, visited: 0 });
      return map.get(tm)!;
    };

    filteredRegistered.forEach(r => ensure(tmOfRes(r)).registered += 1);
    filteredScheduled.forEach(r => ensure(tmOfRes(r)).scheduled += 1);

    const allResMap = new Map<string, ResRow>();
    [...registeredRes, ...scheduledRes].forEach(r => allResMap.set(r.id, r));

    filteredVisited.forEach(ci => ensure(tmOfCheckIn(ci, allResMap)).visited += 1);

    // T-W3-ADD-02: TM 직책 필터 (role='tm')
    const arr = Array.from(map.values());
    const filtered = onlyTmRole ? arr.filter(r => staffRoleMap[r.tm] === 'tm') : arr;

    // PARKJG-#1: TM팀만 토글 시, 활동 없는 TM도 0건으로 표시
    if (onlyTmRole) {
      Object.entries(staffRoleMap).forEach(([email, role]) => {
        if (role === 'tm' && !filtered.some(r => r.tm === email)) {
          filtered.push({ tm: email, registered: 0, scheduled: 0, visited: 0 });
        }
      });
    }

    // 이름 기준 합산: 같은 이름으로 표시되는 TM을 병합 (이메일/이름 중복 해소)
    const nameMap = new Map<string, { tm: string; registered: number; scheduled: number; visited: number; visitRate: number }>();
    filtered.forEach(r => {
      const displayName = labelFor(r.tm);
      if (nameMap.has(displayName)) {
        const existing = nameMap.get(displayName)!;
        existing.registered += r.registered;
        existing.scheduled += r.scheduled;
        existing.visited += r.visited;
      } else {
        nameMap.set(displayName, { tm: displayName, registered: r.registered, scheduled: r.scheduled, visited: r.visited, visitRate: 0 });
      }
    });
    // 내원율 계산
    nameMap.forEach(r => { r.visitRate = r.scheduled > 0 ? Math.round((r.visited / r.scheduled) * 1000) / 10 : 0; });

    return Array.from(nameMap.values()).sort((a, b) => (b.scheduled + b.visited) - (a.scheduled + a.visited));
  }, [filteredRegistered, filteredScheduled, filteredVisited, registeredRes, scheduledRes, onlyTmRole, staffRoleMap, staffMap]);

  const totals = useMemo(() => {
    const registered = tmFilteredRegistered.length;
    const scheduled = tmFilteredScheduled.length;
    const visited = tmFilteredVisited.length;
    // 박민지 추가요청 #5: 내원률 = 내원수 / 예약수 (소수 2자리 %)
    const visitRate = scheduled > 0 ? (visited / scheduled) * 100 : 0;
    return { registered, scheduled, visited, visitRate };
  }, [tmFilteredRegistered, tmFilteredScheduled, tmFilteredVisited]);

  const setPreset = (days: number) => {
    setTo(startOfDay(new Date()));
    setFrom(startOfDay(subDays(new Date(), days)));
  };

  // 박민지 Wave3 #8 + T-W3-06: KPI 팝업 행 데이터 (6개 컬럼 재조정)
  // 컬럼: 예약등록일 · 예약일 · 예약시간 · 내원일 · 고객명 · 핸드폰번호
  type DetailRow = { registeredDate: string; reservationDate: string; reservationTime: string; visitDate: string; name: string; phone: string; tm: string; status: string; groupKey: string };
  const detailRows = useMemo<DetailRow[]>(() => {
    if (!kpiDetail) return [];
    // reservation_id → check_in.created_date 매핑 (내원일 역조회)
    const resIdToVisit = new Map<string, string>();
    visitedCI.forEach(ci => { if (ci.reservation_id && ci.created_date) resIdToVisit.set(ci.reservation_id, ci.created_date); });
    const allResMap = new Map<string, ResRow>();
    [...registeredRes, ...scheduledRes].forEach(r => allResMap.set(r.id, r));

    const mapRes = (r: ResRow): DetailRow => {
      const info = (r.customer_id && customerInfoMap[r.customer_id]) || { name: '', phone: '' };
      const regDate = r.created_at ? String(r.created_at).slice(0, 10) : '';
      const resTime = r.reservation_time ? String(r.reservation_time).slice(0, 5) : '';
      const visit = resIdToVisit.get(r.id) || '';
      return {
        registeredDate: regDate,
        reservationDate: r.reservation_date || '',
        reservationTime: resTime,
        visitDate: visit,
        name: info.name, phone: info.phone,
        tm: labelFor(tmOfRes(r)),
        status: r.status || '',
        groupKey: kpiDetail === 'registered' ? regDate : r.reservation_date || '',
      };
    };
    const mapCI = (ci: CIRow): DetailRow => {
      const info = (ci.customer_id && customerInfoMap[ci.customer_id]) || { name: '', phone: '' };
      const matchedRes = ci.reservation_id ? allResMap.get(ci.reservation_id) : undefined;
      const regDate = matchedRes?.created_at ? String(matchedRes.created_at).slice(0, 10) : '';
      const resDate = matchedRes?.reservation_date || '';
      const resTime = matchedRes?.reservation_time ? String(matchedRes.reservation_time).slice(0, 5) : '';
      const visit = ci.created_date || '';
      return {
        registeredDate: regDate,
        reservationDate: resDate,
        reservationTime: resTime,
        visitDate: visit,
        name: info.name, phone: info.phone,
        tm: labelFor(tmOfCheckIn(ci, allResMap)),
        status: ci.status || '',
        groupKey: visit,
      };
    };
    const rows = kpiDetail === 'registered' ? tmFilteredRegistered.map(mapRes)
              : kpiDetail === 'scheduled'  ? tmFilteredScheduled.map(mapRes)
              :                               tmFilteredVisited.map(mapCI);
    return rows.sort((a, b) => (a.groupKey + a.reservationTime).localeCompare(b.groupKey + b.reservationTime));
  }, [kpiDetail, tmFilteredRegistered, tmFilteredScheduled, tmFilteredVisited, registeredRes, scheduledRes, visitedCI, customerInfoMap, staffMap]);

  // W3-06: ExcelJS xlsx 다운로드 (6컬럼)
  const downloadExcel = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const kpiName = kpiDetail === 'registered' ? '예약등록' : kpiDetail === 'scheduled' ? '예약수' : '내원수';
    const ws = wb.addWorksheet(kpiName);

    const headers = ['예약등록일', '예약일', '예약시간', '내원일', '고객명', '핸드폰번호'];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell(cell => { cell.font = { bold: true, size: 11 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; cell.alignment = { horizontal: 'center' }; });

    detailRows.forEach(r => {
      ws.addRow([r.registeredDate, r.reservationDate, r.reservationTime, r.visitDate, r.name, r.phone]);
    });

    ws.columns.forEach(col => { col.width = 15; });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `통계_${kpiName}_${format(from,'yyyyMMdd')}-${format(to,'yyyyMMdd')}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout clinicName={clinicName} activeTab="stats">
      <div className="p-4">
       <Tabs defaultValue="tm" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tm">TM 집계</TabsTrigger>
          <TabsTrigger value="daily">일별 추세</TabsTrigger>
          <TabsTrigger value="monthly">월 성과</TabsTrigger>
        </TabsList>
        <TabsContent value="tm" className="space-y-4 mt-0">
        {/* 필터 바 */}
        <div className="flex flex-wrap items-center gap-2 bg-card p-3 rounded-lg border">
          <span className="text-sm font-medium">기간</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(from, 'yyyy-MM-dd', { locale: ko })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={from} onSelect={(d) => d && setFrom(d)} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <span className="text-sm">~</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(to, 'yyyy-MM-dd', { locale: ko })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={to} onSelect={(d) => d && setTo(d)} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>

          {/* 박민지 Wave3 #6: 프리셋 (어제/당일/7일/30일/이번달) */}
          <div className="flex gap-1 ml-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { const y = subDays(new Date(), 1); setFrom(startOfDay(y)); setTo(startOfDay(y)); }}>어제</Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { const t = startOfDay(new Date()); setFrom(t); setTo(t); }}>당일</Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreset(6)}>최근 7일</Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreset(29)}>최근 30일</Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setFrom(startOfMonth(new Date())); setTo(endOfMonth(new Date())); }}>이번 달</Button>
          </div>

          {/* 박민지 추가요청 #3: 내 예약만 토글 */}
          <Button
            size="sm"
            variant={onlyMine ? 'default' : 'outline'}
            className={`h-8 text-xs ml-auto ${onlyMine ? 'bg-accent text-accent-foreground' : ''}`}
            onClick={() => setOnlyMine(v => !v)}
            title="본인이 등록한 예약·내원만 보기"
          >
            {onlyMine ? '✓ 내 예약만' : '내 예약만'}
          </Button>
          {/* T-W3-ADD-02: TM 직책 필터 */}
          <Button
            size="sm"
            variant={onlyTmRole ? 'default' : 'outline'}
            className={`h-8 text-xs ${onlyTmRole ? 'bg-accent text-accent-foreground' : ''}`}
            onClick={() => setOnlyTmRole(v => !v)}
            title="직책 TM(전화예약) 직원만 집계"
          >
            {onlyTmRole ? '✓ TM팀만' : 'TM팀만'}
          </Button>
        </div>

        {/* KPI 요약 — 박민지 Wave3 #8: 숫자 클릭 시 상세 팝업 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button type="button" onClick={() => setKpiDetail('registered')} className="bg-card border rounded-lg p-4 text-left hover:bg-muted/30 transition-colors">
            <div className="text-xs text-muted-foreground">예약등록건수</div>
            <div className="text-2xl font-bold mt-1 underline decoration-dotted">{totals.registered.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground mt-1">해당 기간에 예약 추가한 수</div>
          </button>
          <button type="button" onClick={() => setKpiDetail('scheduled')} className="bg-card border rounded-lg p-4 text-left hover:bg-muted/30 transition-colors">
            <div className="text-xs text-muted-foreground">예약수</div>
            <div className="text-2xl font-bold mt-1 text-blue-600 underline decoration-dotted">{totals.scheduled.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground mt-1">해당 기간에 잡혀있는 전체 예약 (취소 포함)</div>
          </button>
          <button type="button" onClick={() => setKpiDetail('visited')} className="bg-card border rounded-lg p-4 text-left hover:bg-muted/30 transition-colors">
            <div className="text-xs text-muted-foreground">내원건수</div>
            <div className="text-2xl font-bold mt-1 text-emerald-600 underline decoration-dotted">{totals.visited.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground mt-1">해당 기간에 내원한 수 (이탈 포함)</div>
          </button>
          {/* 박민지 추가요청 #5: 내원률 = 내원수 / 예약수 */}
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground">내원률</div>
            <div className="text-2xl font-bold mt-1 text-violet-600">{totals.visitRate.toFixed(2)}%</div>
            <div className="text-[10px] text-muted-foreground mt-1">내원수 ÷ 예약수</div>
          </div>
        </div>

        {/* TM별 테이블 */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
            <h3 className="text-sm font-semibold">TM상담사별 집계</h3>
            {loading && <span className="text-xs text-muted-foreground">로딩...</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2">TM 상담사 (등록자)</th>
                  <th className="text-right px-4 py-2">예약등록건수</th>
                  <th className="text-right px-4 py-2">예약수</th>
                  <th className="text-right px-4 py-2">내원건수</th>
                  <th className="text-right px-4 py-2">내원율</th>
                </tr>
              </thead>
              <tbody>
                {tmStats.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">데이터 없음</td></tr>
                ) : (
                  tmStats.map((row) => (
                    <tr key={row.tm} className="border-t hover:bg-muted/10">
                      <td className="px-4 py-2 font-medium">{row.tm}</td>
                      <td className="px-4 py-2 text-right">{row.registered.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-blue-600 font-medium">{row.scheduled.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-emerald-600 font-medium">{row.visited.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-violet-600 font-medium">{row.visitRate.toFixed(1)}%</td>
                    </tr>
                  ))
                )}
              </tbody>
              {tmStats.length > 0 && (
                <tfoot className="bg-muted/20 font-semibold text-sm border-t-2">
                  <tr>
                    <td className="px-4 py-2">합계</td>
                    <td className="px-4 py-2 text-right">{totals.registered.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-blue-600">{totals.scheduled.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-emerald-600">{totals.visited.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-violet-600">{totals.visitRate.toFixed(1)}%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground px-1">
          * 예약등록건수는 예약을 추가한 날짜 기준, 예약수는 예약이 잡혀있는 날짜 기준, 내원건수는 실제 체크인한 날짜 기준으로 집계합니다.
          <br />
          * 대기후이탈/상담후이탈 건도 내원건수에 포함됩니다.
        </p>
        </TabsContent>
        <TabsContent value="daily" className="mt-0">
          <Suspense fallback={<div className="flex items-center justify-center py-12 text-sm text-muted-foreground">차트 불러오는 중...</div>}>
            <DailyTrendsTab clinicId={clinicId} />
          </Suspense>
        </TabsContent>
        <TabsContent value="monthly" className="mt-0">
          <Suspense fallback={<div className="flex items-center justify-center py-12 text-sm text-muted-foreground">차트 불러오는 중...</div>}>
            <MonthlyPerfTab clinicId={clinicId} />
          </Suspense>
        </TabsContent>
       </Tabs>
      </div>

      {/* 박민지 Wave3 #8: KPI 숫자 클릭 → 상세 팝업 + CSV 다운로드 */}
      <Dialog open={!!kpiDetail} onOpenChange={(v) => { if (!v) setKpiDetail(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {kpiDetail === 'registered' ? '예약등록건수' : kpiDetail === 'scheduled' ? '예약수' : '내원건수'}
              {' '}({detailRows.length.toLocaleString()}건)
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-muted-foreground">{format(from, 'yyyy-MM-dd')} ~ {format(to, 'yyyy-MM-dd')}</span>
            <Button size="sm" variant="outline" onClick={downloadExcel} disabled={detailRows.length === 0}>엑셀 다운로드</Button>
          </div>
          <div className="max-h-[60vh] overflow-auto border rounded">
            {detailRows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">데이터 없음</div>
            ) : (() => {
              // 박민지 Wave3 #8 + T-W3-06: 그룹키 기준 날짜 그룹 표시
              const groups = new Map<string, DetailRow[]>();
              detailRows.forEach(r => { const k = r.groupKey || '-'; (groups.get(k) || groups.set(k, []).get(k)!).push(r); });
              const groupLabel = kpiDetail === 'registered' ? '예약등록일' : kpiDetail === 'scheduled' ? '예약일' : '내원일';
              return Array.from(groups.entries()).map(([date, rows]) => (
                <div key={date}>
                  <div className="sticky top-0 bg-muted/80 backdrop-blur text-xs font-semibold px-3 py-1.5 border-b">
                    {groupLabel} {date} <span className="text-muted-foreground font-normal ml-2">{rows.length}건</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20 text-[10px] text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 py-1 w-24">예약등록일</th>
                        <th className="text-left px-2 py-1 w-24">예약일</th>
                        <th className="text-left px-2 py-1 w-16">예약시간</th>
                        <th className="text-left px-2 py-1 w-24">내원일</th>
                        <th className="text-left px-2 py-1">고객명</th>
                        <th className="text-left px-2 py-1">핸드폰번호</th>
                        <th className="text-left px-2 py-1">TM상담사</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${date}-${i}`} className="border-t hover:bg-muted/10">
                          <td className="px-2 py-1 text-muted-foreground">{r.registeredDate}</td>
                          <td className="px-2 py-1">{r.reservationDate}</td>
                          <td className="px-2 py-1">{r.reservationTime}</td>
                          <td className="px-2 py-1 text-emerald-700">{r.visitDate}</td>
                          <td className="px-2 py-1 font-medium">{r.name}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.phone}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.tm}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ));
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
