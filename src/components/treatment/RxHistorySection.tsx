// RxHistorySection.tsx — 치료테이블 [처방 이력] 탭
// Ticket: T-20260807-foot-TREATTBL-RX-HISTORY-BYDRUG-LOOKUP (P2, feature, read-only) — 최초 '약별 조회'
//   ▶ T-20260807-foot-RXHISTORY-TAB-4IMPROVE (P2, feature) — 4대 개선:
//       AC-1 월별 필터(이번달/저번달/직접입력, 기본=이번달) — 진입 즉시 이번달 목록 표출.
//       AC-2 실처방 기준 중복 자동제거 — 동일 환자·동일 교부일·동일 약품집합 = 1건(read-side dedup).
//       AC-3 성함/차트번호 클릭 → 2번차트 오픈 — 기배포 useChartNoPopup() 공통 훅 재사용.
//       AC-4 처방약 필터 대표+기타 — 선택 약 → 대표 컬럼, 함께 나간 그 외 약 → 기타 컬럼.
//
// ★ canonical SSOT = form_submissions(form_key='rx_standard') = 처방전 발행/출력 이력 단일 원장.
//   DA-20260806-foot-RX-PERSIST-SSOT(Option B) / T-20260806-foot-RX-PERSIST-FORWARDFIX(deployed) 계승.
//   prescriptions·prescription_items(dead skeleton) 조회경로 신설·되살리기 금지(dual-source drift 안티패턴).
//   AC-2 "실제 약 처방 기준"은 신규 컬럼/canonical write 없이 read-side dedup 으로 충족(db_change=false).
//
// PHI 안전(VG2): field_data 의 patient_rrn(주민번호)·풀 전화는 UI·엑셀 어디에도 노출 금지.
//   성함·차트번호·customer_id(내부 UUID)만 화이트리스트(스태프 대상 role-gated 치료테이블).
//
// read-only: SELECT·투영·집계·export 만. write 0 / DDL 0 / DML 0. mutate 경로 없음.

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Pill, ChevronRight, ChevronDown, Download, Info, CalendarDays } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatDateDots, chartNoBadge } from '@/lib/format';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { useChartNoPopup, CHARTNO_LINK_CLASS } from '@/hooks/useChartNoPopup';
import {
  RX_ISSUANCE_FORM_KEY,
  mapRxIssuancePatientRows,
  collectDistinctMedications,
  filterRxRowsByMedications,
  filterRxRowsByDateRange,
  dedupeRxIssuanceRows,
  splitRepresentativeMedications,
  type RxIssuancePatientRow,
  type RawFormSubmissionWithCustomerRow,
} from '@/lib/rxIssuanceHistory';
import { downloadRxHistoryExcel, rxHistoryExportFilename } from '@/lib/rxHistoryExport';

/** 발행 이력 조회 상한(전체 발행 494건 규모 — DA-20260806 기준). read-only 목록 조회. */
const RX_HISTORY_LIMIT = 2000;

/** clinic 범위 rx_standard 발행 이력 전량(+customer_id·customers 임베드) → RxIssuancePatientRow[]. read-only. */
function useRxIssuanceHistory(clinicId: string | undefined) {
  return useQuery<RxIssuancePatientRow[]>({
    queryKey: ['rx_issuance_history_bydrug', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      // VG1: form_templates!inner(form_key='rx_standard') 로 처방전만(소견서/KOH/진단서 혼입 0).
      // VG3: form_submissions(발행 이력 축)만 — prescription_items(처방 기록 축) 조인 0.
      // customer_id(2번차트 오픈용 UUID) + customers(name, chart_number) = 표시/링크 화이트리스트. RRN·전화 미조회.
      const { data, error } = await supabase
        .from('form_submissions')
        .select(
          'id, customer_id, printed_at, created_at, field_data, form_templates!inner(form_key), customers(name, chart_number)',
        )
        .eq('clinic_id', clinicId)
        .eq('is_deleted', false)
        .eq('form_templates.form_key', RX_ISSUANCE_FORM_KEY)
        .order('printed_at', { ascending: false, nullsFirst: false })
        .limit(RX_HISTORY_LIMIT);
      if (error) throw error;
      return mapRxIssuancePatientRows((data ?? []) as unknown as RawFormSubmissionWithCustomerRow[]);
    },
    refetchInterval: 60_000,
  });
}

// ── AC-1 월별 필터 프리셋 ─────────────────────────────────────────────────────
type MonthPreset = 'thisMonth' | 'lastMonth' | 'custom';
const fmtDate = (d: Date) => format(d, 'yyyy-MM-dd');

function presetRange(preset: Exclude<MonthPreset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  if (preset === 'thisMonth') return { from: fmtDate(startOfMonth(now)), to: fmtDate(endOfMonth(now)) };
  const lm = subMonths(now, 1);
  return { from: fmtDate(startOfMonth(lm)), to: fmtDate(endOfMonth(lm)) };
}

/** 처방이력 드롭(펼침) 세부 내역 — 화이트리스트 grain(교부일·처방의료인·진단·교부번호·약품명). */
function RxDetail({ row }: { row: RxIssuancePatientRow }) {
  return (
    <div className="bg-teal-50/60 px-4 py-3 text-[12px] text-gray-700 space-y-1">
      <div>
        <span className="text-gray-500">교부일</span>{' '}
        {row.issued_at ? formatDateDots(row.issued_at) : '—'}
      </div>
      <div>
        <span className="text-gray-500">처방의료인</span> {row.prescriber_name ?? '—'}
      </div>
      <div>
        <span className="text-gray-500">진단</span> {row.diagnosis ?? '—'}
      </div>
      <div>
        <span className="text-gray-500">교부번호</span> {row.issue_no ?? '—'}
      </div>
      <div>
        <span className="text-gray-500">처방약품</span>{' '}
        {row.medications.length > 0 ? row.medications.join(', ') : '—'}
      </div>
    </div>
  );
}

export default function RxHistorySection() {
  const clinic = useClinic();
  const { data: allRows = [], isLoading, isError } = useRxIssuanceHistory(clinic?.id);
  // AC-3: 성함/차트번호 클릭 → 2번차트 팝업(공통 훅, openChart 게이트웨이 재사용).
  const openChartNo = useChartNoPopup();

  // AC-1 월별 필터 — 기본 = 이번달.
  const [preset, setPreset] = useState<MonthPreset>('thisMonth');
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>(() =>
    presetRange('thisMonth'),
  );
  const range = preset === 'custom' ? customRange : presetRange(preset);

  // AC-4: 처방약 필터(선택 = 대표 컬럼, 나머지 = 기타 컬럼). 미선택이면 통합 표시(기본 목록).
  const [selectedMeds, setSelectedMeds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const medications = useMemo(() => collectDistinctMedications(allRows), [allRows]);
  const drugOptions = useMemo(() => medications.map((m) => ({ value: m, label: m })), [medications]);

  // 파이프라인: 기간 필터(AC-1) → 실처방 dedup(AC-2) → 약품 필터(AC-4, 선택 시).
  const rows = useMemo(() => {
    const byDate = filterRxRowsByDateRange(allRows, range.from, range.to);
    const deduped = dedupeRxIssuanceRows(byDate);
    return selectedMeds.length > 0 ? filterRxRowsByMedications(deduped, selectedMeds) : deduped;
  }, [allRows, range.from, range.to, selectedMeds]);

  const hasSelection = selectedMeds.length > 0;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handlePreset = (p: MonthPreset) => {
    setPreset(p);
    setExpanded(new Set());
    if (p !== 'custom') setCustomRange(presetRange(p));
  };

  const canDownload = rows.length > 0;
  const handleDownload = () => {
    if (rows.length === 0) {
      toast('조회 결과가 없습니다');
      return;
    }
    downloadRxHistoryExcel(rows, rxHistoryExportFilename(selectedMeds));
  };

  const PRESETS: { key: MonthPreset; label: string }[] = [
    { key: 'thisMonth', label: '이번달' },
    { key: 'lastMonth', label: '저번달' },
    { key: 'custom', label: '직접입력' },
  ];

  return (
    <div className="space-y-3" data-testid="rx-history-section">
      {/* AC-1 월별 필터 바 */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2"
        data-testid="rx-history-month-filter"
      >
        <CalendarDays className="size-4 shrink-0 text-teal-600" />
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            data-testid={`rx-history-preset-${p.key}`}
            onClick={() => handlePreset(p.key)}
            className={cn(
              'rounded px-3 py-1.5 text-[13px] font-medium transition-colors',
              preset === p.key ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-muted',
            )}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' ? (
          <div className="flex items-center gap-1">
            <Input
              type="date"
              data-testid="rx-history-date-from"
              value={customRange.from}
              max={customRange.to}
              onChange={(e) => {
                setCustomRange((r) => ({ ...r, from: e.target.value }));
                setExpanded(new Set());
              }}
              className="h-8 w-36 text-xs"
            />
            <span className="text-xs text-gray-400">~</span>
            <Input
              type="date"
              data-testid="rx-history-date-to"
              value={customRange.to}
              min={customRange.from}
              onChange={(e) => {
                setCustomRange((r) => ({ ...r, to: e.target.value }));
                setExpanded(new Set());
              }}
              className="h-8 w-36 text-xs"
            />
          </div>
        ) : (
          <span className="text-xs text-gray-400">
            {range.from} ~ {range.to}
          </span>
        )}
      </div>

      {/* AC-4 처방약 필터 바 + 엑셀 다운로드 */}
      <div className="flex flex-wrap items-center gap-2">
        <Pill className="size-4 text-teal-600" />
        <span className="text-[13px] font-medium text-gray-700">처방약</span>
        <div className="w-72">
          <MultiSelect
            options={drugOptions}
            value={selectedMeds}
            onChange={(next) => {
              setSelectedMeds(next);
              setExpanded(new Set());
            }}
            placeholder="약 선택(선택 시 대표/기타 분리 · 미선택=전체)"
            data-testid="rx-history-drug-select"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* T-20260807-foot-RXHIST-RESULT-COUNT-DISPLAY: 조회 결과 총 건수(대표+dedup 반영, 화면 렌더 행 수와 일치·AC-5).
              rows = 기간(AC-1)→dedup(AC-2)→약품 합집합 필터(AC-4)까지 반영된 최종 파생 배열 →
              약 선택 변경/복수선택 시 useMemo 재계산으로 실시간 갱신(AC-2·AC-3). read-side 파생, DB 무접촉. */}
          {!isLoading && !isError && (
            <span
              className="text-[13px] font-medium text-gray-700"
              data-testid="rx-history-result-count"
            >
              총 <span className="font-semibold text-teal-700">{rows.length}</span>건
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={!canDownload}
            data-testid="rx-history-excel-download"
          >
            <Download className="size-4 mr-1.5" />
            엑셀 다운로드
          </Button>
        </div>
      </div>

      {/* 조회 테이블 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="size-5 animate-spin mr-2" /> 불러오는 중…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-16 text-red-500 text-[13px]">
          처방 이력을 불러오지 못했습니다.
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex items-center justify-center gap-2 py-16 text-gray-400 text-[13px]"
          data-testid="rx-history-empty"
        >
          <Info className="size-4" /> 해당 기간의 처방 이력이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-[13px]" data-testid="rx-history-table">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-[12px]">
                <th className="px-3 py-2 text-left font-medium w-32">일자</th>
                <th className="px-3 py-2 text-left font-medium">성함 / 차트번호</th>
                {hasSelection ? (
                  <>
                    <th className="px-3 py-2 text-left font-medium">처방약(대표)</th>
                    <th className="px-3 py-2 text-left font-medium">기타</th>
                  </>
                ) : (
                  <th className="px-3 py-2 text-left font-medium">처방이력</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded.has(r.id);
                const { representative, others } = splitRepresentativeMedications(
                  r.medications,
                  selectedMeds,
                );
                const canOpenChart = !!r.customer_id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="border-t hover:bg-teal-50/40 cursor-pointer"
                      onClick={() => toggle(r.id)}
                      data-testid="rx-history-row"
                    >
                      <td className="px-3 py-2">
                        <span>{r.issued_at ? formatDateDots(r.issued_at) : '—'}</span>
                        {/* T-20260807-foot-RXHIST-BARTOVEN-QTY2-DEDUP-DISPLAY: 동일 교부번호 재출력 병합 건수 표기.
                            dedup 은 이제 교부번호(issue_no) 단위 → 서로 다른 발행은 각 행으로 표시(과수렴 해소).
                            dup_count>1 = 동일 문서 재출력 N회 → 사실 소실 방지 위해 배지로 노출. */}
                        {r.dup_count > 1 && (
                          <span
                            className="ml-1.5 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
                            data-testid="rx-history-reprint-badge"
                            title="동일 교부번호 처방전 재출력 횟수"
                          >
                            재출력 {r.dup_count}회
                          </span>
                        )}
                      </td>
                      {/* AC-3: 성함·차트번호 클릭 → 2번차트(공통 훅 재사용, stopPropagation 으로 행 펼침 충돌 방지). */}
                      <td className="px-3 py-2">
                        <span
                          className={cn('font-medium', canOpenChart && CHARTNO_LINK_CLASS)}
                          role={canOpenChart ? 'button' : undefined}
                          data-testid="rx-history-name-open"
                          data-chartno-popup={canOpenChart ? '1' : undefined}
                          onClick={
                            canOpenChart ? (e) => openChartNo(r.customer_id, e) : undefined
                          }
                        >
                          {r.patient_name ?? '—'}
                        </span>
                        <span
                          className={cn('ml-1.5 text-gray-400', canOpenChart && CHARTNO_LINK_CLASS)}
                          role={canOpenChart ? 'button' : undefined}
                          data-testid="rx-history-chartno-open"
                          data-chartno-popup={canOpenChart ? '1' : undefined}
                          onClick={
                            canOpenChart ? (e) => openChartNo(r.customer_id, e) : undefined
                          }
                        >
                          {chartNoBadge(r.chart_number)}
                        </span>
                      </td>
                      {hasSelection ? (
                        <>
                          <td className="px-3 py-2" data-testid="rx-history-rep-cell">
                            <span className="inline-flex items-center gap-1 text-teal-700">
                              {isOpen ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                              {representative.length > 0 ? representative.join(', ') : '—'}
                            </span>
                          </td>
                          <td
                            className="px-3 py-2 text-gray-600"
                            data-testid="rx-history-others-cell"
                          >
                            {others.length > 0 ? others.join(', ') : '—'}
                          </td>
                        </>
                      ) : (
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 text-teal-700">
                            {isOpen ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                            {r.medications.length > 0
                              ? r.medications.join(', ')
                              : '처방약품 정보 없음'}
                          </span>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="border-t">
                        <td colSpan={hasSelection ? 4 : 3} className="p-0">
                          <RxDetail row={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
