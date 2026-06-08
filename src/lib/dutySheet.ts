/**
 * dutySheet — 구글시트 근무 캘린더 직접 read (T-20260606-foot-HANDOVER-TODAY-ATTENDEES REV-1)
 *
 * "오늘 출근 명단"의 데이터 소스. 옵션 A(duty_roster import)를 폐기하고
 * 구글시트(gid=341864863 오리진점 상담&코디 등)를 런타임에 직접 read 한다.
 *
 * ⭐ 파서 = T-20260606-foot-DUTY-IMPORT-SHEET-FORMAT(commit 2001c73, CANCELLED)에서
 *   검증 완료된 주(week) 단위 블록 파서(`extractCandidates`)를 **그대로 이식**한 것.
 *   재작성 아님 — 파싱 룰은 실측 검증 끝남(실측 CSV 8블록·5/13~7/4·6-30→7-01
 *   월 롤오버·특수토큰 휴진/전직원/총괄 pass). import 다이얼로그(duty_roster write)
 *   경로는 가져오지 않고 **파싱 룰만** 추출. (planner MSG-20260606-113250 지시)
 *
 * 시트 구조(실측 2026-06-06, gviz CSV) — 주 단위 캘린더 블록:
 *       [연/월/팀 헤더] "" "2026" "6월" "상담&코디" ...
 *       [요일 헤더]     "" "월" "화" "수" "목" "금" "토" "일"
 *       [날짜 행]       "" "29" "30" "1" "2" "3" "4" "5"   ← day≥3개 = 날짜 행
 *       [이름 행들]     "" "김주연" ...                     ← 칼럼별 세로로 출근자 나열
 *       (다음 날짜 행 / 헤더 / 끝까지 같은 블록)
 *   - 칼럼→실날짜 변환 시 **월 롤오버**: 일자가 직전보다 작아지면 다음 달(12월→연도+1).
 *     예: 29,30,1,2 → 6/29,6/30,7/1,7/2.
 *   - "오늘"(KST) 칼럼에 이름 있으면 출근, 비면 휴무(셀 존재 = 출근, AC-3).
 *   - 특수 토큰: 휴진/휴무/오프 = skip · 전직원 = 그날 활성 staff 전체 · 총괄 = 김주연(Q5).
 *
 * CORS: docs.google.com gviz CSV 는 Access-Control-Allow-Origin 미제공 → 브라우저
 *   직접 fetch 차단. Edge Function `duty-sheet-read` 프록시 경유로 raw CSV 수신.
 *
 * 팀/역할 색은 시트가 모르므로 여기선 "이름"만 추출하고, 호출측(Handover)에서
 *   이름 → CRM staff.role 매핑으로 칠한다(NAMECARD-ROLECOLOR 결합점).
 */
import { supabase } from './supabase';

/** 상담&코디 시트 gid(오리진점). 치료팀 별도 탭 gid 확인 시 배열에 추가. */
export const DUTY_SHEET_GIDS = ['341864863'];

// ─── 특수 토큰 (2001c73 검증 룰과 동일) ──────────────────────────────────────
/** 그날 휴무/placeholder 토큰 — 출근자 아님 → skip */
const REST_TOKENS = new Set(['휴진', '휴무', '오프', 'off', 'OFF', '-', '·', '–', '—']);
/** "전직원" = 그날 활성 staff 전체로 확장 (allStaffNames 로 처리) */
const ALL_STAFF_TOKEN = '전직원';
/** "총괄" = 김주연 1:1 (Q5 확정) */
const SUPERVISOR_TOKEN = '총괄';
const SUPERVISOR_NAME = '김주연';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// ─── CSV → 2D 그리드 ─────────────────────────────────────────────────────────

/** 한 줄 CSV 파싱 (gviz 따옴표 감싼 셀 + 콤마/escaped quote 처리) */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(csv: string): string[][] {
  return csv
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(parseCsvLine);
}

// ─── 주 단위 캘린더 블록 파싱 (2001c73 extractCandidates 이식) ────────────────

interface DutyCandidate {
  /** 시트 셀 원문(이름 또는 특수 토큰) */
  name: string;
  /** 칼럼→실날짜(월 롤오버 적용) ISO 'YYYY-MM-DD' */
  date: string | null;
  /** 컨텍스트 팀 라벨(헤더에서 인식) */
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
    if (mm) {
      month = parseInt(mm[1], 10);
      continue;
    }
    const ym = cell.match(/^(20\d{2})$/); // "2026"
    if (ym) {
      year = parseInt(ym[1], 10);
      continue;
    }
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
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    colDate.set(col, `${y}-${pad2(m)}-${pad2(day)}`);
    prev = day;
  }
  return { colDate, endYear: y, endMonth: m };
}

/**
 * 주 단위 캘린더 블록 그리드 → 후보 추출. (2001c73 검증 로직 이식)
 *  1) 연/월 헤더로 컨텍스트(년·월·팀) 갱신
 *  2) day ≥3개 행 = 날짜 행 → 칼럼별 일자 확정(월 롤오버)
 *  3) 날짜 행 아래 ~ 다음 날짜행/헤더/끝까지 → 칼럼별 비셀 = 출근자(셀값=직원명)
 */
function extractCandidates(grid: string[][]): { candidates: DutyCandidate[]; blocks: number } {
  const now = new Date();
  let ctxYear = now.getFullYear();
  let ctxMonth = now.getMonth() + 1; // 헤더 없을 때만 쓰이는 fallback
  let team = '';
  const candidates: DutyCandidate[] = [];
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
          candidates.push({ name: raw, date, team });
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

/**
 * CSV(주간 블록 캘린더)에서 특정 날짜(todayIso 'YYYY-MM-DD')의 출근자 이름 목록을 추출.
 * 순수 함수 — 단위 테스트 가능. 월 롤오버·특수 토큰(전직원/총괄/휴진)을 2001c73 룰대로 처리.
 *
 * @param allStaffNames "전직원" 토큰 확장용 활성 직원 이름 목록(없으면 전직원 토큰은 무시).
 */
export function parseDutyAttendees(
  csv: string,
  todayIso: string,
  allStaffNames: string[] = [],
): string[] {
  const grid = parseCsv(csv);
  const { candidates } = extractCandidates(grid);

  const out: string[] = [];
  const push = (n: string) => {
    const t = (n ?? '').trim();
    if (t && !out.includes(t)) out.push(t);
  };

  for (const c of candidates) {
    if (c.date !== todayIso) continue;
    // 특수 토큰 확장 (2001c73 buildPreview 와 동일 룰)
    if (c.name === ALL_STAFF_TOKEN) {
      for (const s of allStaffNames) push(s);
    } else if (c.name === SUPERVISOR_TOKEN) {
      push(SUPERVISOR_NAME);
    } else {
      push(c.name);
    }
  }
  return out;
}

/**
 * CSV(주간 블록 캘린더)에서 **날짜별 출근자 맵**(Record<'YYYY-MM-DD', 이름[]>)을 한 번에 추출.
 * parseDutyAttendees 가 특정 1일만 반환하는 것과 달리, 시트 전 구간을 1회 파싱해 모든
 * 날짜를 채운다 → A안(캘린더 셀)/B안(선택일 하단)이 같은 맵을 공유(날짜당 재파싱·재fetch 없음).
 * 특수 토큰(전직원/총괄/휴진) 확장 룰은 parseDutyAttendees 와 동일.
 *
 * @param allStaffNames "전직원" 토큰 확장용 활성 직원 이름 목록.
 */
export function parseDutyAttendeesByDate(
  csv: string,
  allStaffNames: string[] = [],
): Record<string, string[]> {
  const grid = parseCsv(csv);
  const { candidates } = extractCandidates(grid);

  const map: Record<string, string[]> = {};
  const push = (date: string, n: string) => {
    const t = (n ?? '').trim();
    if (!t) return;
    const arr = map[date] ?? (map[date] = []);
    if (!arr.includes(t)) arr.push(t);
  };

  for (const c of candidates) {
    if (!c.date) continue;
    if (c.name === ALL_STAFF_TOKEN) {
      for (const s of allStaffNames) push(c.date, s);
    } else if (c.name === SUPERVISOR_TOKEN) {
      push(c.date, SUPERVISOR_NAME);
    } else {
      push(c.date, c.name);
    }
  }
  return map;
}

// ─── Edge Function 프록시 read ───────────────────────────────────────────────

/** Edge Function 프록시로 한 시트(gid) raw CSV 수신 */
async function fetchSheetCsv(gid: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('duty-sheet-read', {
    body: { gid },
  });
  if (error) throw error;
  const payload = data as { ok?: boolean; csv?: string; error?: string } | null;
  if (!payload?.ok || typeof payload.csv !== 'string') {
    throw new Error(payload?.error ?? 'duty-sheet-read 응답 형식 오류');
  }
  return payload.csv;
}

/**
 * 오늘(KST) 출근자 이름 목록. todayIso = 'YYYY-MM-DD'(KST).
 * 여러 gid(상담&코디 / 치료팀 등)를 모두 read 해 합친다(중복 제거).
 * 시트 장애/포맷 변경 시 graceful — throw 하지 않고 가능한 범위만 반환.
 *
 * @param allStaffNames "전직원" 토큰 확장용 활성 직원 이름 목록.
 */
export async function fetchTodayAttendeeNames(
  todayIso: string,
  gids: string[] = DUTY_SHEET_GIDS,
  allStaffNames: string[] = [],
): Promise<string[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso ?? '')) return [];

  const results = await Promise.allSettled(
    gids.map(async (gid) => {
      const csv = await fetchSheetCsv(gid);
      return parseDutyAttendees(csv, todayIso, allStaffNames);
    }),
  );

  const merged: string[] = [];
  for (const res of results) {
    if (res.status === 'fulfilled') {
      for (const name of res.value) {
        if (!merged.includes(name)) merged.push(name);
      }
    } else {
      // 일부 시트 실패는 무시(graceful) — 콘솔 경고만
      console.warn('[dutySheet] 시트 read 실패:', res.reason);
    }
  }
  return merged;
}

/**
 * 모든 시트(gid)에서 **날짜별 출근자 맵**을 수신·병합. gid당 CSV **1회만 fetch**
 * (N개 날짜 조회 시 날짜마다 재호출하던 fetchTodayAttendeeNames 반복을 대체 — AC-0).
 * 시트 장애/포맷 변경 시 graceful — 실패한 gid는 무시하고 가능한 범위만 반환.
 *
 * @param allStaffNames "전직원" 토큰 확장용 활성 직원 이름 목록.
 */
export async function fetchAttendeesByDate(
  gids: string[] = DUTY_SHEET_GIDS,
  allStaffNames: string[] = [],
): Promise<Record<string, string[]>> {
  const results = await Promise.allSettled(
    gids.map(async (gid) =>
      parseDutyAttendeesByDate(await fetchSheetCsv(gid), allStaffNames),
    ),
  );

  const merged: Record<string, string[]> = {};
  for (const res of results) {
    if (res.status !== 'fulfilled') {
      console.warn('[dutySheet] 시트 read 실패:', res.reason);
      continue;
    }
    for (const [date, names] of Object.entries(res.value)) {
      const arr = merged[date] ?? (merged[date] = []);
      for (const n of names) if (!arr.includes(n)) arr.push(n);
    }
  }
  return merged;
}
