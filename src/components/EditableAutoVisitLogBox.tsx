// T-20260809-foot-PENCHART-EDITABLE-INCHARTFORM-REWORK
// 펜차트(자동기록용) — 방문일별 치료내역 자동집계 로그의 수정·저장·출력 가능 편집형(초록박스).
//
// parent(T-20260808-...-2CHART, READ-ONLY 별도 탭) supersede: 별도 탭 폐지 → 새 차트 작성 양식(펜차트 탭) 내부 초록박스로 이동.
//
// 저장방식(DA-REPLY GO MSG-20260809-094535-db57): form_submissions.field_data JSONB 재사용.
//   template_id=NULL + field_data.form_key='penchart_auto_visit_log' (blood_reception_daily 등 내부 상태 레코드 동일 패턴).
//   신규 테이블/컬럼 0 · ADDITIVE · db_change=false.
//
// HARD verify-gate(DA) 준수:
//   VG1: overlay ONLY — package_sessions/packages ledger write-back 0(counting/comp/KPI 는 항상 package_sessions read).
//   VG2: 편집본 존재→overlay 우선, 부재→package_sessions 파생 seed(seed 경로 보존).
//   VG3: form_key insert 누적 + rows-affected 검증(silent 0-row write 금지).
//   VG4: raw full RRN field_data 미저장(at-rest 금지) · print-time 마스킹 렌더.
//   VG5: note(급여/비급여 수동입력) = 문서 표시 주석 ONLY — canonical 매출 split 아님.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Printer, Plus, Trash2 } from 'lucide-react';
import { deriveGenderFromRRN } from '@/lib/rrn';
import {
  PENCHART_AUTO_VISIT_LOG_FORM_KEY,
  isAutoVisitLogEligible,
  seedEditableRows,
  resolveEffectiveRows,
  buildAutoVisitLogPrintHtml,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
  type EditableVisitLogRow,
  type PenchartAutoVisitLogFieldData,
} from '@/lib/autoVisitLog';
import { formatDateTimeDots } from '@/lib/format';

type Props = {
  packages: AutoVisitLogPackage[];
  packageSessions: AutoVisitLogSession[];
  clinicId: string;
  customerId: string;
  checkInId?: string | null;
  customerName: string;
  customerChartNumber?: string | null;
  /** 인메모리 canonical RRN — 마스킹/성별 파생 전용, field_data 에 저장하지 않는다(VG4). */
  customerRrn?: string | null;
};

/** VG2 reader: 최신 편집본(overlay) 1건 로드. 없으면 null(seed 폴백). */
function useOverlay(clinicId: string, customerId: string) {
  return useQuery<EditableVisitLogRow[] | null>({
    queryKey: ['penchart_auto_visit_log', clinicId, customerId],
    enabled: !!clinicId && !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .contains('field_data', { form_key: PENCHART_AUTO_VISIT_LOG_FORM_KEY })
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) {
        // 테이블/컬럼 미적용 prod 는 seed 폴백(무파손). 그 외는 throw(silent-empty 재발 방지).
        if (/form_submissions|relation|42P01|42703|is_deleted/.test(error.message ?? '')) return null;
        throw error;
      }
      const row = (data ?? [])[0] as { field_data: unknown } | undefined;
      if (!row) return null;
      const fd = (row.field_data ?? {}) as Partial<PenchartAutoVisitLogFieldData>;
      return Array.isArray(fd.rows) ? (fd.rows as EditableVisitLogRow[]) : null;
    },
    staleTime: 30_000,
  });
}

export function EditableAutoVisitLogBox({
  packages,
  packageSessions,
  clinicId,
  customerId,
  checkInId,
  customerName,
  customerChartNumber,
  customerRrn,
}: Props) {
  const qc = useQueryClient();
  const eligible = useMemo(
    () => isAutoVisitLogEligible(packages, packageSessions),
    [packages, packageSessions],
  );
  const seed = useMemo(
    () => seedEditableRows(packages, packageSessions),
    [packages, packageSessions],
  );

  const overlayQuery = useOverlay(clinicId, customerId);
  const [rows, setRows] = useState<EditableVisitLogRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // overlay 로드 완료/seed 변동 시 baseline 재동기화(사용자 미편집 상태에서만 — 편집 중 유실 방지).
  useEffect(() => {
    if (dirtyRef.current) return;
    if (overlayQuery.isLoading) return;
    setRows(resolveEffectiveRows(overlayQuery.data, seed));
  }, [overlayQuery.data, overlayQuery.isLoading, seed]);

  const updateCell = (idx: number, field: keyof EditableVisitLogRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
    setDirty(true);
  };
  const addRow = () => {
    setRows((prev) => [
      { key: `manual-${prev.length}-${prev.reduce((a, r) => a + r.key.length, 0)}`, date: '', packageContent: '', todayCount: '', therapists: '', note: '' },
      ...prev,
    ]);
    setDirty(true);
  };
  const deleteRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const fieldData: PenchartAutoVisitLogFieldData = {
        form_key: PENCHART_AUTO_VISIT_LOG_FORM_KEY,
        saved_at: new Date().toISOString(),
        rows, // VG4: PHI(raw RRN) 미포함 — 방문기록 표시 데이터만.
      };
      // VG3: insert 누적 + rows-affected 검증(.select 반환 1행 확인, silent 0-row write 차단).
      const { data, error } = await supabase
        .from('form_submissions')
        .insert({
          clinic_id: clinicId,
          customer_id: customerId,
          check_in_id: checkInId ?? null,
          template_id: null, // 내부 상태 레코드(발행 이력 목록 자동 제외 — issuanceHistory isPrintableSubmission).
          field_data: fieldData,
          status: 'draft',
        })
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        // RLS 거부/스코프 불일치 시 error=null·0-row 가능 → 성공 오인 차단(VG3).
        throw new Error('저장 결과가 확인되지 않았습니다(0행). 권한/스코프를 확인하세요.');
      }
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['penchart_auto_visit_log', clinicId, customerId] });
      toast.success('펜차트(자동기록용) 저장 완료');
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    // VG4: print-time canonical 조인(이름·차트번호) + RRN 마스킹 렌더. raw RRN 은 HTML 에 미삽입.
    const genderLabel = deriveGenderFromRRN(customerRrn);
    const html = buildAutoVisitLogPrintHtml({
      customerName,
      chartNumber: customerChartNumber ?? null,
      rrn: customerRrn ?? null,
      genderLabel,
      rows,
      printedAt: formatDateTimeDots(new Date()),
    });
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) {
      toast.warning('팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도하세요.');
      return;
    }
    win.document.open();
    win.document.write(
      `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>펜차트(자동기록용)</title>` +
        `<style>` +
        `@page { size: A4 portrait; margin: 12mm; }` +
        `html,body{margin:0;font-family:'Malgun Gothic','맑은 고딕',sans-serif;color:#111;}` +
        `.pc-wrap{padding:0;}` +
        `h1{font-size:18px;margin:0 0 10px;}` +
        `.meta{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;margin-bottom:10px;color:#333;}` +
        `.meta .g{color:#555;}` +
        `table.pc-table{width:100%;border-collapse:collapse;font-size:12px;}` +
        `table.pc-table th,table.pc-table td{border:1px solid #999;padding:5px 7px;text-align:left;}` +
        `table.pc-table th{background:#f0fdf4;}` +
        `td.empty{text-align:center;color:#777;padding:18px;}` +
        `</style></head><body>${html}` +
        `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script></body></html>`,
    );
    win.document.close();
  };

  // AC-4: 1회권 이상 패키지 + 치료 진행 환자만 대상. 비대상 → 안내(에러 없음).
  if (!eligible) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-xs" data-testid="penchart-auto-visit-log-box">
        <div className="flex items-center gap-1.5 font-bold text-emerald-800 mb-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          펜차트(자동기록용)
        </div>
        <div className="py-5 text-center text-muted-foreground border border-dashed border-emerald-200 rounded" data-testid="penchart-auto-visit-log-not-eligible">
          1회권 이상 패키지 생성 후 치료 진행 환자만 자동 기록 대상입니다.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50/50 p-3 text-xs" data-testid="penchart-auto-visit-log-box">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 font-bold text-emerald-800">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          펜차트(자동기록용)
          <span className="ml-1 text-[10px] font-normal text-emerald-600">방문일별 치료내역 · 수정·저장·출력 가능</span>
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] px-2.5 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
            onClick={addRow}
            data-testid="penchart-auto-visit-log-addrow"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> 행 추가
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] px-2.5 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
            onClick={handlePrint}
            data-testid="penchart-auto-visit-log-print"
          >
            <Printer className="h-3.5 w-3.5 mr-1" /> 출력
          </Button>
          <Button
            size="sm"
            className="h-7 text-[11px] px-3 bg-emerald-600 hover:bg-emerald-700"
            onClick={handleSave}
            disabled={saving || !dirty}
            data-testid="penchart-auto-visit-log-save"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            저장
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-emerald-200 bg-white">
        <table className="w-full border-collapse" data-testid="penchart-auto-visit-log-table">
          <thead>
            <tr className="bg-emerald-100/60 text-emerald-900">
              <th className="text-left px-2 py-1.5 font-medium border-b border-emerald-200 whitespace-nowrap">일자</th>
              <th className="text-left px-2 py-1.5 font-medium border-b border-emerald-200 whitespace-nowrap">패키지내용</th>
              <th className="text-left px-2 py-1.5 font-medium border-b border-emerald-200 whitespace-nowrap">금일 치료 횟수</th>
              <th className="text-left px-2 py-1.5 font-medium border-b border-emerald-200 whitespace-nowrap">차감치료사</th>
              <th className="text-left px-2 py-1.5 font-medium border-b border-emerald-200 whitespace-nowrap">비고(급여/비급여)</th>
              <th className="px-1 py-1.5 border-b border-emerald-200 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground" data-testid="penchart-auto-visit-log-empty">
                  기록 없음 — [행 추가]로 직접 입력할 수 있습니다.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.key} className="border-b border-emerald-100" data-testid="penchart-auto-visit-log-row">
                  <td className="px-1 py-1"><CellInput value={r.date} onChange={(v) => updateCell(idx, 'date', v)} /></td>
                  <td className="px-1 py-1"><CellInput value={r.packageContent} onChange={(v) => updateCell(idx, 'packageContent', v)} /></td>
                  <td className="px-1 py-1"><CellInput value={r.todayCount} onChange={(v) => updateCell(idx, 'todayCount', v)} /></td>
                  <td className="px-1 py-1"><CellInput value={r.therapists} onChange={(v) => updateCell(idx, 'therapists', v)} /></td>
                  <td className="px-1 py-1"><CellInput value={r.note} onChange={(v) => updateCell(idx, 'note', v)} placeholder="급여/비급여 등" /></td>
                  <td className="px-1 py-1 text-center">
                    <button
                      onClick={() => deleteRow(idx)}
                      className="text-red-400 hover:text-red-600"
                      title="행 삭제"
                      data-testid="penchart-auto-visit-log-delrow"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {dirty && (
        <div className="mt-1.5 text-[10px] text-amber-600" data-testid="penchart-auto-visit-log-dirty">
          저장하지 않은 변경사항이 있습니다.
        </div>
      )}
    </div>
  );
}

function CellInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-[64px] rounded border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-emerald-200 focus:border-emerald-400 focus:bg-white focus:outline-none"
    />
  );
}
