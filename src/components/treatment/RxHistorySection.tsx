// RxHistorySection.tsx — 치료테이블 [처방 이력] 탭 = '약별 처방 환자 조회'(read-only)
// Ticket: T-20260807-foot-TREATTBL-RX-HISTORY-BYDRUG-LOOKUP (P2, feature, read-only)
//
// 배경: 2026-07 바르토벤외용액 처방 이력 조회 시 CRM에 약별 조회 기능이 없어 매번 수동 DB 조회 필요
//   → 김주연 총괄 요청. CRM 안에서 직접 '약별 처방 환자'를 조회하도록 제품화.
//
// ★ canonical SSOT = form_submissions(form_key='rx_standard') = 처방전 발행 이력 단일 원장.
//   DA-20260806-foot-RX-PERSIST-SSOT(Option B) / T-20260806-foot-RX-PERSIST-FORWARDFIX(deployed) 계승.
//   prescriptions·prescription_items(dead skeleton) 조회경로 신설·되살리기 금지(dual-source drift 안티패턴).
//   투영은 rxIssuanceHistory.ts(발행 이력 축 헬퍼) 재사용/확장 — 처방 기록 축(medical_charts.prescription_items) 조인 0.
//
// PHI 안전(VG2): field_data 의 patient_rrn(주민번호)·풀 전화는 UI·엑셀 어디에도 노출 금지.
//   성함·차트번호만 화이트리스트 추가(스태프 대상 role-gated 치료테이블 — 고객목록 export 동일 기준).
//
// read-only: SELECT·투영·export 만. write 0 / DDL 0 / DML 0. mutate 경로 없음.

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Pill, ChevronRight, ChevronDown, Download, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { formatDateDots, chartNoBadge } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  RX_ISSUANCE_FORM_KEY,
  mapRxIssuancePatientRows,
  collectDistinctMedications,
  filterRxRowsByMedication,
  type RxIssuancePatientRow,
  type RawFormSubmissionWithCustomerRow,
} from '@/lib/rxIssuanceHistory';
import { downloadRxHistoryExcel, rxHistoryExportFilename } from '@/lib/rxHistoryExport';

/** 발행 이력 조회 상한(전체 발행 494건 규모 — DA-20260806 기준). read-only 목록 조회. */
const RX_HISTORY_LIMIT = 2000;

/** clinic 범위 rx_standard 발행 이력 전량(+customers 임베드) → RxIssuancePatientRow[]. read-only. */
function useRxIssuanceHistory(clinicId: string | undefined) {
  return useQuery<RxIssuancePatientRow[]>({
    queryKey: ['rx_issuance_history_bydrug', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      // VG1: form_templates!inner(form_key='rx_standard') 로 처방전만(소견서/KOH/진단서 혼입 0).
      // VG3: form_submissions(발행 이력 축)만 — prescription_items(처방 기록 축) 조인 0.
      // customers(name, chart_number) = 표시 화이트리스트(성함·차트번호). RRN·전화 미조회.
      const { data, error } = await supabase
        .from('form_submissions')
        .select(
          'id, printed_at, created_at, field_data, form_templates!inner(form_key), customers(name, chart_number)',
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

  const [selectedMed, setSelectedMed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const medications = useMemo(() => collectDistinctMedications(allRows), [allRows]);
  const rows = useMemo(
    () => filterRxRowsByMedication(allRows, selectedMed),
    [allRows, selectedMed],
  );

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const canDownload = !!selectedMed && rows.length > 0;
  const handleDownload = () => {
    if (!selectedMed) {
      toast('약을 먼저 선택하세요');
      return;
    }
    if (rows.length === 0) {
      toast('조회 결과가 없습니다');
      return;
    }
    downloadRxHistoryExcel(rows, rxHistoryExportFilename(selectedMed));
  };

  return (
    <div className="space-y-3" data-testid="rx-history-section">
      {/* 필터 바 — 약 드롭다운 + 엑셀 다운로드 */}
      <div className="flex flex-wrap items-center gap-2">
        <Pill className="size-4 text-teal-600" />
        <span className="text-[13px] font-medium text-gray-700">처방약</span>
        <Select
          value={selectedMed ?? ''}
          onValueChange={(v) => {
            setSelectedMed(v || null);
            setExpanded(new Set());
          }}
        >
          <SelectTrigger className="w-64" data-testid="rx-history-drug-select">
            <SelectValue placeholder="약을 선택하세요" />
          </SelectTrigger>
          <SelectContent>
            {medications.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto">
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
      ) : !selectedMed ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400 text-[13px]">
          <Info className="size-4" /> 약을 선택하면 해당 약을 처방받은 환자 목록이 표시됩니다.
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex items-center justify-center py-16 text-gray-400 text-[13px]"
          data-testid="rx-history-empty"
        >
          조회 결과 없음
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-[13px]" data-testid="rx-history-table">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-[12px]">
                <th className="px-3 py-2 text-left font-medium w-32">일자</th>
                <th className="px-3 py-2 text-left font-medium">성함 / 차트번호</th>
                <th className="px-3 py-2 text-left font-medium">처방이력</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="border-t hover:bg-teal-50/40 cursor-pointer"
                      onClick={() => toggle(r.id)}
                      data-testid="rx-history-row"
                    >
                      <td className="px-3 py-2">
                        {r.issued_at ? formatDateDots(r.issued_at) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{r.patient_name ?? '—'}</span>
                        <span className="ml-1.5 text-gray-400">
                          {chartNoBadge(r.chart_number)}
                        </span>
                      </td>
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
                    </tr>
                    {isOpen && (
                      <tr className="border-t">
                        <td colSpan={3} className="p-0">
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
