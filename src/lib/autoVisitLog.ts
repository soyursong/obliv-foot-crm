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
  /** 세션 고유 id — 세션 grain 개별 행의 안정 key·같은 날 다회 차감 tiebreak(optional, 구조적 수용). */
  id?: string;
  /** 패키지 내 회차 번호 — 같은 날 다회 차감 시 개별 행 오름차순 정렬 tiebreak(optional). */
  session_number?: number;
};

export interface AutoVisitLogRow {
  key: string;
  /** 방문(치료) 일자 (yyyy-MM-dd) */
  date: string;
  /** 패키지내용(함축) — interim: "{총회차}회" */
  packageContent: string;
  /** 금일 치료 횟수 = "{패키지 총회수(고정)}-{실차감 세션 순번}" (예: 24-1, 24-2, 24-3 … 차감 1건마다 +1) */
  todayCount: string;
  /** 차감치료사 (해당 차감을 수행한 담당 치료사, null 은 '-') */
  therapists: string;
}

/**
 * 방문일별 치료내역 자동 집계.
 * 행 grain = package_session 1건(실차감 status==='used' 세션 1개 = 화면 1행).
 *   ★같은 날 다회 차감 시 그 날짜에 대해 개별 행을 그만큼 전개(collapse 금지).
 *   취소/환불 회차는 치료(차감) 아님 — 제외.
 * 정렬 = 일자 최신순(DESC). 고객당 1 히스토리 테이블에 방문행 누적(per-visit 폼 재생성 아님).
 *
 * - 패키지내용 = 해당 패키지 총 회수 "{total}회" (interim).
 * - 금일 치료 횟수 = "{패키지 총회수(고정)}-{실차감 세션 순번}" (예: 24-1, 24-2, 24-3 …).
 *     T-20260814-foot-PENCHART-SESCOUNT-SAMEDAY-PERSESSION-ROW-FIX (김주연 총괄 U0ATDB587PV,
 *     ★확정 스펙 = 같은 날 다회 차감을 개별 행으로 전개 · 뒤 숫자 = 실차감 세션 오름차순 running index):
 *     ★RETRACT 된 방향(재사용 금지):
 *       · 부모 T-20260811 SESCOUNT-CUMULATIVE-FIX = 방문일 running-index(1행 collapse, 누적 세션 수).
 *       · T-20260814 VISITDATE/VISITDAY-ORDINAL/GRAIN-FIX 3티켓(전부 status:cancelled) =
 *         방문일 순번으로 같은 날 다회 차감을 1행 collapse. → 정반대 방향, 값·grain 재사용 금지.
 *     확정 재정의(본 티켓):
 *       · 차감 1건 = 화면 1행(같은 날 2회 차감이면 그 날 2개 행).
 *       · 뒤 숫자 = 실차감 세션(status==='used') 오름차순 running index(세션 grain, 같은 날도 개별 +1).
 *       · 재현: 임승원 #F-5819(12회권) 08-07=12-1(1행) · 08-14 2회 차감=12-2(행1)·12-3(행2) 2개 행.
 *       · 앞 = 패키지 총회수(packages.total_sessions, 방문 무관 고정) 불변.
 *       · 같은 날 다회 차감 정렬 tiebreak = session_number → id(안정 결정적 순서).
 *       · 취소/환불 세션 제외(status==='used' 만 running index 산입) — 부모 spec 계승.
 *       · READ-ONLY 파생(packages/package_sessions write-back 0, db_change=false).
 *     ★직교축 무접촉: '패키지내용' 보험구분 함축('비N/가M')은 INSURANCE-SPLIT-PHASE2 소관 — 미접촉.
 * - 차감치료사 = 해당 차감을 수행한 담당 치료사(세션별), null 은 '-'.
 */
export function buildAutoVisitLogRows(
  packages: AutoVisitLogPackage[],
  sessions: AutoVisitLogSession[],
): AutoVisitLogRow[] {
  const pkgById = new Map(packages.map((p) => [p.id, p]));

  // 실차감(used) 세션만 수집 — 각 세션 = 1행(같은 날 다회 차감이면 그 수만큼 개별 행).
  const byPkg = new Map<string, AutoVisitLogSession[]>();
  for (const s of sessions) {
    if (s.status !== 'used') continue; // 취소/환불 회차 제외
    if (!s.session_date) continue;
    const arr = byPkg.get(s.package_id);
    if (arr) arr.push(s);
    else byPkg.set(s.package_id, [s]);
  }

  // 패키지별 실차감 세션 오름차순 정렬 → running index(세션 grain, 같은 날도 개별 +1) 부여.
  //   정렬 = 날짜 오름차순 → 같은 날은 session_number → id 로 안정·결정적 tiebreak.
  //   T-20260814-...-SESCOUNT-SAMEDAY-PERSESSION-ROW-FIX: 하루 2회 차감이면 12-2·12-3 개별 2행.
  const sessCmp = (a: AutoVisitLogSession, b: AutoVisitLogSession): number => {
    if (a.session_date !== b.session_date) return a.session_date < b.session_date ? -1 : 1;
    const an = a.session_number ?? Number.POSITIVE_INFINITY;
    const bn = b.session_number ?? Number.POSITIVE_INFINITY;
    if (an !== bn) return an - bn;
    const ai = a.id ?? '';
    const bi = b.id ?? '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  };

  const rows: AutoVisitLogRow[] = [];
  for (const [pkgId, arr] of byPkg) {
    arr.sort(sessCmp);
    const total = pkgById.get(pkgId)?.total_sessions ?? null;
    arr.forEach((s, i) => {
      const idx = i + 1; // 실차감 세션 오름차순 running index (차감 1건마다 +1, 1-based)
      const key = s.id ? `sess-${s.id}` : `${s.session_date}__${pkgId}__${idx}`;
      rows.push({
        key,
        date: s.session_date,
        packageContent: total != null ? `${total}회` : '-',
        // 앞 = 총회수(고정) · 뒤 = 실차감 세션 순번. 총회수 미상이면 뒤 순번만 표기.
        todayCount: total != null ? `${total}-${idx}` : `-${idx}`,
        therapists: s.staff_name ?? '-',
      });
    });
  }

  // 최신순 (session_date DESC). 같은 날 다회 차감 행은 stable-sort 로 running index 오름차순 유지.
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────
// T-20260809-foot-PENCHART-EDITABLE-INCHARTFORM-REWORK
//   READ-ONLY 자동집계 → 수정·저장·출력 가능 편집형으로 전환.
//   저장방식 = form_submissions.field_data JSONB 재사용(DA-REPLY GO MSG-20260809-094535-db57,
//   SSOT da_decision_foot_penchart_editable_storage_20260809). 신규 테이블/컬럼 0 · ADDITIVE · db_change=false.
//
//   HARD verify-gate(DA) 준수:
//   - VG1(dispositive·방화벽): overlay ONLY. package_sessions/packages ledger write-back 0.
//       counting/comp/KPI 파생은 항상 package_sessions read(본 편집 overlay 는 표시/문서 축일 뿐).
//   - VG2(reader): 편집본(overlay) 존재→overlay 우선, 부재→package_sessions 파생 seed 보존.
//   - VG3(writer): form_key='penchart_auto_visit_log' insert 누적 + rows-affected 검증(호출부 컴포넌트).
//   - VG4(PHI/RRN): raw full RRN 미저장(field_data at-rest 금지). print-time canonical 조인 + 마스킹 렌더.
//   - VG5(phase2 방화벽): 급여/비급여 수동입력(note) = 문서 표시 주석 ONLY. 매출/정산 canonical split 아님.
// ─────────────────────────────────────────────────────────────────────────

/** form_submissions.field_data 편집본(overlay) 식별 form_key. template_id=NULL 내부 상태 레코드 패턴. */
export const PENCHART_AUTO_VISIT_LOG_FORM_KEY = 'penchart_auto_visit_log';

/** 편집 가능한 방문기록 행. 자동집계 4열 + 급여/비급여 수동 주석(note, VG5 표시 전용). */
export interface EditableVisitLogRow {
  key: string;
  /** 방문(치료) 일자 */
  date: string;
  /** 패키지내용 */
  packageContent: string;
  /** 금일 치료 횟수 */
  todayCount: string;
  /** 차감치료사 */
  therapists: string;
  /** 급여/비급여 수동 주석 (VG5: 문서 표시 전용 — canonical 매출 split 아님) */
  note: string;
}

/** field_data 에 영속되는 편집본 스냅샷 shape. PHI(raw RRN) 미포함(VG4 at-rest 금지). */
export interface PenchartAutoVisitLogFieldData {
  form_key: typeof PENCHART_AUTO_VISIT_LOG_FORM_KEY;
  saved_at: string;
  rows: EditableVisitLogRow[];
}

/**
 * AC-4 대상 판정 — 1회권 이상 패키지 생성 후 '치료 진행' 환자만 자동기록 대상.
 *   - 1회권 이상 패키지 생성 = total_sessions >= 1 패키지 1개 이상 보유.
 *   - 치료 진행 = 실차감(status==='used') 회차 1개 이상 존재.
 * 대상 아니면 자동기록/편집 비대상(빈 상태).
 */
export function isAutoVisitLogEligible(
  packages: AutoVisitLogPackage[],
  sessions: AutoVisitLogSession[],
): boolean {
  const hasPackage = packages.some((p) => (p.total_sessions ?? 0) >= 1);
  const inTreatment = sessions.some((s) => s.status === 'used');
  return hasPackage && inTreatment;
}

/** package_sessions 파생 seed 를 편집 가능 행으로 승격(VG2 seed 경로 보존). note 는 공란 시작. */
export function seedEditableRows(
  packages: AutoVisitLogPackage[],
  sessions: AutoVisitLogSession[],
): EditableVisitLogRow[] {
  return buildAutoVisitLogRows(packages, sessions).map((r) => ({
    key: r.key,
    date: r.date,
    packageContent: r.packageContent,
    todayCount: r.todayCount,
    therapists: r.therapists,
    note: '',
  }));
}

/**
 * VG2 reader — 편집본(overlay) 존재 시 overlay 우선, 부재 시 package_sessions 파생 seed.
 * overlay 가 유효한 배열이면(빈 배열 포함, 사용자가 의도적으로 비운 경우도 편집본) 그대로 채택.
 */
export function resolveEffectiveRows(
  overlay: EditableVisitLogRow[] | null | undefined,
  seed: EditableVisitLogRow[],
): EditableVisitLogRow[] {
  return Array.isArray(overlay) ? overlay : seed;
}

/**
 * VG4 print-time 마스킹 — RRN 은 어떤 자릿수도 노출하지 않는다(전체 마스킹 placeholder).
 * 입력 rrn 은 인메모리 canonical 조인값이며 반환/저장되지 않는다.
 */
export function maskRrnForPrint(rrn: string | null | undefined): string {
  const digits = (rrn ?? '').replace(/\D/g, '');
  if (digits.length < 7) return '●●●●●●-●●●●●●●';
  return '●●●●●●-●●●●●●●';
}

export interface AutoVisitLogPrintParams {
  customerName: string;
  chartNumber?: string | null;
  /** 인메모리 canonical RRN(마스킹 렌더 전용 — HTML 에 자릿수 미포함) */
  rrn?: string | null;
  /** 성별 라벨(파생, 표시전용) — deriveGenderFromRRN 결과 */
  genderLabel?: string | null;
  rows: EditableVisitLogRow[];
  printedAt: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 펜차트(자동기록용) 출력 HTML 빌드 — 새 창 인쇄용(window.print).
 * VG4: 환자 식별 = 이름 + 차트번호 + 성별(파생) + 마스킹 RRN(자릿수 0 노출).
 *      raw RRN 은 HTML 어디에도 삽입하지 않는다.
 */
export function buildAutoVisitLogPrintHtml(p: AutoVisitLogPrintParams): string {
  const maskedRrn = maskRrnForPrint(p.rrn);
  const genderPart = p.genderLabel ? ` <span class="g">(${escapeHtml(p.genderLabel)})</span>` : '';
  const headerRows = p.rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.packageContent)}</td>` +
        `<td>${escapeHtml(r.todayCount)}</td><td>${escapeHtml(r.therapists)}</td>` +
        `<td>${escapeHtml(r.note)}</td></tr>`,
    )
    .join('');
  return (
    `<div class="pc-wrap">` +
    `<h1>펜차트(자동기록용)</h1>` +
    `<div class="meta">` +
    `<span>성명: <b>${escapeHtml(p.customerName)}</b>${genderPart}</span>` +
    (p.chartNumber ? `<span>차트번호: ${escapeHtml(p.chartNumber)}</span>` : '') +
    `<span>주민등록번호: ${maskedRrn}</span>` +
    `<span>출력일시: ${escapeHtml(p.printedAt)}</span>` +
    `</div>` +
    `<table class="pc-table"><thead><tr>` +
    `<th>일자</th><th>패키지내용</th><th>금일 치료 횟수</th><th>차감치료사</th><th>비고(급여/비급여)</th>` +
    `</tr></thead><tbody>${headerRows || '<tr><td colspan="5" class="empty">기록 없음</td></tr>'}</tbody></table>` +
    `</div>`
  );
}
