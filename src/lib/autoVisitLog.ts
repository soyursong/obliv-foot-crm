// T-20260808-foot-PENCHART-AUTORECORD-VISITLOG-2CHART
// 펜차트(자동기록용) 방문일별 치료내역 자동 집계 — 순수 로직 SSOT (React/DOM 무관, 단위 테스트 대상).
//
// ⚠ interim 범위(planner AC-3, 2026-08-08): 패키지내용 = 총 회수만 표기(예: "12회").
//   급여/비급여 회차 split("비N/가M")은 phase2(T-20260808-foot-PENCHART-INSURANCE-SPLIT-PHASE2,
//   DA CONSULT MSG-20260808-233719-paig 대기) — 현 데이터모델에 패키지별 급여/비급여 회차 필드 부재.
//   READ-ONLY 파생, db_change=false.

/** 집계에 필요한 최소 필드만 구조적 타입으로 수용(상위형 PackageWithRemaining 등 허용). */
export type AutoVisitLogPackage = {
  id: string;
  total_sessions: number;
};

export type AutoVisitLogSession = {
  package_id: string;
  session_date: string;
  status: string;
  staff_name: string | null;
};

export interface AutoVisitLogRow {
  key: string;
  /** 방문(치료) 일자 (yyyy-MM-dd) */
  date: string;
  /** 패키지내용(함축) — interim: "{총회차}회" */
  packageContent: string;
  /** 금일 치료 횟수 = "{총회수}-{당일차감횟수}" (예: "12-1") */
  todayCount: string;
  /** 차감치료사 (당일 차감 수행 담당 치료사, 복수 시 ', ' join) */
  therapists: string;
}

/**
 * 방문일별 치료내역 자동 집계.
 * 그룹 grain = (session_date, package_id). status==='used'(실차감)만 카운트
 *   (취소/환불 회차는 치료(차감) 아님 — 제외).
 * 정렬 = 일자 최신순(DESC). 고객당 1 히스토리 테이블에 방문행 누적(per-visit 폼 재생성 아님).
 *
 * - 패키지내용 = 해당 패키지 총 회수 "{total}회" (interim).
 * - 금일 치료 횟수 = "{total}-{당일 차감건수}" (reporter item#5 · 스샷 "5-1" 형식).
 * - 차감치료사 = 당일 차감 수행 치료사(들), null 은 '-'.
 */
export function buildAutoVisitLogRows(
  packages: AutoVisitLogPackage[],
  sessions: AutoVisitLogSession[],
): AutoVisitLogRow[] {
  const pkgById = new Map(packages.map((p) => [p.id, p]));

  type Group = { date: string; pkgId: string; count: number; therapists: Set<string> };
  const groups = new Map<string, Group>();

  for (const s of sessions) {
    if (s.status !== 'used') continue; // 취소/환불 회차 제외
    if (!s.session_date) continue;
    const key = `${s.session_date}__${s.package_id}`;
    let g = groups.get(key);
    if (!g) {
      g = { date: s.session_date, pkgId: s.package_id, count: 0, therapists: new Set<string>() };
      groups.set(key, g);
    }
    g.count += 1;
    if (s.staff_name) g.therapists.add(s.staff_name);
  }

  const rows: AutoVisitLogRow[] = [];
  for (const [key, g] of groups) {
    const total = pkgById.get(g.pkgId)?.total_sessions ?? null;
    rows.push({
      key,
      date: g.date,
      packageContent: total != null ? `${total}회` : '-',
      todayCount: total != null ? `${total}-${g.count}` : `-${g.count}`,
      therapists: g.therapists.size > 0 ? Array.from(g.therapists).join(', ') : '-',
    });
  }

  // 최신순 (session_date DESC)
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows;
}
