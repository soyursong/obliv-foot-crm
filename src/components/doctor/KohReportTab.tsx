// KohReportTab — 균검사지(KOH 진균검사) 명단 리포트 탭
// Ticket: T-20260611-foot-KOH-REPORT-TAB (Phase 1 — read-only, 4컬럼)
//
// KOH(수산화칼륨) 진균검사를 시행한 환자 명단을 '검사일'(월 단위) 기준으로 조회한다.
// 컬럼(Phase 1 = 4컬럼만): 환자이름 · 생년월일 · 차트번호 · 검사일
//   ※ '발톱부위'·'당일의사명'은 Phase 1.5(T-20260612-foot-KOH-REPORT-PHASE15)로 분리 —
//     신규 컬럼+검사시점 입력동선 + 3중 게이트(현장 동선/data-architect CONSULT/supervisor DB게이트)
//     GO 전까지 본 탭은 read-only 4컬럼만 출시. 이 파일에서 그 2컬럼을 절대 추가하지 말 것.
//
// 데이터 경로 (AC-0 evidence: db-gate/T-20260611-foot-KOH-REPORT-TAB_ac0_evidence.md):
//   check_in_services(검사일=created_at, KOH 매칭=service_name)
//     → check_ins!inner(clinic_id, customer_id, customer_name)        [check_in_id FK]
//       → customers(name, birth_date, chart_number)                    [customer_id FK, 표기명 우선]
//
//   KOH 매칭식(denormalized service_name ILIKE):
//     service_name ILIKE '%KOH%' OR service_name ILIKE '%진균검사%'
//   ⚠ service_code/hira_code 매칭 금지 — DX-KOH-01(미존재)·D6591/D2502001(비활성).
//     실운영 서비스명 = '일반진균검사-KOH도말-조갑조직'(service_code=D620300HZ, active).

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { todaySeoulISODate, seoulISODate } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, FlaskConical, ChevronLeft, ChevronRight, Search } from 'lucide-react';

// ---------------------------------------------------------------------------
// KOH 진균검사 매칭 — service_name denormalized ILIKE 정본(SSOT).
//   service_code/hira_code 매칭 금지(AC-0 evidence). 'KOH'는 대소문자 무시, '진균검사'는 그대로.
// ---------------------------------------------------------------------------
export function kohServiceNameMatches(serviceName: string | null | undefined): boolean {
  if (!serviceName) return false;
  return serviceName.toUpperCase().includes('KOH') || serviceName.includes('진균검사');
}

// ---------------------------------------------------------------------------
// 월(YYYY-MM) 이동 — UTC 정오 기준으로 ±N개월, DST/경계 드리프트 없음.
// ---------------------------------------------------------------------------
export function shiftYearMonth(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + deltaMonths, 1, 12, 0, 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 오늘(KST) 기준 'YYYY-MM' */
export function currentYearMonthSeoul(): string {
  return todaySeoulISODate().slice(0, 7);
}

/** 'YYYY-MM' → 'YYYY년 M월' 표기 */
export function formatYearMonthKo(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** 생년월일 표시 — DATE/timestamptz 어느 쪽이든 YYYY-MM-DD 10자리만, 결측 '—' */
export function formatBirthDate(birth: string | null | undefined): string {
  if (!birth) return '—';
  const s = String(birth).trim();
  return s.length >= 10 ? s.slice(0, 10) : s || '—';
}

/** 검사일 표시 — created_at(UTC) → KST 'YYYY-MM-DD HH:mm' */
export function formatExamDateTime(createdAt: string | null | undefined): string {
  if (!createdAt) return '—';
  const date = seoulISODate(createdAt);
  const time = new Date(createdAt).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${date} ${time}`;
}

// ---------------------------------------------------------------------------
// +1일 경과 판정 — T-20260611-foot-KOH-REPORT-TAB (AC-1/AC-3 SSOT).
//   현장 요구 = "KOH 균검사를 받은 지 하루 지난 환자"만 명단에 노출(검사지 발행 대상).
//   판정식: 검사일(KST 캘린더 날짜) < 오늘(KST) → 검사 다음날부터 표시. 당일/미래 검사는 제외.
//   ISO 'YYYY-MM-DD' 사전식 비교 = 캘린더 비교(타임존 무관). 시·분 무관(날짜 경계 기준).
//   AC-3: 검사 당일(+1일 미경과) 환자 / 미수검(KOH row 없음) 환자는 자연히 제외.
// ---------------------------------------------------------------------------
export function isKohExamEligible(createdAt: string | null | undefined, todayISO: string): boolean {
  if (!createdAt) return false;
  return seoulISODate(createdAt) < todayISO;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface KohRow {
  id: string;
  service_name: string;
  created_at: string;            // 검사일(UTC timestamptz)
  customer_name: string;         // 표기명 — customers.name 우선, fallback check_ins.customer_name
  birth_date: string | null;     // 생년월일
  chart_number: string | null;   // 차트번호
}

// ---------------------------------------------------------------------------
// 조회 hook — 월 범위 + clinic + KOH 매칭(read-only)
//   범위 바운드: [YYYY-MM-01 00:00 KST, 다음달-01 00:00 KST) — KST 경계 정확.
// ---------------------------------------------------------------------------
function useKohReport(clinicId: string | null, ym: string) {
  return useQuery<KohRow[]>({
    queryKey: ['koh_report', clinicId, ym],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const startBound = `${ym}-01T00:00:00+09:00`;
      const endBound = `${shiftYearMonth(ym, 1)}-01T00:00:00+09:00`;
      const { data, error } = await supabase
        .from('check_in_services')
        .select(
          'id, service_name, created_at, check_ins!inner(clinic_id, customer_name, customers(name, birth_date, chart_number))',
        )
        // 임베드(check_ins)는 !inner — clinic 필터가 부모행을 실제로 제한.
        .eq('check_ins.clinic_id', clinicId)
        // KOH 매칭(denormalized name ILIKE). service_code/hira_code 매칭 금지.
        .or('service_name.ilike.%KOH%,service_name.ilike.%진균검사%')
        .gte('created_at', startBound)
        .lt('created_at', endBound)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
        // PostgREST 임베드는 환경에 따라 object/array 양쪽 → 방어적 flatten.
        const ciRaw = row['check_ins'];
        const ci = (Array.isArray(ciRaw) ? ciRaw[0] : ciRaw) as
          | { customer_name?: string | null; customers?: unknown }
          | undefined;
        const custRaw = ci?.customers;
        const cust = (Array.isArray(custRaw) ? custRaw[0] : custRaw) as
          | { name?: string | null; birth_date?: string | null; chart_number?: string | null }
          | undefined;
        const name = (cust?.name ?? '').trim() || (ci?.customer_name ?? '').trim() || '—';
        return {
          id: String(row['id']),
          service_name: String(row['service_name'] ?? ''),
          created_at: String(row['created_at'] ?? ''),
          customer_name: name,
          birth_date: cust?.birth_date ?? null,
          chart_number: cust?.chart_number ?? null,
        } as KohRow;
      });
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// KohReportTab — Main
// ---------------------------------------------------------------------------
export default function KohReportTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;

  const [ym, setYm] = useState<string>(currentYearMonthSeoul());
  const [query, setQuery] = useState('');
  const isCurrentMonth = ym === currentYearMonthSeoul();
  const todayISO = todaySeoulISODate();

  const { data: rows = [], isLoading, isError, error } = useKohReport(clinicId, ym);

  // T-20260611-foot-KOH-REPORT-TAB (AC-1/AC-3): +1일 경과(검사 다음날부터)만 노출.
  //   검사 당일(+1일 미경과) row 는 제외 — isKohExamEligible(검사일 KST < 오늘 KST).
  //   이번 달 조회 시 오늘 검사분이 걸러지고, 과거 달은 전부 경과 → 자연 통과.
  const eligibleRows = useMemo(
    () => rows.filter((r) => isKohExamEligible(r.created_at, todayISO)),
    [rows, todayISO],
  );

  // 이름/차트번호 클라이언트 검색(read-only). 공백 trim, 대소문자 무시.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligibleRows;
    return eligibleRows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.chart_number ?? '').toLowerCase().includes(q),
    );
  }, [eligibleRows, query]);

  return (
    <div className="space-y-4">
      {/* 헤더 + 월 네비게이터 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <FlaskConical className="h-4 w-4 text-teal-600" />
            균검사지 — KOH 진균검사 명단
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            KOH(진균) 검사 후 하루가 지난 환자 명단입니다. 검사일 기준 월별 조회(당일 검사분은 다음날 표시).
          </p>
        </div>

        <div className="flex items-center gap-1" data-testid="koh-month-nav">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => setYm((v) => shiftYearMonth(v, -1))}
            aria-label="이전 달"
            data-testid="koh-prev-month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="min-w-[88px] text-center text-sm font-semibold text-foreground"
            data-testid="koh-month-label"
          >
            {formatYearMonthKo(ym)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => setYm((v) => shiftYearMonth(v, 1))}
            aria-label="다음 달"
            data-testid="koh-next-month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isCurrentMonth && (
            <Button
              size="sm"
              variant="outline"
              className="ml-1 h-8 px-2 text-[11px]"
              onClick={() => setYm(currentYearMonthSeoul())}
              data-testid="koh-this-month"
            >
              이번 달
            </Button>
          )}
        </div>
      </div>

      {/* 검색 + 건수 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="환자이름 · 차트번호 검색"
            className="h-9 pl-8 text-sm"
            data-testid="koh-search"
          />
        </div>
        <span className="text-xs text-muted-foreground" data-testid="koh-count">
          {formatYearMonthKo(ym)} 검사 <span className="font-semibold text-foreground">{filtered.length}</span>건
          {query.trim() && eligibleRows.length !== filtered.length && (
            <span className="ml-1 text-muted-foreground/70">(전체 {eligibleRows.length}건 중)</span>
          )}
        </span>
      </div>

      {/* 본문 */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-8 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {query.trim()
            ? '검색 결과가 없습니다.'
            : `${formatYearMonthKo(ym)}에 검사 후 하루가 지난 KOH 진균검사 명단이 없습니다.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-testid="koh-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">환자이름</th>
                <th className="px-3 py-2.5 font-medium">생년월일</th>
                <th className="px-3 py-2.5 font-medium">차트번호</th>
                <th className="px-3 py-2.5 font-medium">검사일</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b last:border-0 transition hover:bg-accent/30"
                  data-testid="koh-row"
                >
                  <td
                    className="px-3 py-2.5 font-semibold text-foreground"
                    data-testid="koh-cell-name"
                    title={r.service_name}
                  >
                    {r.customer_name}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-foreground/90" data-testid="koh-cell-birth">
                    {formatBirthDate(r.birth_date)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-foreground/90" data-testid="koh-cell-chart">
                    {r.chart_number || '—'}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground" data-testid="koh-cell-examdate">
                    {formatExamDateTime(r.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 안내 — Phase 1 범위 명시 */}
      <p className="text-[11px] text-muted-foreground/70">
        ※ 검사일(시행일) 기준 월별 명단입니다. 발톱부위·담당의사 정보는 추후 업데이트 예정입니다.
      </p>
    </div>
  );
}
