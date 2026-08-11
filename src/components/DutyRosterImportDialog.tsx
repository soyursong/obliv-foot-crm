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
 *   3. 미리보기 테이블 (직원 매칭/날짜/근무유형 + 유효·오류·중복·제외 플래그) ← AC-2 GUARD: 이 시점 DB 미삽입
 *   4. "삽입 확정" 클릭 후에만 duty_roster insert (정상·비중복 행만)        ← AC-2 사람 게이트
 *   5. "N건 삽입 / M건 스킵" 요약                                          ← AC-5
 *
 * follow-up T-20260810-foot-WORKCAL-IMPORT-MAPFAIL-PARTIAL-INSERT (cross-fork port ← body PR#260):
 *   - AC-1 삽입판정 분리: 오류/제외 행이 있어도 정상 행만 독립 삽입. 버튼 활성=정상건수>0.
 *   - AC-2 재분류: 요일약자('Sun'/'Mon'…)·순번숫자('1'/'2'…)·표 머리글 등 명백한 비직원
 *     라벨은 '오류'가 아닌 '제외(skip)'로 분류 → 오류 카운트에서 제외(오탐 제거).
 *   - AC-3 정상 0건 안내 배너: 전부 중복·오류·제외라 버튼 비활성일 때 이유를 명시(무한차단 UX 제거).
 *
 * 가드:
 *   - AC-4 중복 차단: (clinic_id, date, doctor_id) 기존 행 + 배치내 중복 → skip
 *   - AC-6 권한: 호출부(DutyRosterTab)에서 admin/manager(canEdit) 게이트
 *   - AC-7 additive: 기존 셀 토글/전주 복사/그리드 렌더 로직 불변
 *
 * ⚠️ 매핑 규칙(컬럼 인식·근무유형 마크)은 현장 시트 샘플(Q1) 확정 전 groundwork.
 *    MARK_MAP / parseSheetDate / 그리드 인식부만 샘플 확보 후 보정한다(격리됨).
 * ⚠️ Q4(원장님 한정 vs 전 직원): 본 import는 전 활성 직원과 매칭하고 role을 미리보기에 표기.
 *    현 근무표 그리드는 director만 렌더 → 비원장 행은 데이터로만 적재됨(미리보기 경고로 고지).
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
  DialogFooter,
} from '@/components/ui/dialog';
import type { Clinic, Staff } from '@/lib/types';

// ─── 타입 ───────────────────────────────────────────────────────────────────

type RosterType = 'regular' | 'part' | 'resigned';

type RowStatus = 'valid' | 'duplicate' | 'error' | 'skip';

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

// ─── 매핑 규칙 (시트 샘플 확정 후 보정 대상 — 격리) ───────────────────────────

/** 셀 마크 텍스트 → roster_type. 미스매치 시 비어있지 않으면 regular 추정. */
const MARK_MAP: Array<{ test: RegExp; type: RosterType }> = [
  { test: /^(파트|part|p)$/i, type: 'part' },
  { test: /(퇴사|resign|반차|오프|off|휴무|x)/i, type: 'resigned' },
  { test: /(근무|출근|regular|정상|o|●|◯|○|v|✓|√|1)/i, type: 'regular' },
];

function markToRosterType(rawMark: string): RosterType {
  const m = rawMark.trim();
  for (const { test, type } of MARK_MAP) if (test.test(m)) return type;
  return 'regular'; // 비어있지 않은 미지의 마크는 근무로 추정
}

// ─── AC-2: 비직원 라벨 재분류 (직원 매칭 실패를 '오류'가 아닌 '제외'로) ────────────
// 달력형 시트의 요일약자 행·순번(No) 열·표 머리글이 "직원명" 자리로 파싱되어 매칭 실패 →
// 오류 카운트를 부풀리고 삽입을 막던 문제(body 김나영 센터장 스샷: 'Sun'/'2' 직원 매칭 실패와
// 동형)를 '제외(skip)'로 재분류해 오류에서 뺀다. cross-fork port(body PR#260 검증 패턴).
// ※ 한글 실명은 오탐 0: 요일 패턴은 [일월화수목금토] 단독(옵션 요일/괄호)만 매칭하므로
//    '김일수'·'박월자' 등 2자 이상 실명은 전체일치에 걸리지 않는다.
const NON_STAFF_LABEL: RegExp[] = [
  // 요일 약자/풀네임 (영문)
  /^(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(day)?$/i,
  // 요일 (국문): 일 / 일요일 / (일) / (일요일)
  /^\(?[일월화수목금토]\)?(요일)?$/,
  // 표 머리글/집계 라벨
  /^(no\.?|순번|번호|성명|이름|직원|담당|담당자|요일|주|주차|합계|계|소계|총계|비고|구분|날짜|일자)$/i,
];

/** 명백한 비직원 라벨(요일약자·순번숫자·표 머리글) → 제외 대상 여부 */
function isNonStaffLabel(sheetName: string): boolean {
  const s = (sheetName ?? '').trim();
  if (!s) return true;
  if (/^\d+$/.test(s)) return true; // 순수 정수 = 순번/주차 (직원명이 순수 숫자일 수 없음)
  return NON_STAFF_LABEL.some((re) => re.test(s));
}

const ROSTER_TYPE_LABEL: Record<RosterType, string> = {
  regular: '근무',
  part: '파트',
  resigned: '퇴사/오프',
};

// ─── 날짜 파싱 (격리) ─────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Excel serial 또는 다양한 텍스트 날짜 → ISO yyyy-MM-dd | null */
function parseSheetDate(raw: string, fallbackYear: number): string | null {
  const s = (raw ?? '').toString().trim();
  if (!s) return null;

  // yyyy-mm-dd / yyyy.mm.dd / yyyy/mm/dd
  let m = s.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;

  // m월 d일
  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (m) return `${fallbackYear}-${pad2(+m[1])}-${pad2(+m[2])}`;

  // m/d or m-d or m.d (연도 없음 → fallbackYear)
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
  if (m) return `${fallbackYear}-${pad2(+m[1])}-${pad2(+m[2])}`;

  // Excel serial (순수 숫자) — 1900 date system
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 59 && serial < 60000) {
      const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
  }
  return null;
}

// ─── 그리드 파싱 (캘린더형: 행=직원, 열=날짜) ─────────────────────────────────

interface Candidate {
  sheetName: string;
  date: string | null;
  rawMark: string;
}

/**
 * 2D 그리드 → 후보 추출.
 *  1) 날짜로 파싱되는 셀이 가장 많은 행 = 헤더(날짜) 행. 해당 열 = 날짜 열.
 *  2) 헤더 아래 각 행의 첫 텍스트 셀 = 직원명. 직원명 × 날짜열 셀에 마크 있으면 후보.
 */
function extractCandidates(grid: string[][]): { candidates: Candidate[]; headerFound: boolean } {
  const fallbackYear = new Date().getFullYear();

  // 1) 헤더 행 탐색
  let headerRow = -1;
  let dateCols: Array<{ col: number; date: string }> = [];
  let bestCount = 0;
  grid.forEach((row, ri) => {
    const cols: Array<{ col: number; date: string }> = [];
    row.forEach((cell, ci) => {
      const iso = parseSheetDate(cell, fallbackYear);
      if (iso) cols.push({ col: ci, date: iso });
    });
    if (cols.length > bestCount) {
      bestCount = cols.length;
      headerRow = ri;
      dateCols = cols;
    }
  });

  if (headerRow < 0 || dateCols.length < 1) {
    return { candidates: [], headerFound: false };
  }

  // 2) 직원명 열 = 날짜열이 아닌 첫 비어있지 않은 열 (대개 0). 데이터 행 순회
  const dateColSet = new Set(dateCols.map((d) => d.col));
  const candidates: Candidate[] = [];

  for (let ri = headerRow + 1; ri < grid.length; ri++) {
    const row = grid[ri];
    if (!row || row.every((c) => !c || !c.toString().trim())) continue;

    // 직원명 = 날짜열이 아닌 첫 비어있지 않은 셀
    let sheetName = '';
    for (let ci = 0; ci < row.length; ci++) {
      if (dateColSet.has(ci)) continue;
      const v = (row[ci] ?? '').toString().trim();
      if (v) { sheetName = v; break; }
    }
    if (!sheetName) continue;

    for (const { col, date } of dateCols) {
      const rawMark = (row[col] ?? '').toString().trim();
      if (!rawMark) continue;
      candidates.push({ sheetName, date, rawMark });
    }
  }

  return { candidates, headerFound: true };
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
    const { candidates, headerFound } = extractCandidates(grid);
    if (!headerFound) {
      toast.error('날짜 헤더 행을 인식하지 못했습니다. 달력형(행=직원, 열=날짜) 시트인지 확인하세요.');
      return;
    }
    if (candidates.length === 0) {
      toast.error('가져올 근무 데이터를 찾지 못했습니다.');
      return;
    }

    // 후보가 커버하는 날짜 범위의 기존 duty_roster 조회 (중복 차단용)
    const dates = candidates.map((c) => c.date).filter((d): d is string => !!d);
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
    const preview: PreviewRow[] = candidates.map((c) => {
      const staff = matchStaff(c.sheetName);
      const rosterType = markToRosterType(c.rawMark);

      let status: RowStatus = 'valid';
      let reason = '';

      if (!c.date) {
        status = 'error';
        reason = '날짜 인식 실패';
      } else if (!staff) {
        // AC-2: 요일약자·순번숫자·머리글 등 명백한 비직원 라벨은 오류가 아닌 '제외'
        if (isNonStaffLabel(c.sheetName)) {
          status = 'skip';
          reason = `직원 아님(요일·순번 등) 자동 제외`;
        } else {
          status = 'error';
          reason = `직원 매칭 실패(${c.sheetName})`;
        }
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
    const nonDirector = preview.filter((r) => r.staff && r.staff.role !== 'director').length;
    setParseNote(
      nonDirector > 0
        ? `⚠️ 비원장 직원 ${nonDirector}건 포함 — 현재 근무표 그리드는 원장님(director)만 표시합니다. 표시 범위는 현장 확인 후 보정 예정.`
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
    if (!rows) return { valid: 0, dup: 0, err: 0, skip: 0 };
    return {
      valid: rows.filter((r) => r.status === 'valid').length,
      dup: rows.filter((r) => r.status === 'duplicate').length,
      err: rows.filter((r) => r.status === 'error').length,
      skip: rows.filter((r) => r.status === 'skip').length,
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
        `근무 스케줄 ${toInsert.length}건 삽입 / ${summary.dup + summary.err + summary.skip}건 스킵(중복·오류·제외)`,
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
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-white hover:file:bg-neutral-900"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              data-testid="duty-import-paste-textarea"
              placeholder={'시트 범위 붙여넣기 (탭/콤마 구분)'}
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
              {summary.skip > 0 && (
                <Badge className="bg-neutral-100 text-neutral-600 border-neutral-300">
                  제외 {summary.skip}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                ※ 아직 저장 전입니다 — “삽입 확정” 클릭 시에만 저장됩니다.
              </span>
            </div>

            {/* 정상 0건 안내: 버튼 비활성 이유를 명시(전부 중복·오류·제외일 때 혼란 방지) */}
            {summary.valid === 0 && (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                data-testid="duty-import-novalid-hint"
              >
                새로 추가할 근무가 없습니다 — 정상 0건(중복 {summary.dup}·오류 {summary.err}
                {summary.skip > 0 ? `·제외 ${summary.skip}` : ''}건만 있음). 오류 행은 아래에서 사유를
                확인 후 시트를 수정해 다시 업로드하세요.
              </div>
            )}

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
                    <tr key={i} className={r.status === 'error' ? 'bg-red-50/50' : r.status === 'duplicate' ? 'bg-amber-50/40' : r.status === 'skip' ? 'bg-neutral-50 text-neutral-400' : ''}>
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
                        <span className="ml-1 text-[10px] text-muted-foreground">({r.rawMark})</span>
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
                        {r.status === 'skip' && <span className="text-neutral-500">제외 · {r.reason}</span>}
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
