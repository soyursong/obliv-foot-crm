// ExamTargetsSection.tsx — 치료테이블 §B '균검사 & 피검사 대상자'
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (AC-4)
// Ticket: T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER (A컴팩트/B날짜필터/C검사결과/D이름)
// Ticket: T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV (정밀화 후속)
//   AC-1 컴팩트화 — 밀도만 압축(내용 보존). 행 height/padding/leading 축소, 폰트는 가독 최소 유지.
//     (RESVCAL-COMPACT-CONTENT-KEEP 동일 원칙: 폰트 과압축 금지 ≥11px, 정보 항목 삭제 0.)
//   AC-2 일자별 리스트 — 단일 명단 → 검사신청일(check_ins.checked_in_at, KST) 기준 일자별 그룹핑.
//     기준일자 DISCOVERY 결론: '검사신청일' = checked_in_at. (진료콜 등재일은 자매 섹션 개념이라 검사신청엔 미적용.)
//     부모 공통 날짜선택기의 date 를 '윈도 끝'으로 보고 직전 WINDOW_DAYS 일을 일자별로 묶어 표시.
//   AC-3 검사신청→검사결과(신규생성) — ⚠ DISCOVERY 게이트(총괄 confirm 전까지 신규 백엔드 0).
//     · KOH    : 결과 저장모델 존재(form_submissions form_key='koh_result') → 발행본 '결과 보기'(KohResultDialog),
//                미발행 '결과 생성'(균검사 보고서 surface 재사용). 신청 boolean 과 분리된 별도 저장. ✓
//     · 혈액검사: 결과 저장모델 부재 → 신청 boolean 재사용 금지(요구사항). 별도 저장모델 신설 →
//                T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND(B안 파일보관): patient_file_records 메타 +
//                documents 버킷 결과지 파일. '결과지 업로드'(0건) / '결과지 보기 (N)'(≥1건). DA GO 후 활성화.
//   AC-4 우클릭 = 기존 CRM 컨텍스트 메뉴 그대로(부모 nameInteraction.onContextMenu 위임, 신규 정의 0).
//   AC-5 좌클릭 = 2번차트 오픈(부모 nameInteraction.onLeftClick → useChart, 재사용).
//
// 리스트업: check_in_services 의 koh_requested / blood_test_requested=true 인 환자. (BLOODTEST-TOGGLE-ADD /
//   KOHTEST-LIFECYCLE SSOT read-only 재사용 — 신규 스키마 0, ADDITIVE 소비.) 환자×검사신청일 = 1행.
// 방어성: koh_requested/blood_test_requested 는 ADDITIVE(마이그 미적용 prod 42703) → 폴백 빈 목록.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { chartNoBadge, seoulISODate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import KohResultDialog from '@/components/KohResultDialog';
import BloodResultDialog from '@/components/BloodResultDialog';
import { Loader2, FlaskConical, Droplet, ClipboardList, FilePlus2, FileText, CalendarDays, Upload, ChevronRight, ChevronDown } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';

// AC-2: 일자별 리스트 윈도(검사신청일 기준 직전 N일). 검사결과는 수일 뒤 회신되므로 단일일 → 2주 윈도.
const WINDOW_DAYS = 14;

interface ExamTargetRow {
  customerId: string;
  customerName: string;
  chartNumber: string | null;
  phone: string | null;
  kohRequested: boolean;
  bloodRequested: boolean;
  kohServiceId: string | null; // C: 발행본(koh_service_id) lookup 키
  requestDate: string; // AC-2: 검사신청일(KST YYYY-MM-DD)
}

interface ExamDateGroup {
  date: string; // YYYY-MM-DD (KST)
  rows: ExamTargetRow[];
}

// AC-2: date(윈도 끝) 기준 직전 WINDOW_DAYS 일 범위. [start 00:00 KST, end 23:59 KST].
function windowBounds(endDate: string) {
  const start = format(subDays(new Date(endDate + 'T12:00:00'), WINDOW_DAYS - 1), 'yyyy-MM-dd');
  return { startTs: `${start}T00:00:00+09:00`, endTs: `${endDate}T23:59:59+09:00`, start };
}

// check_in_services(koh_requested|blood_test_requested=true) → 환자×검사신청일별 1행, 일자별 그룹.
function useExamTargets(clinicId: string | null | undefined, date: string) {
  return useQuery<ExamDateGroup[]>({
    queryKey: ['exam_targets', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { startTs, endTs } = windowBounds(date);
      const SEL =
        'id, koh_requested, blood_test_requested, check_in_id, ' +
        'check_ins!inner(customer_id, customer_name, clinic_id, status, checked_in_at)';
      const { data, error } = await supabase
        .from('check_in_services')
        .select(SEL)
        .eq('check_ins.clinic_id', clinicId)
        .neq('check_ins.status', 'cancelled')
        .gte('check_ins.checked_in_at', startTs)
        .lte('check_ins.checked_in_at', endTs)
        .or('koh_requested.eq.true,blood_test_requested.eq.true');
      if (error) {
        // ADDITIVE 컬럼 미적용 prod(42703) → 빈 목록 폴백(페이지 무파손).
        if (/koh_requested|blood_test_requested|42703/.test(error.message ?? '')) return [];
        throw error;
      }

      // 환자×검사신청일별 집계 — 같은 환자라도 신청일이 다르면 별도 행(일자별 추적). koh service id 보존.
      const map = new Map<string, ExamTargetRow>();
      for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const ci = (raw['check_ins'] ?? {}) as Record<string, unknown>;
        const cid = String(ci['customer_id'] ?? '');
        const checkedAt = ci['checked_in_at'];
        if (!cid || !checkedAt) continue;
        const koh = raw['koh_requested'] === true;
        const blood = raw['blood_test_requested'] === true;
        if (!koh && !blood) continue;
        const reqDate = seoulISODate(checkedAt as string); // AC-2: KST 검사신청일
        const svcId = String(raw['id'] ?? '');
        const key = `${cid}__${reqDate}`;
        const prev = map.get(key);
        if (prev) {
          prev.kohRequested = prev.kohRequested || koh;
          prev.bloodRequested = prev.bloodRequested || blood;
          if (koh && !prev.kohServiceId) prev.kohServiceId = svcId || null;
        } else {
          map.set(key, {
            customerId: cid,
            customerName: String(ci['customer_name'] ?? '—'),
            chartNumber: null,
            phone: null,
            kohRequested: koh,
            bloodRequested: blood,
            kohServiceId: koh ? svcId || null : null,
            requestDate: reqDate,
          });
        }
      }

      const rows = [...map.values()];
      if (rows.length === 0) return [];

      // 차트번호·연락처 보강(read-only). 실패해도 목록은 표시.
      try {
        const ids = [...new Set(rows.map((r) => r.customerId))];
        const { data: custs } = await supabase
          .from('customers')
          .select('id, chart_number, phone')
          .in('id', ids);
        const metaMap = new Map<string, { chart: string | null; phone: string | null }>();
        for (const c of (custs ?? []) as Array<{ id: string; chart_number: string | null; phone: string | null }>) {
          if (c.id) metaMap.set(c.id, { chart: c.chart_number ?? null, phone: c.phone ?? null });
        }
        for (const r of rows) {
          const meta = metaMap.get(r.customerId);
          r.chartNumber = meta?.chart ?? null;
          r.phone = meta?.phone ?? null;
        }
      } catch {
        // 보강 실패 — 무시(이름·검사상태는 정상 표시).
      }

      // AC-2: 일자별 그룹핑(최근 신청일 먼저), 그룹 내 이름 가나다순.
      const groupMap = new Map<string, ExamTargetRow[]>();
      for (const r of rows) {
        const g = groupMap.get(r.requestDate);
        if (g) g.push(r);
        else groupMap.set(r.requestDate, [r]);
      }
      const groups: ExamDateGroup[] = [...groupMap.entries()]
        .map(([d, gr]) => ({
          date: d,
          rows: gr.sort((a, b) => a.customerName.localeCompare(b.customerName, 'ko')),
        }))
        .sort((a, b) => b.date.localeCompare(a.date)); // 최근 신청일 먼저
      return groups;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// C: 발행된 KOH 결과지 인덱스(koh_service_id → field_data). KohReportTab usePublishedKoh 와 동일 SSOT read-only.
function usePublishedKohMap(clinicId: string | null | undefined) {
  return useQuery<Map<string, Record<string, unknown>>>({
    queryKey: ['koh_published', clinicId], // KohReportTab 와 동일 키 — 발행 시 invalidate 공유(read-after-write).
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, Record<string, unknown>>();
      if (!clinicId) return map;
      const { data: tpl } = await supabase
        .from('form_templates')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'koh_result')
        .limit(1)
        .maybeSingle();
      if (!tpl?.id) return map;
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, field_data')
        .eq('clinic_id', clinicId)
        .eq('template_id', tpl.id)
        .eq('status', 'published');
      if (error) throw error;
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
        const sid = String(fd['koh_service_id'] ?? '');
        if (sid) map.set(sid, fd);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// 혈액검사 결과지 인덱스(customer_id → 등록 건수). patient_file_records(kind='blood_result') read-only.
//   '결과지 업로드'(0건) vs '결과지 보기'(≥1건) 라벨 분기 + 발행본 read-after-write(invalidate 공유 키).
//   방어성: 테이블 미적용 prod(42P01/42703) → 빈 Map 폴백(섹션 무파손).
function useBloodResultCounts(clinicId: string | null | undefined) {
  return useQuery<Map<string, number>>({
    queryKey: ['blood_result_counts', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, number>();
      if (!clinicId) return map;
      const { data, error } = await supabase
        .from('patient_file_records')
        .select('customer_id')
        .eq('clinic_id', clinicId)
        .eq('kind', 'blood_result');
      if (error) {
        if (/patient_file_records|relation|42P01|42703/.test(error.message ?? '')) return map;
        throw error;
      }
      for (const r of (data ?? []) as Array<{ customer_id: string }>) {
        const cid = String(r.customer_id ?? '');
        if (cid) map.set(cid, (map.get(cid) ?? 0) + 1);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

// 검사 박스 — 신청(●, 활성색) / 미신청(○, 회색). AC-1: py 축소(밀도↑), 폰트 11px 유지(가독).
function ExamBadge({
  label,
  active,
  tone,
  testid,
}: {
  label: string;
  active: boolean;
  tone: 'teal' | 'rose';
  testid: string;
}) {
  const Icon = tone === 'teal' ? FlaskConical : Droplet;
  const onCls =
    tone === 'teal'
      ? 'border-teal-300 bg-teal-50 text-teal-700'
      : 'border-rose-300 bg-rose-50 text-rose-700';
  const offCls = 'border-muted bg-muted/30 text-muted-foreground/60';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0 text-[11px] font-semibold leading-5 ${
        active ? onCls : offCls
      }`}
      data-testid={testid}
      data-active={active ? 'true' : 'false'}
    >
      <Icon className="h-3 w-3" />
      {label}
      <span className="text-[12px] leading-none">{active ? '●' : '○'}</span>
    </span>
  );
}

// AC-2: 일자 헤더 라벨 — "6월 23일 (월)" + 오늘 배지.
function dateLabel(d: string) {
  return format(new Date(d + 'T12:00:00'), 'M월 d일 (EEE)', { locale: ko });
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function ExamTargetsSection({ date, nameInteraction }: Props) {
  const clinic = useClinic();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: groups = [], isLoading, isError, error } = useExamTargets(clinic?.id, date);
  const { data: publishedKoh } = usePublishedKohMap(clinic?.id);
  const { data: bloodResultCounts } = useBloodResultCounts(clinic?.id);
  const [viewFieldData, setViewFieldData] = useState<Record<string, unknown> | null>(null);
  // 혈액검사 결과지 업로드/보기 다이얼로그 타겟(환자). null=닫힘.
  const [bloodTarget, setBloodTarget] = useState<{ id: string; name: string } | null>(null);
  // T-20260629-foot-TREATBL-COLLAPSE-TOGGLE: 날짜 그룹 아코디언. 펼쳐진 그룹 키(날짜) 집합.
  //   초기값 = 빈 Set → 전 그룹 접힘(▶). 화면 재진입 시 컴포넌트 remount → 자동 접힘 복귀(AC-2/시나리오2-3).
  //   그룹 독립 토글(AC-5) — 한 그룹 변경이 다른 그룹에 영향 없음.
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const toggleGroup = (d: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const totalCount = groups.reduce((sum, g) => sum + g.rows.length, 0);
  const today = seoulISODate(new Date());
  const { start } = windowBounds(date);

  // C: 미발행 KOH 결과 생성 — 기존 발행 surface(균검사 보고서) 재사용 안내(인라인 publish UX 는 AC-3 pending).
  const goGenerateKoh = () => {
    toast('균검사 보고서(의사 도구)에서 결과를 생성·발행하세요.');
    navigate('/admin/doctor-tools');
  };

  // 한 환자 행 렌더(그룹 공통).
  const renderRow = (r: ExamTargetRow, idx: number) => {
    const kohFd = r.kohServiceId ? publishedKoh?.get(r.kohServiceId) : undefined;
    const kohPublished = !!kohFd;
    const bloodResultCount = bloodResultCounts?.get(r.customerId) ?? 0;
    const hasBloodResult = bloodResultCount > 0;
    return (
      <tr
        key={`${r.customerId}-${r.requestDate}`}
        className="border-b last:border-0 transition-colors hover:bg-muted/30"
        data-testid="exam-targets-row"
      >
        <td className="px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
        <td className="px-2 py-1 font-medium whitespace-nowrap">
          {/* AC-5 좌클릭=2번차트 / AC-4 우클릭=CRM 컨텍스트 메뉴 */}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline"
            data-testid="exam-name-clickable"
            onClick={() => nameInteraction.onLeftClick(r.customerId)}
            onContextMenu={(e) =>
              nameInteraction.onContextMenu(e, {
                id: r.customerId,
                name: r.customerName,
                phone: r.phone,
              })
            }
          >
            <span>{r.customerName}</span>
            <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
              {chartNoBadge(r.chartNumber)}
            </span>
          </button>
        </td>
        {/* C: 신청 상태 + 검사결과 동작 같은 줄(AC-3). 검사별 [상태 박스 | 결과 동작]. */}
        <td className="px-2 py-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* 균검사 */}
            <div className="flex items-center gap-1.5" data-testid="exam-koh-group">
              <ExamBadge label="균검사" active={r.kohRequested} tone="teal" testid="exam-koh-badge" />
              {r.kohRequested &&
                (kohPublished ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                    data-testid="exam-koh-result-view"
                    onClick={() => setViewFieldData(kohFd!)}
                    title="발행된 균검사 결과 보기"
                  >
                    <FileText className="h-3 w-3" /> 결과 보기
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] bg-teal-600 text-white hover:bg-teal-700"
                    data-testid="exam-koh-result-new"
                    onClick={goGenerateKoh}
                    title="균검사 결과 생성(균검사 보고서로 이동)"
                  >
                    <FilePlus2 className="h-3 w-3" /> 결과 생성
                  </Button>
                ))}
            </div>
            {/* 피검사 — 결과지 업로드(B안 파일보관). 등록 0건=업로드 / ≥1건=보기. T-...-BLOODTEST-RESULT-PUBLISH-BACKEND */}
            <div className="flex items-center gap-1.5" data-testid="exam-blood-group">
              <ExamBadge label="피검사" active={r.bloodRequested} tone="rose" testid="exam-blood-badge" />
              {r.bloodRequested &&
                (hasBloodResult ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                    data-testid="exam-blood-result-view"
                    onClick={() => setBloodTarget({ id: r.customerId, name: r.customerName })}
                    title="등록된 혈액검사 결과지 보기"
                  >
                    <FileText className="h-3 w-3" /> 결과지 보기 ({bloodResultCount})
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] bg-rose-600 text-white hover:bg-rose-700"
                    data-testid="exam-blood-result-upload"
                    onClick={() => setBloodTarget({ id: r.customerId, name: r.customerName })}
                    title="혈액검사 결과지 업로드(PDF·JPG·PNG)"
                  >
                    <Upload className="h-3 w-3" /> 결과지 업로드
                  </Button>
                ))}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-2" data-testid="exam-targets-section">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ClipboardList className="h-4 w-4 text-teal-600" />
            균검사 &amp; 피검사 대상자
          </p>
          {/* AC-2: 일자별 윈도 안내(검사신청일 기준 최근 N일) */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            검사신청일 기준 {dateLabel(start)} ~ {dateLabel(date)} 동안 균검사·피검사를 신청한 환자를
            일자별로 묶어 보여줍니다. 신청한 검사만 활성(●)으로 표시됩니다.
          </p>
        </div>
        {totalCount > 0 && (
          <span
            className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700"
            data-testid="exam-targets-count"
          >
            대상 {totalCount}명
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-4 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : groups.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-testid="exam-targets-empty"
        >
          <ClipboardList className="h-5 w-5 text-muted-foreground/40" />
          해당 기간에 균검사·피검사를 신청한 환자가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* AC-2: 일자별 그룹 — 각 그룹 = 날짜 헤더 바(아코디언 토글) + 펼침 시 해당 일자 명단 테이블 */}
          {groups.map((g) => {
            const isOpen = expandedDates.has(g.date);
            return (
              <div
                key={g.date}
                className="overflow-hidden rounded-lg border bg-background"
                data-testid="exam-date-group"
                data-date={g.date}
                data-state={isOpen ? 'expanded' : 'collapsed'}
              >
                {/* AC-3: 헤더 클릭 = 펼침/접힘 토글. 좌측 chevron(▶ 접힘 / ▼ 펼침). */}
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 border-b bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60"
                  data-testid="exam-date-group-header"
                  aria-expanded={isOpen}
                  onClick={() => toggleGroup(g.date)}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    {isOpen ? (
                      <ChevronDown
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        data-testid="exam-date-group-chevron"
                        data-open="true"
                      />
                    ) : (
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        data-testid="exam-date-group-chevron"
                        data-open="false"
                      />
                    )}
                    <CalendarDays className="h-3.5 w-3.5 text-teal-600" />
                    {dateLabel(g.date)}
                    {g.date === today && (
                      <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        오늘
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground" data-testid="exam-date-group-count">
                    {g.rows.length}명
                  </span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto" data-testid="exam-targets-table">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b bg-muted/20 text-left text-[11px] font-semibold text-muted-foreground">
                          <th className="px-2 py-1 whitespace-nowrap">#</th>
                          <th className="px-2 py-1 whitespace-nowrap">환자</th>
                          <th className="px-2 py-1 whitespace-nowrap">신청 검사 &amp; 검사결과</th>
                        </tr>
                      </thead>
                      <tbody>{g.rows.map((r, idx) => renderRow(r, idx))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* C: 발행된 KOH 결과지 보기 — 기존 KohResultDialog 재사용(read). */}
      <KohResultDialog
        open={viewFieldData !== null}
        onOpenChange={(v) => { if (!v) setViewFieldData(null); }}
        fieldData={viewFieldData}
      />

      {/* 혈액검사 결과지 업로드/보기 — B안 파일보관(patient_file_records). */}
      {bloodTarget && (
        <BloodResultDialog
          open={bloodTarget !== null}
          onOpenChange={(v) => {
            if (!v) {
              setBloodTarget(null);
              // 업로드/삭제 반영 — 라벨(업로드↔보기) 갱신을 위해 카운트 재조회.
              qc.invalidateQueries({ queryKey: ['blood_result_counts', clinic?.id] });
            }
          }}
          customerId={bloodTarget.id}
          customerName={bloodTarget.name}
        />
      )}
    </div>
  );
}
