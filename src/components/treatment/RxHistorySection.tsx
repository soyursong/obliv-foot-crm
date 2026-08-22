// RxHistorySection.tsx — 치료테이블 [처방 이력] 탭
// Ticket: T-20260807-foot-TREATTBL-RX-HISTORY-BYDRUG-LOOKUP (P2, feature, read-only) — 최초 '약별 조회'
//   ▶ T-20260807-foot-RXHISTORY-TAB-4IMPROVE (P2, feature) — 4대 개선:
//       AC-1 월별 필터(이번달/저번달/직접입력, 기본=이번달) — 진입 즉시 이번달 목록 표출.
//       AC-2 실처방 기준 중복 자동제거 — 동일 환자·동일 교부일·동일 약품집합 = 1건(read-side dedup).
//       AC-3 성함/차트번호 클릭 → 2번차트 오픈 — 기배포 useChartNoPopup() 공통 훅 재사용.
//       AC-4 처방약 필터 대표+기타 — 선택 약 → 대표 컬럼, 함께 나간 그 외 약 → 기타 컬럼.
//   ▶ T-20260808-foot-RXHIST-HIDE-SOFTDELETE (P2, feature) — 개별 처방 건 숨김(soft-delete):
//       AC-1 각 행 '숨기기' 버튼 → 목록에서 제거(물리 DELETE 아님). AC-2 기본조회 is_deleted=false 만(영속).
//       AC-3 모든 스태프 숨김 가능(총괄 확정 Q2=A, role 게이트 없음). AC-4 감사(deleted_by/at)= DB 트리거 자동.
//       AC-5 확인 다이얼로그(오클릭 방지). 총괄 확정 스펙: 삭제방식=B.숨김(soft) / 권한=누구나.
//
// ★ canonical SSOT = form_submissions(form_key='rx_standard') = 처방전 발행/출력 이력 단일 원장.
//   DA-20260806-foot-RX-PERSIST-SSOT(Option B) / T-20260806-foot-RX-PERSIST-FORWARDFIX(deployed) 계승.
//   prescriptions·prescription_items(dead skeleton) 조회경로 신설·되살리기 금지(dual-source drift 안티패턴).
//   AC-2 "실제 약 처방 기준"은 신규 컬럼/canonical write 없이 read-side dedup 으로 충족(db_change=false).
//
// ★ 숨김(soft-delete) db_change=false — AC-0 census 결과 기존 인프라 전량 재사용:
//   form_submissions.deleted_at(단일 authority) / deleted_by / delete_reason / is_deleted(GENERATED) +
//   trg_form_submissions_body_audit(모든 UPDATE 를 form_submissions_audit_log 에 §22 감사 자동적재,
//   deleted_at NULL→NOT NULL 전이는 operation=DELETE·changed_by=auth.uid()) 는 이미 배포됨
//   (20260802150000_foot_form_submissions_softdelete_audit.sql, T-20260728-FORMSUB-DURABILITY-IMPROVE).
//   ⇒ 신규 컬럼/마이그/DA CONSULT 불요. 숨김 = UPDATE deleted_at=now(). 물리 DELETE 는 DB 트리거가 전면차단.
//   rx_standard=status 'printed'(published 아님) → immutable guard 무저촉 + update RLS(clinic 활성 스태프) 통과.
//
// PHI 안전(VG2): field_data 의 patient_rrn(주민번호)·풀 전화는 UI·엑셀 어디에도 노출 금지.
//   성함·차트번호·customer_id(내부 UUID)만 화이트리스트(스태프 대상 role-gated 치료테이블).
//
// write 범위: 숨김(soft-delete) UPDATE 1종만(deleted_at/by). hard-DELETE 0 / DDL 0 / 원장(payments·service_charges) 무접촉.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Loader2,
  Pill,
  ChevronRight,
  ChevronDown,
  Download,
  Info,
  CalendarDays,
  EyeOff,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { formatDateDots, chartNoBadge } from '@/lib/format';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useChartNoPopup, CHARTNO_LINK_CLASS } from '@/hooks/useChartNoPopup';
import {
  RX_ISSUANCE_FORM_KEY,
  mapRxIssuancePatientRows,
  collectDistinctMedications,
  filterRxRowsByMedications,
  filterRxRowsByDateRange,
  dedupeRxIssuanceRows,
  sortRxRowsByIssuedDateDesc,
  splitRepresentativeMedications,
  buildRxDrugMasterIndex,
  filterMedicationsByRxMaster,
  type RxIssuancePatientRow,
  type RawFormSubmissionWithCustomerRow,
} from '@/lib/rxIssuanceHistory';
import { fetchRxDrugMaster, type ServiceRxDrug } from '@/lib/prescribableDrugs';
import { downloadRxHistoryExcel, rxHistoryExportFilename } from '@/lib/rxHistoryExport';
// T-20260822-foot-RX-NOTATION-FORMAT-CANONICAL-SPEC (AC-5): 조회화면 약품명 표시 SSOT.
import { displayRxName } from '@/lib/rxCanonical';

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

/**
 * T-20260809-foot-RXHIST-DRUGLIST-PRESCRIBED-ONLY-FILTER (AC-1) — 처방약 마스터(교차검증 축) 로드.
 *   services(category_label='처방약') 전건. read-only 1건(발행이력 축과 직교·AC-3 무저촉).
 */
function useRxDrugMaster(clinicId: string | undefined) {
  return useQuery<ServiceRxDrug[]>({
    queryKey: ['rx_drug_master', clinicId],
    enabled: !!clinicId,
    queryFn: () => fetchRxDrugMaster(clinicId as string),
    staleTime: 5 * 60_000,
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
        {/* AC-5: 처방전 조회 약품명 = displayRxName SSOT(원본 verbatim, 축약·순서변형 0). */}
        <span data-testid="rxhist-detail-medications">
          {row.medications.length > 0 ? row.medications.map((m) => displayRxName(m)).join(', ') : '—'}
        </span>
      </div>
    </div>
  );
}

/** dedup 파이프라인 산출 행(대표 + 병합 sibling id). 숨김은 member_ids 전량 대상. */
type RxHistoryRow = RxIssuancePatientRow & { dup_count: number; member_ids: string[] };

export default function RxHistorySection() {
  const clinic = useClinic();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: allRows = [], isLoading, isError } = useRxIssuanceHistory(clinic?.id);
  // T-20260809-foot-RXHIST-DRUGLIST-PRESCRIBED-ONLY-FILTER: 처방약 마스터(드롭다운 옵션 교차검증 축, AC-1).
  const { data: rxDrugMaster } = useRxDrugMaster(clinic?.id);
  // AC-3: 성함/차트번호 클릭 → 2번차트 팝업(공통 훅, openChart 게이트웨이 재사용).
  const openChartNo = useChartNoPopup();

  // T-20260808-foot-RXHIST-HIDE-SOFTDELETE — 숨김 확인 대상(오클릭 방지, AC-5). null=다이얼로그 닫힘.
  const [hideTarget, setHideTarget] = useState<RxHistoryRow | null>(null);

  // 숨김(soft-delete) mutation — deleted_at/by 마킹. 물리 DELETE 아님(DB 트리거가 hard-DELETE 전면차단).
  //   대상 = member_ids 전량(동일 교부번호 재출력 sibling 포함) → refetch 후 되살아남 방지(AC-2 영속).
  //   감사(누가·언제)는 trg_form_submissions_body_audit 가 form_submissions_audit_log 에 자동 적재(§22).
  const hideMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      // cross-CRM Write Rows-Affected 표준: .select() 로 실제 반영 행 검증(RLS 거부 시 0-row+error=null 사일런트 유실 차단).
      const { data, error } = await supabase
        .from('form_submissions')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: profile?.id ?? null,
        })
        .in('id', ids)
        .eq('is_deleted', false) // 이미 숨겨진 행 재마킹 방지(멱등)
        .select('id');
      if (error) throw error;
      const affected = data?.length ?? 0;
      if (affected === 0) {
        // 반영 0 = RLS 거부/이미 숨김/권한 부족 등 → 사일런트 성공 오인 차단.
        throw new Error('숨김 처리가 반영되지 않았습니다(권한 또는 상태 확인).');
      }
      return affected;
    },
    onSuccess: () => {
      toast('처방이력을 숨겼습니다.');
      queryClient.invalidateQueries({ queryKey: ['rx_issuance_history_bydrug'] });
      setHideTarget(null);
    },
    onError: (e: unknown) => {
      toast(e instanceof Error ? e.message : '숨김 처리에 실패했습니다.');
    },
  });

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

  // T-20260809-foot-RXHIST-DRUGLIST-PRESCRIBED-ONLY-FILTER (AC-1): 약 드롭다운 옵션을 처방약 마스터와
  //   교차검증(코드/약품명 양축) → 비처방약 라인(진찰료·검사·상병) 제외. 결과목록/dedup/필터는 무회귀(AC-4).
  //   ★ fail-open 가드: 마스터 미로드/0건이면 전체 옵션 노출(대량 오제외 방지, AC-6). 로드 후에만 필터 적용.
  const { kept: keptMeds, excluded: excludedMeds } = useMemo(() => {
    if (!rxDrugMaster || rxDrugMaster.length === 0) {
      return { kept: medications, excluded: [] as string[] };
    }
    const index = buildRxDrugMasterIndex(rxDrugMaster);
    return filterMedicationsByRxMaster(medications, index);
  }, [medications, rxDrugMaster]);

  // AC-6 (b): 처방약 마스터 미매칭으로 제외된 토큰을 dev-side 로그로 수집 →
  //   deploy-ready evidence + supervisor QA/field-soak '정상 약 오제외 없는지' 육안검증 근거.
  useEffect(() => {
    if (excludedMeds.length > 0) {
      console.info(
        `[RXHIST-DRUGLIST-FILTER] 처방약 마스터(services category_label='처방약') 미매칭으로 드롭다운에서 제외된 토큰 ${excludedMeds.length}건:`,
        excludedMeds,
      );
    }
  }, [excludedMeds]);

  const drugOptions = useMemo(() => keptMeds.map((m) => ({ value: m, label: m })), [keptMeds]);

  // 파이프라인: 기간 필터(AC-1) → 실처방 dedup(AC-2) → 약품 필터(AC-4, 선택 시)
  //   → 처방일자(교부일) 내림차순 안정 정렬(T-20260809-RXHIST-PATIENTLIST-DATESORT AC-1).
  //   dedup 은 Map 삽입순(printed_at 축)이라 화면 '일자' 컬럼(issued_at)과 어긋날 수 있어 마지막에 명시 재정렬.
  const rows = useMemo(() => {
    const byDate = filterRxRowsByDateRange(allRows, range.from, range.to);
    const deduped = dedupeRxIssuanceRows(byDate);
    const filtered =
      selectedMeds.length > 0 ? filterRxRowsByMedications(deduped, selectedMeds) : deduped;
    return sortRxRowsByIssuedDateDesc(filtered);
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
                {/* T-20260808-foot-RXHIST-HIDE-SOFTDELETE: 개별 건 숨기기(soft-delete) 액션 열 */}
                <th className="px-3 py-2 text-right font-medium w-20">관리</th>
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
                      {/* T-20260808-foot-RXHIST-HIDE-SOFTDELETE: 숨기기(soft-delete) 버튼.
                          stopPropagation 으로 행 펼침(toggle) 충돌 방지. 클릭 → 확인 다이얼로그(AC-5). */}
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-gray-500 hover:text-red-600"
                          data-testid="rx-history-hide-btn"
                          title="이 처방이력을 목록에서 숨깁니다(기록은 보존)"
                          onClick={(e) => {
                            e.stopPropagation();
                            setHideTarget(r);
                          }}
                        >
                          <EyeOff className="size-4 mr-1" />
                          숨기기
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t">
                        <td colSpan={hasSelection ? 5 : 4} className="p-0">
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

      {/* T-20260808-foot-RXHIST-HIDE-SOFTDELETE: 숨김 확인 다이얼로그(AC-5 오클릭 방지).
          '숨기기' 확정 시 member_ids 전량 soft-delete(재출력 sibling 포함) → 목록 영속 제거. '취소' 시 무변경. */}
      <Dialog open={!!hideTarget} onOpenChange={(o) => !o && setHideTarget(null)}>
        <DialogContent className="max-w-sm" data-testid="rx-history-hide-dialog">
          <DialogHeader>
            <DialogTitle>처방이력 숨기기</DialogTitle>
            <DialogDescription>
              {hideTarget?.patient_name ?? '이'} 님의 처방이력{' '}
              {hideTarget?.issued_at ? `(${formatDateDots(hideTarget.issued_at)})` : ''} 을(를)
              목록에서 숨기시겠습니까?
              <br />
              기록은 삭제되지 않고 보존되며, 목록에서만 보이지 않게 됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHideTarget(null)}
              disabled={hideMutation.isPending}
              data-testid="rx-history-hide-cancel"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => hideTarget && hideMutation.mutate(hideTarget.member_ids)}
              disabled={hideMutation.isPending}
              data-testid="rx-history-hide-confirm"
            >
              {hideMutation.isPending ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" /> 숨기는 중…
                </>
              ) : (
                '숨기기'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
