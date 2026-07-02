// attendance-sync — 구글시트 근무캘린더 → staff_attendance(SSOT) 자동 동기화 EF
// T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM (AC-3)
//
// ── 역할 ─────────────────────────────────────────────────────────────
//   구글시트(오리진점 상담&코디 등 gid)를 서버에서 read → 날짜별 출근자 이름 파싱
//   → CRM staff.name 매핑 → staff_attendance 로 멱등 upsert(reconcile).
//   '출근 N명'(배정화면) + AUTOASSIGN-SERVERSIDE 옵션 B/C trigger 가 read 하는
//   단일 출근 SSOT(staff_attendance)를 항상-최신으로 유지 → A안의 stale 회귀 차단.
//
//   ⭐ 파서(parseCsv/extractCandidates/parseDutyAttendeesByDate)는 src/lib/dutySheet.ts 의
//     실측 검증(2001c73) 순수 함수를 **그대로 이식**(재작성 아님). 월 롤오버·특수토큰
//     (전직원/총괄/휴진)·주간 블록·월경계 교차주 가드 룰 동일. 클라 lib 이 CORS 회피용
//     EF 프록시를 거치는 것과 달리, 여기선 서버라서 gviz CSV 를 직접 fetch 한다.
//
// ── 호출자 ───────────────────────────────────────────────────────────
//   pg_cron worker (net.http_post) — 매일 + 운영시간 주기 폴링('매일/변경시').
//     헤더 X-Internal-Cron: <internal_cron_secret> (worker 인증, dopamine-dispatch 동일 컨벤션)
//   POST body(옵션): { days_back?: number, days_forward?: number }  기본 back=1, forward=14
//
// ── 동작(reconcile, 멱등) ────────────────────────────────────────────
//   대상 창(window) = [today-days_back, today+days_forward] (KST).
//   날짜별로:
//     desired = 시트 출근자 이름 → 매칭된 staff_id 집합.
//     · source='google_sheet' 인데 desired 에 없는 행 → DELETE (시트에서 빠진 사람 반영).
//     · desired staff 중 행 없음 → INSERT (source=google_sheet, status=present, synced_at=now).
//     · desired staff 의 기존 google_sheet 행 → UPDATE synced_at/status.
//     · source IN ('manual','crm') 행 → 무접촉(현장 수기 override 보존).
//   → 항상-최신 라이브 시트 read 와 동일한 present 집합을 DB 에 재현(정합 회귀 0).
//
// ── 안전 ─────────────────────────────────────────────────────────────
//   service_role 로 동작(RLS bypass, 자동 적재). 파싱/매칭 실패 시 graceful:
//   해당 gid·날짜만 skip, throw 하지 않음(부분 성공 허용 — 전체 실패로 stale 되는 것 방지).
//   unmatched 시트 이름은 warn 로그(freshness/매핑 감사).
//
// read+write. 외부 의존: Google Sheets gviz CSV. DDL 무변경(테이블은 별 마이그).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// worker 인증용 (net.http_post 헤더 X-Internal-Cron 과 일치). dopamine-dispatch 컨벤션.
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
// 시트 문서 ID + 허용 gid (duty-sheet-read EF 와 동일 env 컨벤션).
const SHEET_ID =
  Deno.env.get("DUTY_SHEET_ID") ?? "1Ch4BhCZ1RPWKELedyWo6x60twjva3E0vXfHsiz_tRfo";
const SHEET_GIDS = (Deno.env.get("DUTY_SHEET_GIDS") ?? "341864863")
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
// foot=단일 클리닉이나, 명시적 clinic scope 을 env 로 고정(cross-CRM parity).
const CLINIC_ID = Deno.env.get("FOOT_CLINIC_ID") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey, x-internal-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 순수 파서 — src/lib/dutySheet.ts 이식(2001c73 검증 룰과 동일). 서버 재작성 아님.
// ─────────────────────────────────────────────────────────────────────
const REST_TOKENS = new Set(["휴진", "휴무", "오프", "off", "OFF", "-", "·", "–", "—"]);
const ALL_STAFF_TOKEN = "전직원";
const SUPERVISOR_TOKEN = "총괄";
const SUPERVISOR_NAME = "김주연";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
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
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(csv: string): string[][] {
  return csv
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(parseCsvLine);
}

interface DutyCandidate {
  name: string;
  date: string | null;
  team: string;
}

function dayNumberOf(cell: string): number | null {
  const s = (cell ?? "").toString().trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 1 && n <= 31 ? n : null;
}

function dayColumnsOf(row: string[]): Array<{ col: number; day: number }> {
  const out: Array<{ col: number; day: number }> = [];
  row.forEach((cell, ci) => {
    const d = dayNumberOf(cell);
    if (d != null) out.push({ col: ci, day: d });
  });
  return out;
}

function parseMonthHeader(
  row: string[],
): { year?: number; month?: number; team?: string } | null {
  // 월경계 교차주 가드(STAFFCAL-CROSSMONTH-SCHEDULE): 날짜 행(요일별 일자 ≥3)은
  // 'N월' 주석 셀이 있어도 헤더가 아니다(straddling week 누락 방지).
  if (dayColumnsOf(row).length >= 3) return null;

  let month: number | undefined;
  let year: number | undefined;
  let team: string | undefined;
  for (const cellRaw of row) {
    const cell = (cellRaw ?? "").toString().trim();
    if (!cell) continue;
    const mm = cell.match(/^(\d{1,2})\s*월$/);
    if (mm) {
      month = parseInt(mm[1], 10);
      continue;
    }
    const ym = cell.match(/^(20\d{2})$/);
    if (ym) {
      year = parseInt(ym[1], 10);
      continue;
    }
    if (!/^[월화수목금토일]$/.test(cell) && !/^\d+$/.test(cell)) {
      if (!team || cell.length > team.length) team = cell;
    }
  }
  if (month == null) return null;
  return { year, month, team };
}

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

function extractCandidates(
  grid: string[][],
  nowYear: number,
  nowMonth: number,
): { candidates: DutyCandidate[]; blocks: number } {
  let ctxYear = nowYear;
  let ctxMonth = nowMonth; // 헤더 없을 때만 쓰이는 fallback
  let team = "";
  const candidates: DutyCandidate[] = [];
  let blocks = 0;

  let i = 0;
  while (i < grid.length) {
    const row = grid[i] ?? [];

    const hdr = parseMonthHeader(row);
    if (hdr) {
      if (hdr.year != null) ctxYear = hdr.year;
      if (hdr.month != null) ctxMonth = hdr.month;
      if (hdr.team) team = hdr.team;
      i += 1;
      continue;
    }

    const dayCols = dayColumnsOf(row);
    if (dayCols.length >= 3) {
      blocks += 1;
      const { colDate, endYear, endMonth } = resolveRowDates(dayCols, ctxYear, ctxMonth);

      let j = i + 1;
      for (; j < grid.length; j++) {
        const arow = grid[j] ?? [];
        if (parseMonthHeader(arow)) break;
        if (dayColumnsOf(arow).length >= 3) break;
        for (const [col, date] of colDate) {
          const raw = (arow[col] ?? "").toString().trim();
          if (!raw) continue;
          if (REST_TOKENS.has(raw)) continue;
          candidates.push({ name: raw, date, team });
        }
      }

      ctxYear = endYear;
      ctxMonth = endMonth;
      i = j;
      continue;
    }

    i += 1;
  }

  return { candidates, blocks };
}

function parseAttendeesByDate(
  csv: string,
  allStaffNames: string[],
  nowYear: number,
  nowMonth: number,
): Record<string, string[]> {
  const grid = parseCsv(csv);
  const { candidates } = extractCandidates(grid, nowYear, nowMonth);
  const map: Record<string, string[]> = {};
  const push = (date: string, n: string) => {
    const t = (n ?? "").trim();
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

// ─────────────────────────────────────────────────────────────────────
// KST 날짜 유틸 (Deno UTC → Asia/Seoul)
// ─────────────────────────────────────────────────────────────────────
function seoulYmd(offsetDays = 0): { iso: string; year: number; month: number } {
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  const y = nowKst.getUTCFullYear();
  const m = nowKst.getUTCMonth() + 1;
  const d = nowKst.getUTCDate();
  return { iso: `${y}-${pad2(m)}-${pad2(d)}`, year: y, month: m };
}

async function fetchSheetCsv(gid: string): Promise<string> {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`gviz ${gid} status ${res.status}`);
  return await res.text();
}

// ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  // 내부 호출 인증(cron_secret) — dopamine-dispatch 동일.
  if (CRON_SECRET) {
    const got = req.headers.get("X-Internal-Cron") ?? "";
    if (got !== CRON_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  }

  let daysBack = 1;
  let daysForward = 14;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.days_back === "number") daysBack = Math.max(0, Math.min(31, body.days_back));
    if (typeof body.days_forward === "number") {
      daysForward = Math.max(0, Math.min(60, body.days_forward));
    }
  } catch {
    // 빈 body 허용
  }

  // clinic_id 확정 (env 우선, 없으면 단일 clinic 조회)
  let clinicId = CLINIC_ID;
  if (!clinicId) {
    const { data: clinics, error: cErr } = await supabase
      .from("clinics")
      .select("id")
      .limit(2);
    if (cErr) return json({ ok: false, error: `clinics: ${cErr.message}` }, 500);
    if (!clinics || clinics.length !== 1) {
      return json(
        { ok: false, error: "clinic_id 미확정 — FOOT_CLINIC_ID env 설정 필요", found: clinics?.length ?? 0 },
        500,
      );
    }
    clinicId = clinics[0].id as string;
  }

  // active staff 로드 — display_name 컬럼 미존재(HOTFIX 교훈) → name 만.
  const { data: staffRows, error: sErr } = await supabase
    .from("staff")
    .select("id, name")
    .eq("clinic_id", clinicId)
    .eq("active", true);
  if (sErr) return json({ ok: false, error: `staff: ${sErr.message}` }, 500);
  const staffList = (staffRows ?? []) as Array<{ id: string; name: string }>;
  const nameToId = new Map<string, string>();
  for (const s of staffList) {
    const nm = (s.name ?? "").trim();
    if (nm) nameToId.set(nm, s.id);
  }
  const allStaffNames = staffList.map((s) => (s.name ?? "").trim()).filter(Boolean);

  // 대상 창 날짜 집합
  const nowRef = seoulYmd(0);
  const windowDates = new Set<string>();
  for (let d = -daysBack; d <= daysForward; d++) windowDates.add(seoulYmd(d).iso);

  // 모든 gid CSV → 날짜별 출근자 이름 병합
  const attendeesByDate: Record<string, Set<string>> = {};
  const unmatched = new Set<string>();
  const gidErrors: string[] = [];
  for (const gid of SHEET_GIDS) {
    try {
      const csv = await fetchSheetCsv(gid);
      const map = parseAttendeesByDate(csv, allStaffNames, nowRef.year, nowRef.month);
      for (const [date, names] of Object.entries(map)) {
        if (!windowDates.has(date)) continue;
        const set = attendeesByDate[date] ?? (attendeesByDate[date] = new Set());
        for (const n of names) set.add(n);
      }
    } catch (e) {
      gidErrors.push(`${gid}: ${String(e)}`); // graceful — 다른 gid 계속
    }
  }

  const nowIso = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let deleted = 0;

  // 날짜별 reconcile — google_sheet source 만 대상, manual/crm 무접촉.
  for (const date of windowDates) {
    const names = attendeesByDate[date] ?? new Set<string>();
    const desiredIds = new Set<string>();
    for (const nm of names) {
      const id = nameToId.get(nm);
      if (id) desiredIds.add(id);
      else unmatched.add(nm);
    }

    // 기존 행 로드(해당 date, clinic)
    const { data: existing, error: exErr } = await supabase
      .from("staff_attendance")
      .select("id, staff_id, source, status")
      .eq("clinic_id", clinicId)
      .eq("date", date);
    if (exErr) {
      gidErrors.push(`load ${date}: ${exErr.message}`);
      continue;
    }
    const existingSheet = new Map<string, { id: string }>(); // staff_id → row
    const manualStaff = new Set<string>();
    for (const r of existing ?? []) {
      if (r.source === "google_sheet") existingSheet.set(r.staff_id, { id: r.id });
      else manualStaff.add(r.staff_id); // manual/crm — 보존
    }

    // 1) DELETE: google_sheet 인데 desired 에서 빠진 사람
    const toDelete: string[] = [];
    for (const [staffId, row] of existingSheet) {
      if (!desiredIds.has(staffId)) toDelete.push(row.id);
    }
    if (toDelete.length) {
      const { error: dErr } = await supabase.from("staff_attendance").delete().in("id", toDelete);
      if (dErr) gidErrors.push(`delete ${date}: ${dErr.message}`);
      else deleted += toDelete.length;
    }

    // 2) INSERT/UPDATE desired
    const toInsert: Array<Record<string, unknown>> = [];
    const toTouch: string[] = [];
    for (const staffId of desiredIds) {
      if (manualStaff.has(staffId)) continue; // 수기 override 보존(재적재 안 함)
      const cur = existingSheet.get(staffId);
      if (cur) toTouch.push(cur.id);
      else {
        toInsert.push({
          clinic_id: clinicId,
          date,
          staff_id: staffId,
          source: "google_sheet",
          status: "present",
          synced_at: nowIso,
        });
      }
    }
    if (toInsert.length) {
      const { error: iErr } = await supabase.from("staff_attendance").insert(toInsert);
      if (iErr) gidErrors.push(`insert ${date}: ${iErr.message}`);
      else inserted += toInsert.length;
    }
    if (toTouch.length) {
      const { error: uErr } = await supabase
        .from("staff_attendance")
        .update({ status: "present", synced_at: nowIso, updated_at: nowIso })
        .in("id", toTouch);
      if (uErr) gidErrors.push(`update ${date}: ${uErr.message}`);
      else updated += toTouch.length;
    }
  }

  const ok = gidErrors.length === 0;
  if (unmatched.size) {
    console.warn("[attendance-sync] unmatched sheet names:", [...unmatched].join(", "));
  }
  if (gidErrors.length) console.warn("[attendance-sync] errors:", gidErrors.join(" | "));

  return json({
    ok,
    clinic_id: clinicId,
    window: { back: daysBack, forward: daysForward, dates: windowDates.size },
    staff_active: staffList.length,
    inserted,
    updated,
    deleted,
    unmatched: [...unmatched],
    errors: gidErrors,
    synced_at: nowIso,
  });
});
