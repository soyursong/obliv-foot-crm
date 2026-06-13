// KohReportTab — 균검사지(KOH 진균검사) 명단 리포트 탭
// Ticket: T-20260611-foot-KOH-REPORT-TAB (Phase 1) + T-20260612-foot-KOH-REPORT-PHASE15 (Phase 1.5)
//
// KOH(수산화칼륨) 진균검사를 시행한 환자 명단을 '검사일'(월 단위) 기준으로 조회한다.
// 컬럼: 환자이름 · 생년월일 · 차트번호 · 검사일 · [발톱부위] · [당일의사명]
//   ※ Phase 1.5(PHASE15, 3중 게이트 ALL GO): 발톱부위(입력) + 당일의사명(조인) 추가.
//
// === Phase 1.5 (T-20260612-foot-KOH-REPORT-PHASE15) ===
//  A. 발톱부위 = check_in_services.koh_nail_sites jsonb. 원소 {side:Rt|Lt, toe:1-5}.
//     입력 위젯 = R/L 2버튼 + 발가락 1~5 5버튼 + '조갑' 고정. 라디오형 단일선택(R/L 1 + 발가락 1).
//     쓰기 = RPC set_koh_nail_sites (check_in_services UPDATE RLS=consultant+ 우회, 승인 사용자 누구나).
//     DB엔 구조만 저장 — 표시문자열은 FE 파생(formatNailSite: 'Rt 1지 조갑').
//  B. 당일의사명 = medical_charts.signing_doctor_name (deployed b65357e) read-only 조인.
//     연결키 = customer_id + visit_date(=검사일 KST). 1환자 N차트 = 그날 진료의 합집합(Set).
//     미서명/차트없음/레거시 NULL = '미정'. ❌ 신규 컬럼/role 신설 금지.
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { todaySeoulISODate, seoulISODate } from '@/lib/format';
import { toast } from '@/lib/toast';
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
// 발톱부위(KOH 검사부위) — T-20260612-foot-KOH-REPORT-PHASE15 (A).
//   원소 = {side:'Rt'|'Lt', toe:1-5}. DB엔 구조만 저장(표시문자열 저장 금지) → 아래 render 는 FE 파생.
// ---------------------------------------------------------------------------
export type NailSide = 'Rt' | 'Lt';
export interface NailSite {
  side: NailSide;
  toe: number; // 1-5
}

/** canonical render — 단일 원소 'Rt 1지 조갑' */
export function formatNailSite(site: NailSite): string {
  return `${site.side} ${site.toe}지 조갑`;
}

/** 배열 → 표시문자열(', ' join). 빈/결측 = '—' */
export function formatNailSites(sites: NailSite[] | null | undefined): string {
  if (!sites || sites.length === 0) return '—';
  return sites.map(formatNailSite).join(', ');
}

/** jsonb(unknown) → NailSite[] 방어적 파싱. closed-enum(Rt/Lt, 1-5) 외 원소는 버림. */
export function parseNailSites(raw: unknown): NailSite[] {
  if (!Array.isArray(raw)) return [];
  const out: NailSite[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const side = (e as { side?: unknown }).side;
    const toe = Number((e as { toe?: unknown }).toe);
    if ((side === 'Rt' || side === 'Lt') && Number.isInteger(toe) && toe >= 1 && toe <= 5) {
      out.push({ side, toe });
    }
  }
  return out;
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
  id: string;                    // check_in_services.id (= KOH 검사 인스턴스, 발톱부위 귀속 키)
  service_name: string;
  created_at: string;            // 검사일(UTC timestamptz)
  customer_id: string | null;    // PHASE15(B): 당일의사 조인 키(+visit_date)
  customer_name: string;         // 표기명 — customers.name 우선, fallback check_ins.customer_name
  birth_date: string | null;     // 생년월일
  chart_number: string | null;   // 차트번호
  nail_sites: NailSite[];        // PHASE15(A): 발톱부위(koh_nail_sites jsonb 파생)
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

      // PHASE15: koh_nail_sites(발톱부위) + check_ins.customer_id(당일의사 조인키) 추가.
      //   ⚠ FE-DB 순서 안전장치: koh_nail_sites 컬럼이 아직 없으면(마이그 적용 전 prod 도달 시)
      //     select 가 42703(컬럼없음)으로 실패 → 기존 Phase1 탭이 깨진다. column-missing 감지 시
      //     koh_nail_sites 제외 select 로 1회 폴백(발톱부위는 빈값). 마이그 적용 후 자동 활성.
      const SELECT_WITH = 'id, service_name, created_at, koh_nail_sites, check_ins!inner(clinic_id, customer_id, customer_name, customers(name, birth_date, chart_number))';
      const SELECT_WITHOUT = 'id, service_name, created_at, check_ins!inner(clinic_id, customer_id, customer_name, customers(name, birth_date, chart_number))';
      const runQuery = (sel: string) =>
        supabase
          .from('check_in_services')
          .select(sel)
          // 임베드(check_ins)는 !inner — clinic 필터가 부모행을 실제로 제한.
          .eq('check_ins.clinic_id', clinicId)
          // KOH 매칭(denormalized name ILIKE). service_code/hira_code 매칭 금지.
          .or('service_name.ilike.%KOH%,service_name.ilike.%진균검사%')
          .gte('created_at', startBound)
          .lt('created_at', endBound)
          .order('created_at', { ascending: false });

      let { data, error } = await runQuery(SELECT_WITH);
      if (error && /koh_nail_sites/.test(error.message ?? '')) {
        ({ data, error } = await runQuery(SELECT_WITHOUT));
      }
      if (error) throw error;

      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
        // PostgREST 임베드는 환경에 따라 object/array 양쪽 → 방어적 flatten.
        const ciRaw = row['check_ins'];
        const ci = (Array.isArray(ciRaw) ? ciRaw[0] : ciRaw) as
          | { customer_id?: string | null; customer_name?: string | null; customers?: unknown }
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
          customer_id: ci?.customer_id ?? null,
          customer_name: name,
          birth_date: cust?.birth_date ?? null,
          chart_number: cust?.chart_number ?? null,
          nail_sites: parseNailSites(row['koh_nail_sites']),
        } as KohRow;
      });
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// 당일 진료의사 조인 — T-20260612-foot-KOH-REPORT-PHASE15 (B). 신규 스키마 ZERO(read-only).
//   medical_charts.signing_doctor_name(deployed b65357e) 를 customer_id + visit_date(=검사일 KST)로
//   조인. live 패턴(DoctorPatientList.useSigningDoctorsByDate) 재사용 — 단, 본 탭은 '월' 단위라
//   월 범위 medical_charts 를 한 번에 받아 (customer_id|visit_date) → 진료의명 Set 으로 인덱싱.
//   1환자 N차트 = 그날 진료의 합집합. 미서명/레거시 NULL/차트없음 = 키 부재 → 호출부에서 '미정'.
// ---------------------------------------------------------------------------
function useKohSigningDoctorsByMonth(clinicId: string | null, ym: string) {
  return useQuery<Map<string, Set<string>>>({
    queryKey: ['koh_signing_doctors', clinicId, ym],
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, Set<string>>();
      if (!clinicId) return map;
      // visit_date 는 DATE → 'YYYY-MM-DD' 사전식 범위([ym-01, 다음달-01)). seoulISODate(검사일)과 동일 포맷.
      const startDate = `${ym}-01`;
      const endDate = `${shiftYearMonth(ym, 1)}-01`;
      const { data, error } = await supabase
        .from('medical_charts')
        .select('customer_id, visit_date, signing_doctor_name')
        .eq('clinic_id', clinicId)
        .gte('visit_date', startDate)
        .lt('visit_date', endDate);
      if (error) throw error;
      for (const raw of (data ?? []) as Array<{
        customer_id: string | null;
        visit_date: string | null;
        signing_doctor_name: string | null;
      }>) {
        const cid = raw.customer_id;
        const vd = raw.visit_date;
        const nm = (raw.signing_doctor_name ?? '').trim();
        if (!cid || !vd || !nm) continue; // 미서명/레거시 NULL → 매핑 제외('미정' 처리)
        const key = `${cid}|${vd.slice(0, 10)}`;
        let set = map.get(key);
        if (!set) { set = new Set(); map.set(key, set); }
        set.add(nm);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** 행 → 당일 진료의명. customer_id + 검사일(KST) 조인. 없으면 '미정'(unsigned). 합집합 가나다순. */
function doctorNameForRow(r: KohRow, doctorMap: Map<string, Set<string>> | undefined): string {
  if (!r.customer_id) return '미정';
  const vd = seoulISODate(r.created_at);
  const set = doctorMap?.get(`${r.customer_id}|${vd}`);
  if (!set || set.size === 0) return '미정';
  return [...set].sort((a, b) => a.localeCompare(b, 'ko')).join(', ');
}

// ---------------------------------------------------------------------------
// 발톱부위 저장 — T-20260612-foot-KOH-REPORT-PHASE15 (A). RPC set_koh_nail_sites.
//   check_in_services UPDATE RLS(consultant+) 우회 — 승인 사용자 누구나(치료사 포함) 한 필드만 쓰기.
// ---------------------------------------------------------------------------
function useSaveNailSites(clinicId: string | null, ym: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceId, sites }: { serviceId: string; sites: NailSite[] }) => {
      const { error } = await supabase.rpc('set_koh_nail_sites', {
        p_service_id: serviceId,
        p_sites: sites,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['koh_report', clinicId, ym] });
    },
    onError: (e: Error) => {
      toast.error(`조갑부위 저장 실패: ${e.message}`);
    },
  });
}

// ---------------------------------------------------------------------------
// 발톱부위 입력 위젯 — T-20260612-foot-KOH-REPORT-PHASE15 (A-2).
//   R/L 2버튼 + 발가락 1~5 5버튼 + '조갑' 고정. 라디오형 단일선택(R/L 1개 + 발가락 1개).
//   side·toe 둘 다 선택되면 [{side,toe}] 저장, 둘 중 하나라도 해제면 [] 저장(미선택 허용).
//   재선택 = 이전 값 교체(단일, 누적 X). 태블릿 동선 — 즉시 저장(별도 저장버튼 없음).
// ---------------------------------------------------------------------------
const TOES = [1, 2, 3, 4, 5] as const;

function NailSiteEditor({
  current,
  saving,
  onCommit,
}: {
  current: NailSite[];
  saving: boolean;
  onCommit: (sites: NailSite[]) => void;
}) {
  const cur = current[0] ?? null;
  const [side, setSide] = useState<NailSide | null>(cur?.side ?? null);
  const [toe, setToe] = useState<number | null>(cur?.toe ?? null);

  // side/toe 변화 → 즉시 commit(둘 다 있으면 1원소, 아니면 빈배열). 현재값과 같으면 no-op.
  const commit = (s: NailSide | null, t: number | null) => {
    const next: NailSite[] = s && t ? [{ side: s, toe: t }] : [];
    const same =
      next.length === current.length &&
      next.every((n, i) => current[i] && current[i].side === n.side && current[i].toe === n.toe);
    if (!same) onCommit(next);
  };

  const onSide = (s: NailSide) => {
    const ns = side === s ? null : s;
    setSide(ns);
    commit(ns, toe);
  };
  const onToe = (t: number) => {
    const nt = toe === t ? null : t;
    setToe(nt);
    commit(side, nt);
  };

  const btn = (active: boolean) =>
    `inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition disabled:opacity-50 ${
      active
        ? 'border-teal-600 bg-teal-600 text-white'
        : 'border-input bg-background text-foreground hover:bg-accent'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="nail-site-editor">
      {/* R/L */}
      <div className="flex gap-0.5" data-testid="nail-side-group">
        {(['Rt', 'Lt'] as NailSide[]).map((s) => (
          <button
            key={s}
            type="button"
            disabled={saving}
            onClick={() => onSide(s)}
            className={btn(side === s)}
            aria-pressed={side === s}
            data-testid={`nail-side-${s}`}
          >
            {s}
          </button>
        ))}
      </div>
      {/* 발가락 1~5 */}
      <div className="flex gap-0.5" data-testid="nail-toe-group">
        {TOES.map((t) => (
          <button
            key={t}
            type="button"
            disabled={saving}
            onClick={() => onToe(t)}
            className={btn(toe === t)}
            aria-pressed={toe === t}
            data-testid={`nail-toe-${t}`}
          >
            {t}
          </button>
        ))}
      </div>
      {/* '조갑' 고정 텍스트 */}
      <span className="text-xs font-medium text-muted-foreground">조갑</span>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
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
  // PHASE15(B): 당일의사 조인 인덱스(월 범위, read-only). PHASE15(A): 발톱부위 저장 mutation.
  const { data: doctorMap } = useKohSigningDoctorsByMonth(clinicId, ym);
  const saveNailSites = useSaveNailSites(clinicId, ym);

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
                {/* PHASE15(C): 발톱부위 · 당일의사명 컬럼 추가 */}
                <th className="px-3 py-2.5 font-medium">조갑부위</th>
                <th className="px-3 py-2.5 font-medium">당일 진료의사</th>
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
                  {/* PHASE15(A): 발톱부위 — 현재값(FE 파생) + 입력 위젯(R/L+발가락+조갑 단일선택). */}
                  <td className="px-3 py-2.5" data-testid="koh-cell-nailsite">
                    <div className="space-y-1.5">
                      <span
                        className={`block text-xs font-medium ${
                          r.nail_sites.length > 0 ? 'text-foreground' : 'text-muted-foreground/60'
                        }`}
                        data-testid="koh-nailsite-text"
                      >
                        {formatNailSites(r.nail_sites)}
                      </span>
                      <NailSiteEditor
                        current={r.nail_sites}
                        saving={
                          saveNailSites.isPending && saveNailSites.variables?.serviceId === r.id
                        }
                        onCommit={(sites) => saveNailSites.mutate({ serviceId: r.id, sites })}
                      />
                    </div>
                  </td>
                  {/* PHASE15(B): 당일 진료의사 — customer_id+검사일 조인. 없으면 '미정'. */}
                  <td
                    className={`px-3 py-2.5 text-xs ${
                      doctorNameForRow(r, doctorMap) === '미정'
                        ? 'text-muted-foreground/60'
                        : 'font-medium text-foreground'
                    }`}
                    data-testid="koh-cell-doctor"
                  >
                    {doctorNameForRow(r, doctorMap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 안내 — PHASE15 범위 명시 */}
      <p className="text-[11px] text-muted-foreground/70">
        ※ 검사일(시행일) 기준 월별 명단입니다. 조갑부위는 R/L·발가락을 눌러 입력하세요(단일 선택). 당일 진료의사는 진료차트 서명 기준이며 미서명·차트없음은 '미정'으로 표시됩니다.
      </p>
    </div>
  );
}
