/**
 * DutyRosterImportDialog — 구글시트 근무 스케줄 불러오기 (Phase 1: 수동 import)
 * T-20260605-foot-GSHEET-SCHEDULE-IMPORT
 *
 * 대상 = duty_roster (직원 근무 스케줄). 메커니즘 = 수동 파일 업로드/붙여넣기 1회성 import.
 *   (Phase 2 구글시트 상시 동기화 = 별건 티켓/DECISION-REQUEST 범위 밖.)
 *
 * 동선:
 *   1. .xlsx/.xls/.csv 파일 선택 또는 시트 붙여넣기
 *   2. 캘린더형(행=직원명, 열=날짜) 그리드 파싱 → 후보 행 추출
 *   3. 미리보기 테이블 (직원 매칭/날짜/근무유형 + 유효·오류·중복 플래그)  ← AC-2 GUARD: 이 시점 DB 미삽입
 *   4. "삽입 확정" 클릭 후에만 duty_roster insert (정상·비중복 행만)        ← AC-2 사람 게이트
 *   5. "N건 삽입 / M건 스킵" 요약                                          ← AC-5
 *
 * 가드:
 *   - AC-4 중복 차단: (clinic_id, date, doctor_id) 기존 행 + 배치내 중복 → skip
 *   - AC-6 권한: 호출부(DutyRosterTab)에서 admin/manager(canEdit) 게이트
 *   - AC-7 additive: 기존 셀 토글/전주 복사/그리드 렌더 로직 불변
 *
 * ⚠️ 매핑 규칙(컬럼 인식·근무유형 마크)은 현장 시트 샘플(Q1) 확정 전 groundwork.
 *    MARK_MAP / parseSheetDate / 그리드 인식부만 샘플 확보 후 보정한다(격리됨).
 * ✅ Q4 확정(T-20260606-foot-DUTY-ROSTER-ALLSTAFF): 근무표 그리드가 전 활성 직원을 렌더하므로
 *    본 import가 매칭한 비원장 직원도 그리드에 정상 표시된다(데이터-그리드 정합).
 */

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { UploadCloud, ClipboardPaste, AlertTriangle, CheckCircle2, Copy } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Clinic, Staff } from '@/lib/types';

// ─── 타입 ───────────────────────────────────────────────────────────────────

type RosterType = 'regular' | 'part' | 'resigned';

type RowStatus = 'valid' | 'duplicate' | 'error';

interface PreviewRow {
  /** 시트상 직원명(raw) */
  sheetName: string;
  /** 매칭된 staff (없으면 null) */
  staff: Staff | null;
  /** ISO yyyy-MM-dd (파싱 실패 시 null) */
  date: string | null;
  /** 원본 셀 마크 텍스트 */
  rawMark: string;
  rosterType: RosterType;
  status: RowStatus;
  /** 오류·중복 사유 */
  reason: string;
}

// ─── 매핑 규칙 (실측 시트 확정 — T-DUTY-IMPORT-SHEET-FORMAT) ───────────────────
//
// ⚠️ 실측 시트는 "행=직원/열=날짜" flat 매트릭스가 아니라 **주(week) 단위 캘린더 블록**.
//    셀 시맨틱: 셀에 직원명이 있으면 출근 / 비면 휴무. O/X 마킹 없음(마크=이름 존재 자체).
//    → 매칭된 직원은 전부 'regular'(근무).
//
//   구조 예:
//     ,2026,5월,오리진점 상담팀 & 코디팀   ← 연/월/팀 헤더
//     ,월,화,수,목,금,토,일               ← 요일 헤더
//     ,18,19,20,21,22,23,24               ← 날짜 행 (요일 칼럼별 일자)
//     ,총괄,김수린,…                      ← 날짜 행 아래로 칼럼별 출근자 세로 나열
//
//   특수 토큰: 휴진=휴무 skip · 전직원=그날 활성 staff 전체 · 총괄=김주연(Q5) · 이름 trim.

const ROSTER_TYPE_LABEL: Record<RosterType, string> = {
  regular: '근무',
  part: '파트',
  resigned: '퇴사/오프',
};

/** 그날 휴무/placeholder 토큰 — 출근자 아님 → skip */
const REST_TOKENS = new Set(['휴진', '휴무', '오프', 'off', 'OFF', '-', '·', '–', '—']);
/** "전직원" = 그날 활성 staff 전체로 확장 (buildPreview에서 staffList로 처리) */
const ALL_STAFF_TOKEN = '전직원';
/** "총괄" = 김주연 1:1 (Q5 확정) */
const SUPERVISOR_TOKEN = '총괄';
const SUPERVISOR_NAME = '김주연';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// ─── 주 단위 캘린더 블록 파싱 (격리) ──────────────────────────────────────────

interface Candidate {
  sheetName: string;
  date: string | null;
  rawMark: string;
  team: string;
}

/** 셀이 1~31 일(day) 숫자면 그 값, 아니면 null */
function dayNumberOf(cell: string): number | null {
  const s = (cell ?? '').toString().trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 1 && n <= 31 ? n : null;
}

/** 한 행의 day 칼럼들 [{col, day}] (날짜 행 판별 + 칼럼→일자 매핑용) */
function dayColumnsOf(row: string[]): Array<{ col: number; day: number }> {
  const out: Array<{ col: number; day: number }> = [];
  row.forEach((cell, ci) => {
    const d = dayNumberOf(cell);
    if (d != null) out.push({ col: ci, day: d });
  });
  return out;
}

/** 연/월/팀 헤더 행 인식 (예: 2026 · 5월 · 팀명). 'N월' 셀이 있으면 헤더로 본다. */
function parseMonthHeader(
  row: string[],
): { year?: number; month?: number; team?: string } | null {
  let month: number | undefined;
  let year: number | undefined;
  let team: string | undefined;
  for (const cellRaw of row) {
    const cell = (cellRaw ?? '').toString().trim();
    if (!cell) continue;
    const mm = cell.match(/^(\d{1,2})\s*월$/); // "5월" (요일 '월' 단독은 digit 없어 불매칭)
    if (mm) { month = parseInt(mm[1], 10); continue; }
    const ym = cell.match(/^(20\d{2})$/); // "2026"
    if (ym) { year = parseInt(ym[1], 10); continue; }
    // 그 외 텍스트(요일 단일 글자·순수 숫자 제외) = 팀 라벨 후보(최장 셀)
    if (!/^[월화수목금토일]$/.test(cell) && !/^\d+$/.test(cell)) {
      if (!team || cell.length > team.length) team = cell;
    }
  }
  if (month == null) return null;
  return { year, month, team };
}

/**
 * 날짜 행의 day 칼럼들을 실제 ISO 날짜로 변환. 월 롤오버 처리:
 * 일자가 직전보다 작아지면 다음 달(12월 넘으면 연도+1). 예: 29,30,1,2 → 6월29,30 / 7월1,2
 */
function resolveRowDates(
  dayCols: Array<{ col: number; day: number }>,
  startYear: number,
  startMonth: number,
): { colDate: Map<number, string>; endYear: number; endMonth: number } {
  let y = startYear;
  let m = startMonth;
  let prev = 0;
  const colDate = new Map<number, string>();
  for (const { col, day } of dayCols) {
    if (prev && day < prev) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    colDate.set(col, `${y}-${pad2(m)}-${pad2(day)}`);
    prev = day;
  }
  return { colDate, endYear: y, endMonth: m };
}

/**
 * 주 단위 캘린더 블록 그리드 → 후보 추출.
 *  1) 연/월 헤더로 컨텍스트(년·월·팀) 갱신
 *  2) day ≥3개 행 = 날짜 행 → 칼럼별 일자 확정(월 롤오버)
 *  3) 날짜 행 아래 ~ 다음 날짜행/헤더/끝까지 → 칼럼별 비셀 = 출근자(셀값=직원명)
 */
function extractCandidates(grid: string[][]): { candidates: Candidate[]; blocks: number } {
  const now = new Date();
  let ctxYear = now.getFullYear();
  let ctxMonth = now.getMonth() + 1; // 헤더 없을 때만 쓰이는 fallback
  let team = '';
  const candidates: Candidate[] = [];
  let blocks = 0;

  let i = 0;
  while (i < grid.length) {
    const row = grid[i] ?? [];

    // 1) 연/월/팀 헤더
    const hdr = parseMonthHeader(row);
    if (hdr) {
      if (hdr.year != null) ctxYear = hdr.year;
      if (hdr.month != null) ctxMonth = hdr.month;
      if (hdr.team) team = hdr.team; // 팀 셀 없는 헤더는 직전 팀 유지
      i += 1;
      continue;
    }

    // 2) 날짜 행 (day ≥ 3)
    const dayCols = dayColumnsOf(row);
    if (dayCols.length >= 3) {
      blocks += 1;
      const { colDate, endYear, endMonth } = resolveRowDates(dayCols, ctxYear, ctxMonth);

      // 3) 출근자 스캔: 다음 날짜행/헤더/끝까지 칼럼별 비셀 수집
      let j = i + 1;
      for (; j < grid.length; j++) {
        const arow = grid[j] ?? [];
        if (parseMonthHeader(arow)) break;
        if (dayColumnsOf(arow).length >= 3) break;
        for (const [col, date] of colDate) {
          const raw = (arow[col] ?? '').toString().trim();
          if (!raw) continue;
          if (REST_TOKENS.has(raw)) continue;
          candidates.push({ sheetName: raw, date, rawMark: raw, team });
        }
      }

      ctxYear = endYear; // 롤오버 결과를 다음 블록 컨텍스트로 승계
      ctxMonth = endMonth;
      i = j;
      continue;
    }

    i += 1;
  }

  return { candidates, blocks };
}

/** 파일 ArrayBuffer → 첫 시트 → 2D 그리드 */
function sheetToGrid(buf: ArrayBuffer): string[][] {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => (c ?? '').toString()) : []));
}

/** 붙여넣기 텍스트(TSV/CSV) → 2D 그리드 */
function pasteToGrid(text: string): string[][] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim()));
}

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────

export function DutyRosterImportDialog({
  clinic,
  open,
  onOpenChange,
  onImported,
}: {
  clinic: Clinic;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [parseNote, setParseNote] = useState<string>('');
  const [inserting, setInserting] = useState(false);

  // 전 활성 직원 (Q4: 원장 한정 아님 — role 표기) -----------------------------
  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ['staff_all_active', clinic.id],
    enabled: open,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('clinic_id', clinic.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });

  function resetState() {
    setRows(null);
    setPasteText('');
    setParseNote('');
    if (fileRef.current) fileRef.current.value = '';
  }

  // 직원명 매칭: name 또는 display_name 정확/trim 매칭 (대소문자·공백 무시)
  function matchStaff(sheetName: string): Staff | null {
    const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const target = norm(sheetName);
    return (
      staffList.find((s) => norm(s.name) === target) ||
      staffList.find((s) => s.display_name && norm(s.display_name) === target) ||
      null
    );
  }

  async function buildPreview(grid: string[][]) {
    const { candidates, blocks } = extractCandidates(grid);
    if (blocks === 0) {
      toast.error('주 단위 근무 캘린더(요일 헤더+날짜 행) 구조를 인식하지 못했습니다. 시트 형식을 확인하세요.');
      return;
    }

    // 특수 토큰 확장: 전직원 → 그날 활성 staff 전체 / 총괄 → 김주연(Q5)
    const expanded: Candidate[] = [];
    for (const c of candidates) {
      if (c.sheetName === ALL_STAFF_TOKEN) {
        for (const s of staffList) {
          expanded.push({ sheetName: s.name, date: c.date, rawMark: ALL_STAFF_TOKEN, team: c.team });
        }
      } else if (c.sheetName === SUPERVISOR_TOKEN) {
        expanded.push({ ...c, sheetName: SUPERVISOR_NAME, rawMark: SUPERVISOR_TOKEN });
      } else {
        expanded.push(c);
      }
    }

    if (expanded.length === 0) {
      toast.error('가져올 출근 데이터를 찾지 못했습니다.');
      return;
    }

    // 후보가 커버하는 날짜 범위의 기존 duty_roster 조회 (중복 차단용)
    const dates = expanded.map((c) => c.date).filter((d): d is string => !!d);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const { data: existingRows } = await supabase
      .from('duty_roster')
      .select('date, doctor_id')
      .eq('clinic_id', clinic.id)
      .gte('date', minDate)
      .lte('date', maxDate);
    const existingKeys = new Set(
      (existingRows ?? []).map((r: { date: string; doctor_id: string }) => `${r.doctor_id}_${r.date}`),
    );

    const batchKeys = new Set<string>();
    const preview: PreviewRow[] = expanded.map((c) => {
      const staff = matchStaff(c.sheetName);
      // 셀=이름 존재 → 매칭된 직원은 전부 근무(regular)
      const rosterType: RosterType = 'regular';

      let status: RowStatus = 'valid';
      let reason = '';

      if (!c.date) {
        status = 'error';
        reason = '날짜 인식 실패';
      } else if (!staff) {
        status = 'error';
        reason = `직원 매칭 실패(${c.sheetName})`;
      } else {
        const key = `${staff.id}_${c.date}`;
        if (existingKeys.has(key) || batchKeys.has(key)) {
          status = 'duplicate';
          reason = '기존 근무 존재';
        } else {
          batchKeys.add(key);
        }
      }

      return {
        sheetName: c.sheetName,
        staff,
        date: c.date,
        rawMark: c.rawMark,
        rosterType,
        status,
        reason,
      };
    });

    setRows(preview);
    const unmatched = preview.filter((r) => r.status === 'error' && !r.staff).length;
    setParseNote(
      unmatched > 0
        ? `직원 매칭 실패 ${unmatched}건 — 시트 표기 이름과 직원 등록명을 확인하세요(매칭 실패 행은 삽입에서 제외).`
        : '',
    );
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      await buildPreview(sheetToGrid(buf));
    } catch (err) {
      toast.error(`파일 파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onParsePaste() {
    if (!pasteText.trim()) {
      toast.error('붙여넣은 데이터가 없습니다.');
      return;
    }
    try {
      await buildPreview(pasteToGrid(pasteText));
    } catch (err) {
      toast.error(`파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary = useMemo(() => {
    if (!rows) return { valid: 0, dup: 0, err: 0 };
    return {
      valid: rows.filter((r) => r.status === 'valid').length,
      dup: rows.filter((r) => r.status === 'duplicate').length,
      err: rows.filter((r) => r.status === 'error').length,
    };
  }, [rows]);

  // AC-2: 사람 게이트 — "삽입 확정" 누른 후에만 insert
  async function onConfirmInsert() {
    if (!rows) return;
    const toInsert = rows.filter((r) => r.status === 'valid' && r.staff && r.date);
    if (toInsert.length === 0) {
      toast.error('삽입할 정상 행이 없습니다.');
      return;
    }
    setInserting(true);
    try {
      const payload = toInsert.map((r) => ({
        clinic_id: clinic.id,
        date: r.date!,
        doctor_id: r.staff!.id,
        roster_type: r.rosterType,
        notes: '구글시트 불러오기',
      }));
      const { error } = await supabase.from('duty_roster').insert(payload);
      if (error) {
        toast.error(`삽입 실패: ${error.message}`);
        return;
      }
      toast.confirm(
        `근무 스케줄 ${toInsert.length}건 삽입 / ${summary.dup + summary.err}건 스킵(중복·오류)`,
      );
      qc.invalidateQueries({ queryKey: ['duty_roster_week', clinic.id] });
      onImported?.();
      resetState();
      onOpenChange(false);
    } finally {
      setInserting(false);
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) resetState();
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5" />
            구글시트 근무 스케줄 불러오기
          </DialogTitle>
          <DialogDescription>
            구글시트를 .xlsx/.csv 로 내려받아 업로드하거나 셀을 복사해 붙여넣으세요. 주 단위 근무
            캘린더(연/월·요일 헤더 + 날짜 행 아래 출근자 명단)를 인식합니다. 셀에 이름이 있으면 출근,
            비면 휴무로 처리합니다. 미리보기 확인 후 <strong>삽입 확정</strong>을 눌러야 저장됩니다.
          </DialogDescription>
        </DialogHeader>

        {/* 입력 모드 토글 */}
        <div className="flex gap-2">
          <Button
            variant={mode === 'file' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('file')}
          >
            <UploadCloud className="mr-1 h-4 w-4" /> 파일 업로드
          </Button>
          <Button
            variant={mode === 'paste' ? 'default' : 'outline'}
            size="sm"
            data-testid="duty-import-paste-mode"
            onClick={() => setMode('paste')}
          >
            <ClipboardPaste className="mr-1 h-4 w-4" /> 붙여넣기
          </Button>
        </div>

        {mode === 'file' ? (
          <div className="rounded-lg border border-dashed p-4">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onFile}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-teal-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-teal-700"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              data-testid="duty-import-paste-textarea"
              placeholder={'구글시트에서 범위를 복사해 붙여넣으세요 (탭/콤마 구분).'}
              className="w-full rounded-md border p-2 text-sm font-mono"
            />
            <Button size="sm" variant="outline" data-testid="duty-import-parse-btn" onClick={onParsePaste}>
              <Copy className="mr-1 h-4 w-4" /> 붙여넣은 데이터 파싱
            </Button>
          </div>
        )}

        {/* 미리보기 (AC-2: 이 시점 DB 미삽입) */}
        {rows && (
          <div className="space-y-2" data-testid="duty-import-preview">
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="duty-import-summary">
              <Badge className="bg-teal-100 text-teal-800 border-teal-300">
                정상 {summary.valid}
              </Badge>
              <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                중복 {summary.dup}
              </Badge>
              <Badge className="bg-red-100 text-red-700 border-red-300">오류 {summary.err}</Badge>
              <span className="text-xs text-muted-foreground">
                ※ 아직 저장 전입니다 — “삽입 확정” 클릭 시에만 저장됩니다.
              </span>
            </div>

            {parseNote && (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{parseNote}</span>
              </div>
            )}

            <div className="max-h-72 overflow-auto rounded-lg border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted/70">
                  <tr>
                    <th className="border-b px-2 py-1.5 text-left text-xs font-semibold">직원(시트)</th>
                    <th className="border-b px-2 py-1.5 text-left text-xs font-semibold">매칭</th>
                    <th className="border-b px-2 py-1.5 text-left text-xs font-semibold">날짜</th>
                    <th className="border-b px-2 py-1.5 text-left text-xs font-semibold">근무</th>
                    <th className="border-b px-2 py-1.5 text-left text-xs font-semibold">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r.status === 'error' ? 'bg-red-50/50' : r.status === 'duplicate' ? 'bg-amber-50/40' : ''}>
                      <td className="border-b px-2 py-1 whitespace-nowrap">{r.sheetName}</td>
                      <td className="border-b px-2 py-1 whitespace-nowrap">
                        {r.staff ? (
                          <span>
                            {r.staff.name}
                            <span className="ml-1 text-[10px] text-muted-foreground">({r.staff.role})</span>
                          </span>
                        ) : (
                          <span className="text-red-600">—</span>
                        )}
                      </td>
                      <td className="border-b px-2 py-1 whitespace-nowrap">{r.date ?? '—'}</td>
                      <td className="border-b px-2 py-1 whitespace-nowrap">
                        {ROSTER_TYPE_LABEL[r.rosterType]}
                        {r.rawMark !== r.sheetName && (
                          <span className="ml-1 text-[10px] text-muted-foreground">({r.rawMark})</span>
                        )}
                      </td>
                      <td className="border-b px-2 py-1 whitespace-nowrap text-xs">
                        {r.status === 'valid' && (
                          <span className="inline-flex items-center gap-1 text-teal-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> 정상
                          </span>
                        )}
                        {r.status === 'duplicate' && (
                          <span className="text-amber-700">중복 · {r.reason}</span>
                        )}
                        {r.status === 'error' && <span className="text-red-600">오류 · {r.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={inserting}>
            취소
          </Button>
          <Button
            onClick={onConfirmInsert}
            data-testid="duty-import-confirm"
            disabled={!rows || summary.valid === 0 || inserting}
          >
            {inserting ? '삽입 중…' : `삽입 확정 (${summary.valid}건)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
