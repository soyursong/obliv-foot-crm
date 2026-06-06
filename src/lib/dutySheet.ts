/**
 * dutySheet — 구글시트 근무 캘린더 직접 read (T-20260606-foot-HANDOVER-TODAY-ATTENDEES REV-1)
 *
 * "오늘 출근 명단"의 데이터 소스. 기존 옵션 A(duty_roster import)를 폐기하고
 * 구글시트(gid=341864863 오리진점 상담&코디 등)를 런타임에 직접 read 한다.
 *
 * 시트 구조(실측 2026-06-06, gviz CSV):
 *   - 월별 주간 블록 캘린더. 행 흐름:
 *       [월 헤더]   "" "2026" "6월" ...
 *       [요일 헤더] "" "월" "화" "수" "목" "금" "토" "일"
 *       [날짜 행]   "" "1" "2" "3" "4" "5" "6" "7"
 *       [이름 행들] "" "김주연" ...   ← 날짜 열에 이름 있으면 그날 출근
 *       (다음 날짜 행 또는 다음 월 헤더 전까지 같은 블록)
 *   - "오늘" 열에 들어있는 이름 = 출근자. 빈 칸 = 휴무. (셀 존재 = 출근, AC-3)
 *   - 휴진/휴무/총괄 등 라벨 토큰은 사람 이름이 아니므로 제외.
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

/** 이름이 아닌 라벨/오프 토큰 — 출근자에서 제외 */
const NON_NAME_TOKENS = new Set([
  '휴진',
  '휴무',
  '오프',
  'off',
  'OFF',
  '총괄', // 시프트 구분 라벨(특정 월 블록) — 사람 이름 아님
  '전직원',
  '전 직원',
  '-',
  '·',
]);

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

/** 셀이 1~31 의 순수 정수(날짜)인지 */
function asDayNumber(cell: string): number | null {
  const t = cell.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 31 ? n : null;
}

/** 행이 "날짜 행"인지: 1~31 정수 셀이 3개 이상 */
function isDateRow(cells: string[]): boolean {
  return cells.filter((c) => asDayNumber(c) !== null).length >= 3;
}

/** 행이 월 헤더인지: "N월" 셀 포함 → month 반환(없으면 null) */
function monthOfHeaderRow(cells: string[]): number | null {
  for (const c of cells) {
    const m = c.trim().match(/^(\d{1,2})월$/);
    if (m) {
      const mm = Number(m[1]);
      if (mm >= 1 && mm <= 12) return mm;
    }
  }
  return null;
}

/**
 * CSV(주간 블록 캘린더)에서 특정 (month, day)의 출근자 이름 목록을 추출.
 * year 는 시트에 월 헤더만 있고 연도 경계가 드물어 month 기준으로 매칭한다.
 * 순수 함수 — 단위 테스트 가능.
 */
export function parseDutyAttendees(csv: string, month: number, day: number): string[] {
  const rows = parseCsv(csv);
  let currentMonth: number | null = null;
  const names: string[] = [];

  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r];

    // 월 헤더 갱신
    const hm = monthOfHeaderRow(cells);
    if (hm !== null) {
      currentMonth = hm;
      continue;
    }

    // 날짜 행 + 대상 월 → 오늘 열을 찾는다
    if (isDateRow(cells) && currentMonth === month) {
      const targetCol = cells.findIndex((c) => asDayNumber(c) === day);
      if (targetCol === -1) continue; // 이 블록엔 오늘 날짜 없음

      // 다음 행부터 이름 수집 (다음 날짜 행/월 헤더 전까지)
      for (let rr = r + 1; rr < rows.length; rr++) {
        const nameCells = rows[rr];
        if (isDateRow(nameCells)) break;
        if (monthOfHeaderRow(nameCells) !== null) break;
        const raw = (nameCells[targetCol] ?? '').trim();
        if (!raw) continue;
        if (NON_NAME_TOKENS.has(raw)) continue;
        if (!names.includes(raw)) names.push(raw);
      }
      break; // 대상 블록 1개만
    }
  }

  return names;
}

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
 */
export async function fetchTodayAttendeeNames(
  todayIso: string,
  gids: string[] = DUTY_SHEET_GIDS,
): Promise<string[]> {
  const [, mm, dd] = todayIso.split('-').map((x) => Number(x));
  if (!mm || !dd) return [];

  const results = await Promise.allSettled(
    gids.map(async (gid) => {
      const csv = await fetchSheetCsv(gid);
      return parseDutyAttendees(csv, mm, dd);
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
