/**
 * T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1
 * 경과분석 인풋 .md 생성 (계보 재사용 · 재가공 금지).
 *
 * ★출처 = scripts/T-20260821-foot-TXMEMO-6MULTIPLE-PROGRESS-MD-ZIP.mjs (READ-ONLY 추출 스크립트, 계보 5SEC-CLINITEXT e93671c1).
 *   그 스크립트의 5섹션 md 조립 로직·판단규칙(R1~R5)·과거력 라벨맵을 **그대로 이식**(재가공 금지).
 *   차이점은 실행 위치뿐: 서버(Management API, postgres 무RLS) → FE(브라우저 supabase 클라이언트, admin/manager RLS).
 *   ⇒ 진료대시보드>경과분석 탭에서 원장이 행별/전체선택으로 직접 인풋 .md 를 뽑는다.
 *
 * 5섹션(구분선 --- 로 합산):
 *   1. 치료메모        ← customer_treatment_memos (활성)
 *   2. 처방내역        ← prescriptions + prescription_items
 *   3. 과거력          ← health_q_results.form_data (QR 셀프접수 발건강 질문지)
 *   4. 첫날 상담차트    ← customer_consult_memos(첫방문일) + medical_charts(첫방문일)
 *   5. 임상 유의미 텍스트 ← customer_consult_memos(전량) + medical_charts(전 임상필드) − 루틴상용구(phrase_templates/super_phrases)
 * 헤더 = 성함·차트번호 + **6배수 예정 회차·예약일**(★티켓 요구) + 내원 요약.
 *
 * ★ADDITIVE(T-20260822-foot-PROGANALYSIS-EXTRACT-VISIT-MOVEMENT-SECTIONS): 위 5섹션 무접촉·재가공 금지.
 *   6. 진료내역        ← check_ins (방문별 방문일/접수시각/귀가시각/사유·취소제외·방문일 오름차순)
 *   7. 동선 로그        ← check_in_room_logs (방문별 슬롯 체류·레이저 슬롯 유무=치료 시행 판정·이상치는 표기만)
 *   6·7 조인 키 = 방문(check_in). read-only(db_change=false)·기존 추출 경로(행별/ZIP/개별)에 SSOT 자동반영.
 *
 * ★ADDITIVE(T-20260822-foot-PROGANALYSIS-EXTRACT-PKGRESV-SECTIONS): 위 1~7섹션 무접촉·재가공 금지.
 *   8. 활성 패키지    ← packages(status='active') 시술구분별 발급 총회차 + package_sessions(used) 소진 카운트
 *                      (표시로직 = PackageTicketReadonlyList.tsx 그대로 이식). 전체잔여 = Σ잔여.
 *   9. 예약내역        ← reservations 전건(취소포함·최신순) + 예약메모(booking_memo canonical)+간략메모+메모.
 *   목적 = 6회차 가열(힐러)/비가열 판정(참고표기, 별도 필드 아님). 판정우선순위: 1순위 예약메모 > 2순위 활성패키지 가열잔여.
 *   read-only(db_change=false)·schema 0·기존 배송로직(ZIP/개별) 불변. 동일 clinic-scoped RLS 경계 내.
 *
 * GATE: read-only 조회만. DB/스키마/트리거/write 0(db_change=false). 외부 AI 미경유(결정론 규칙).
 * PHI: 산출 .md = 진료성 PHI. 호출부(경과분석 탭)에서 admin/manager(운영권한) 게이팅 + export 감사로그.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { anticipatedSession, isSixMultipleTarget, chunkIds, IN_CHUNK_SIZE, DEFAULT_CHECKPOINT_INTERVAL } from './progressSixMultiple';

/* ────────────────────────── 순수 유틸 (스크립트 그대로 이식) ────────────────────────── */

function arr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function pad(s: unknown): string {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
}
function dOnly(ts: unknown): string {
  return ts ? String(ts).slice(0, 10) : '(없음)';
}
/** 파일시스템 안전 파일명 조각(스크립트 safeName 그대로). */
export function safeName(s: unknown): string {
  return (
    String(s ?? '')
      .replace(/[\\/:*?"<>| -]/g, '')
      .replace(/\s+/g, '_')
      .replace(/\.+$/, '')
      .slice(0, 80) || 'unknown'
  );
}

// 정규화: 공백류 단일화 + 좌우 trim (상용구/라인 비교 canonical form)
function norm(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}
// 미선택 플레이스홀더 판정 ('없음'은 include — 원장 답변 반영, 스크립트 주석 참조)
const PLACEHOLDER_SET = new Set([
  '', '-', 'ㅡ', '_', '.', ':', 'x', 'X',
  'y/n', 'n/y', '유/무', '무/유', '유 / 무', '유/무:', '(유/무)',
  'n/sy/dy/py', '유/무:유',
  'n/a', 'na', 'tbd',
]);
function isPlaceholderValue(v: unknown): boolean {
  const t = norm(v).toLowerCase().replace(/[()（）[\]·・,，]/g, '').replace(/\s+/g, '');
  if (t === '') return true;
  if (PLACEHOLDER_SET.has(t)) return true;
  if (/^[-ㅡ/ynsdp유무\s]+$/i.test(t)) return true;
  return false;
}
function isSignatureLine(line: string): boolean {
  const t = norm(line);
  return /^(dr\.?\s*[가-힣a-z]{1,10}|drㅤ)$/i.test(t);
}
function isSeparatorLine(line: string): boolean {
  const t = norm(line);
  return t === '' || /^[-=_*·・.\s]+$/.test(t) || /^\d+[.)]?$/.test(t);
}
/** 원문 → 유의미 라인만 추출(스크립트 extractMeaningful 그대로). */
function extractMeaningful(
  text: unknown,
  boilerSet: Set<string>,
): { kept: string[]; dropped: number; wholeBoiler: boolean } {
  const raw = String(text ?? '');
  if (norm(raw) === '') return { kept: [], dropped: 0, wholeBoiler: false };
  if (boilerSet.has(norm(raw))) return { kept: [], dropped: raw.split(/\r?\n/).length, wholeBoiler: true };
  const kept: string[] = [];
  let dropped = 0;
  for (const rawLine of raw.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (isSeparatorLine(line)) {
      if (norm(line) !== '') dropped++;
      continue;
    }
    if (isSignatureLine(line)) {
      dropped++;
      continue;
    }
    const m = line.match(/^\s*([^:：]{1,24})\s*[:：]\s*(.*)$/);
    if (m) {
      const val = m[2];
      if (isPlaceholderValue(val)) {
        dropped++;
        continue;
      }
      kept.push(line.trim());
      continue;
    }
    kept.push(line.trim());
  }
  return { kept, dropped, wholeBoiler: false };
}

/* ─── 【6】【7】 (T-20260822-foot-PROGANALYSIS-EXTRACT-VISIT-MOVEMENT-SECTIONS) 전용 순수 유틸 ─── */

// check_ins.visit_type → 사유 라벨
function visitReasonLabel(visitType: unknown, treatmentCategory: unknown): string {
  const vt = String(visitType ?? '').trim();
  const base = vt === 'new' ? '신규' : vt === 'returning' ? '재진' : vt === 'experience' ? '체험' : vt || '(미상)';
  const cat = pad(treatmentCategory);
  return cat ? `${base} · ${cat}` : base;
}
// check_in_room_logs.room_type → 슬롯명 (레이저는 치료실로 병합하지 않고 독립 표기 = 치료 시행 판정축)
const ROOM_TYPE_SLOT_LABEL: Record<string, string> = {
  consultation: '상담실',
  treatment: '치료실',
  laser: '레이저',
  heated_laser: '가열레이저',
  unheated_laser: '비가열레이저',
  payment: '수납',
  examination: '진료실',
  preconditioning: '사전처치',
};
function roomSlotLabel(roomType: unknown, assignedRoom: unknown): string {
  const rt = String(roomType ?? '').trim().toLowerCase();
  const label = ROOM_TYPE_SLOT_LABEL[rt] ?? (rt || '(슬롯미상)');
  const room = pad(assignedRoom);
  return room ? `${label}(${room})` : label;
}
// 레이저 슬롯 판정 (치료 시행 여부) — room_type/assigned_room 어느 쪽이든 'laser'/'레이저' 포함
function isLaserRoom(roomType: unknown, assignedRoom: unknown): boolean {
  const hay = `${String(roomType ?? '')} ${String(assignedRoom ?? '')}`.toLowerCase();
  return hay.includes('laser') || hay.includes('레이저');
}
// 체류시간(ms) 사람이 읽는 라벨. 24h 이상은 로그아웃 누락 추정 이상치 → 원값 유지 + 표기 병행(절삭/대체 금지).
const DWELL_ANOMALY_MS = 24 * 60 * 60 * 1000;
function formatDwell(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '(종료 미기록)';
  if (ms < 0) return '(시각역전)';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const label = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  return ms >= DWELL_ANOMALY_MS ? `${label} ⚠이상치(로그아웃 누락 추정)` : label;
}
// timestamptz → Asia/Seoul 기준 { 방문일, 시각(HH:MM) }. 【6】【7】 방문일 조인축 내부 일관성 보장.
function seoulDateTime(ts: unknown): { date: string; time: string } {
  if (!ts) return { date: '(없음)', time: '(미기록)' };
  const d = new Date(String(ts));
  if (Number.isNaN(d.getTime())) return { date: dOnly(ts), time: '(미기록)' };
  // sv-SE 로케일 → "YYYY-MM-DD HH:MM:SS"
  const s = d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/* ─── 【8】【9】 (T-20260822-foot-PROGANALYSIS-EXTRACT-PKGRESV-SECTIONS) 전용 순수 유틸 ─── */

// 활성 패키지 시술구분 행 매핑 = PackageTicketReadonlyList.tsx 표시로직 그대로 이식(재가공 금지).
//   token = package_sessions.session_type(소진축) · qtyKey = packages.{...}_sessions(발급 총회차축).
//   ⚠ 컬럼명 오타 유지: podologe_sessions(발급) ↔ session_type 'podologue'(소진).
const PKG_SESSION_TYPES: Array<{ sessionType: string; label: string; qtyKey: string }> = [
  { sessionType: 'unheated_laser', label: '비가열', qtyKey: 'unheated_sessions' },
  { sessionType: 'heated_laser', label: '가열', qtyKey: 'heated_sessions' },
  { sessionType: 'podologue', label: '포돌로게', qtyKey: 'podologe_sessions' },
  { sessionType: 'iv', label: '수액', qtyKey: 'iv_sessions' },
  { sessionType: 'trial', label: '체험권', qtyKey: 'trial_sessions' },
  { sessionType: 'reborn', label: 'Re:Born', qtyKey: 'reborn_sessions' },
];

// 예약 status → 현장 라벨. 취소예약은 【9】에 포함하되 (취소)로 명시 표기(현장친화·이력 온전).
const RESV_STATUS_LABEL: Record<string, string> = {
  confirmed: '예약확정',
  checked_in: '내원(체크인)',
  cancelled: '취소',
  no_show: '노쇼',
};
function resvStatusLabel(status: unknown): string {
  const s = String(status ?? '').trim();
  return RESV_STATUS_LABEL[s] ?? (s || '(상태미상)');
}

// 예약메모 텍스트에서 가열/힐러↔비가열 단서 감지(판정 1순위).
//   ⚠ '비가열'은 '가열'을 부분문자열로 포함 → 비가열을 먼저 판정(오분류 방지).
function detectHeatingSignal(text: unknown): 'heated' | 'unheated' | null {
  const t = norm(text);
  if (!t) return null;
  if (/비가열/.test(t)) return 'unheated';
  if (/가열|힐러/.test(t)) return 'heated';
  return null;
}

// 과거력(발건강 질문지 form_data) 라벨 맵 (스크립트 그대로)
type HqKind = 'arr' | 'str' | 'bool' | 'raw' | 'nail';
const HQ_MED_FIELDS: Array<[string, string, HqKind]> = [
  ['medical_history', '기저질환·과거병력', 'arr'],
  ['medical_history_other', '기타 병력(직접입력)', 'str'],
  ['medical_history_none', '기저질환 없음 체크', 'bool'],
  ['medications', '복용약물', 'arr'],
  ['medications_other', '기타 복용약(직접입력)', 'str'],
  ['medications_none', '복용약 없음 체크', 'bool'],
  ['has_allergy', '알러지 여부', 'raw'],
  ['allergies', '알러지 내용', 'str'],
  ['family_history_type', '가족력', 'str'],
];
const HQ_FOOT_FIELDS: Array<[string, string, HqKind]> = [
  ['symptoms', '주요 증상', 'arr'],
  ['symptoms_other', '기타 증상(직접입력)', 'str'],
  ['foot_concern_symptoms', '발 우려 증상', 'arr'],
  ['symptom_onset', '증상 발생시기', 'str'],
  ['foot_pain_level', '통증 정도', 'str'],
  ['concern_nail_sites', '문제 발톱 부위', 'nail'],
  ['nail_treatment_history', '기존 네일치료 이력', 'str'],
  ['nail_treatment_methods', '기존 네일치료 방법', 'arr'],
  ['pedicure_removed', '페디큐어 제거 여부', 'str'],
  ['visit_frequency', '내원 가능 빈도', 'str'],
  ['treatment_start_timing', '치료 시작 희망시기', 'str'],
  ['prone_30min_ok', '30분 엎드림 가능', 'str'],
  ['has_private_insurance', '실손보험 가입', 'str'],
  ['insurance_company', '보험사', 'str'],
  ['visit_purpose', '방문 목적', 'str'],
];
function renderHqValue(kind: HqKind, v: unknown): string {
  if (kind === 'arr') {
    const a = arr(v);
    return a.length ? a.map(String).join(', ') : '-';
  }
  if (kind === 'bool') return v === true ? '예' : v === false ? '아니오' : '-';
  if (kind === 'raw') return v === null || v === undefined || v === '' ? '-' : String(v);
  if (kind === 'nail') {
    const a = arr<Record<string, unknown>>(v);
    if (!a.length) return '-';
    return a
      .map((s) => (s && typeof s === 'object' ? `${s['side'] ?? '?'}${s['toe'] ?? '?'}` : String(s)))
      .join(', ');
  }
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? '-' : s;
}

/* ────────────────────────── 데이터 shape ────────────────────────── */

export interface ProgressAnalysisPatient {
  id: string;
  name: string | null;
  chart_number: string | null;
}
interface Milestone {
  anticipated: number;
  used: number;
  total: number;
}
interface Memo {
  content: string | null;
  created_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
}
interface RxItem {
  medication_name: string | null;
  dosage: string | null;
  duration_days: number | null;
  quantity: number | null;
  memo: string | null;
}
interface Rx {
  id: string;
  prescribed_at: string | null;
  prescribed_by_name: string | null;
  diagnosis: string | null;
  memo: string | null;
  created_at: string | null;
  items: RxItem[];
}
interface Hq {
  form_data: Record<string, unknown> | null;
  submitted_at: string | null;
  created_at: string | null;
}
interface Consult {
  content: string | null;
  created_at: string | null;
  created_by_name: string | null;
}
interface Chart {
  visit_date: string | null;
  chief_complaint: string | null;
  diagnosis: string | null;
  treatment_record: string | null;
  clinical_progress: string | null;
  materials_used: string | null;
  treatment_result: string | null;
  created_by_name: string | null;
  created_at: string | null;
}
interface NextResv {
  reservation_date: string;
  reservation_time: string | null;
  registrar_name: string | null;
}
// 【6】 진료내역 — 방문(check_in) 단위 레코드
interface VisitRecord {
  id: string; // check_in_id (【7】 조인 키)
  checked_in_at: string | null;
  completed_at: string | null;
  visit_type: string | null;
  treatment_category: string | null;
  status: string | null;
}
// 【7】 동선 로그 — check_in_room_logs 한 줄
interface VisitRoomLog {
  check_in_id: string;
  assigned_room: string | null;
  room_type: string | null;
  logged_at: string | null;
}
// 【8】 활성 패키지 — 패키지 1건 (T-20260822-foot-PROGANALYSIS-EXTRACT-PKGRESV-SECTIONS)
interface ActivePackageRow {
  label: string; // 시술구분(비가열/가열/포돌로게/수액/체험권/Re:Born)
  total: number; // 발급 총회차
  used: number; // 소진 회차(package_sessions.status='used')
  remaining: number; // total − used
}
interface ActivePackage {
  package_name: string | null;
  package_type: string | null;
  rows: ActivePackageRow[];
  totalRemaining: number; // 전체잔여(Σ remaining)
}
// 【9】 예약내역 — reservations 한 건(최신순)
interface ReservationEntry {
  reservation_date: string;
  reservation_time: string | null;
  status: string | null;
  booking_memo: string | null; // 예약메모(canonical)
  memo: string | null; // 일반 메모
  brief_note: string | null; // 간략메모(초진 주증상)
  registrar_name: string | null;
}

/* ─── 섹션 fetch 진단 (T-20260822-foot-PROGANALYSIS-EXTRACT-FETCH-SILENT-SWALLOW-HARDEN) ───
 *   catch{} 무음삼킴 봉합: fetch 에러/clinic-mismatch 를 섹션별로 기록 → md 에서 '⚠ 조회 실패' 명시.
 *   ⚠ supabase-js 쿼리 에러는 throw 가 아니라 { data:null, error } 로 반환 → 기존 try/catch 미포착.
 *     ⇒ 각 쿼리에서 error 를 명시 검사(assertNoQueryError)해야 진짜 봉합. (RLS 거부·컬럼부재·권한 모두 이 경로)
 */
export type ProgressSectionKey =
  | 'milestones'
  | 'visitCount'
  | 'nextResv'
  | 'memos'
  | 'rx'
  | 'hq'
  | 'firstVisit'
  | 'consult'
  | 'chart'
  | 'boiler'
  | 'visits'
  | 'roomLogs'
  | 'activePkgs'
  | 'reservations';

export interface SectionFetchError {
  reason: string; // 원인 요약(사람이 읽는 짧은 문구)
  clinicMismatch?: boolean; // 세션 clinic 컨텍스트 불일치(0-row 의심) → 별도 문구
}

export interface ProgressAnalysisEnvelope {
  boilerSet: Set<string>;
  milestonesByCust: Map<string, Milestone[]>;
  visitCountByCust: Map<string, number>;
  nextResvByCust: Map<string, NextResv>;
  memosByCust: Map<string, Memo[]>;
  rxByCust: Map<string, Rx[]>;
  hqByCust: Map<string, Hq>;
  firstVisitByCust: Map<string, string>;
  consultByCust: Map<string, Consult[]>;
  chartByCust: Map<string, Chart[]>;
  // 【6】【7】 (T-20260822-foot-PROGANALYSIS-EXTRACT-VISIT-MOVEMENT-SECTIONS)
  // optional = fetch 는 항상 세팅하나, 기존 envelope 리터럴(PHASE1/BATCH 스펙 등) 하위호환 위해 옵셔널.
  visitsByCust?: Map<string, VisitRecord[]>; // 방문(check_in, 취소제외) — 방문일 오름차순
  roomLogsByCheckIn?: Map<string, VisitRoomLog[]>; // check_in_id → 동선 로그(logged_at 오름차순)
  // 【8】【9】 (T-20260822-foot-PROGANALYSIS-EXTRACT-PKGRESV-SECTIONS) — additive·read-only·옵셔널(하위호환).
  activePkgsByCust?: Map<string, ActivePackage[]>; // 활성 패키지(status='active') + 시술구분별 총/사용/잔여
  reservationsByCust?: Map<string, ReservationEntry[]>; // 예약 전건(최신순) + 예약메모
  // 섹션별 fetch 실패 진단(옵셔널·하위호환). 존재 = 해당 섹션 조회 실패 → md 에 '⚠ 조회 실패' 표기.
  fetchErrors?: Map<ProgressSectionKey, SectionFetchError>;
}

/* ────────────────────────── 데이터 fetch (browser supabase, read-only) ────────────────────────── */

type SB = SupabaseClient;

/* ─── fetch 진단 유틸 (FETCH-SILENT-SWALLOW-HARDEN) ─── */

// supabase PostgrestError / throw 객체 → 사람이 읽는 짧은 원인 요약(개행제거·길이제한).
function errText(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o['message'], o['code'], o['hint'], o['details']].filter(Boolean).map(String);
    if (parts.length) return parts.join(' · ').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  }
  const s = String(e ?? '').replace(/[\r\n]+/g, ' ').trim();
  return s ? s.slice(0, 200) : '알 수 없는 오류';
}

// supabase 쿼리 결과 { error } 를 명시 검사 → 에러면 throw(기존 try/catch 가 섹션 기록으로 전환).
//   ⚠ supabase-js 는 쿼리 실패 시 throw 하지 않고 error 를 반환 → 이 검사가 무음삼킴 봉합의 핵심.
function assertNoQueryError(res: { error?: unknown }): void {
  if (res && res.error) throw res.error;
}

/**
 * 선택된 고객들의 5섹션 인풋 데이터를 일괄 조회(read-only). RLS(admin/manager) 적용.
 * 각 섹션은 방어적 try/catch — 테이블/컬럼 부재·권한 시 해당 섹션만 빈값(md 는 "기록 없음" 정직 표기).
 * @param today seoulISODate(new Date()) — 다음 예약(오늘 이후 최이른) 기준일
 */
export async function fetchProgressAnalysisData(
  supabase: SB,
  clinicId: string,
  customerIds: string[],
  today: string,
  // T-20260822-foot-PROGANALYSIS-DUE-CYCLE-CONFIGURABLE: 도래 회차 간격(설정값). 미지정=6(base canon 하위호환).
  interval: number = DEFAULT_CHECKPOINT_INTERVAL,
): Promise<ProgressAnalysisEnvelope> {
  const env: ProgressAnalysisEnvelope = {
    boilerSet: new Set(),
    milestonesByCust: new Map(),
    visitCountByCust: new Map(),
    nextResvByCust: new Map(),
    memosByCust: new Map(),
    rxByCust: new Map(),
    hqByCust: new Map(),
    firstVisitByCust: new Map(),
    consultByCust: new Map(),
    chartByCust: new Map(),
    visitsByCust: new Map(),
    roomLogsByCheckIn: new Map(),
    activePkgsByCust: new Map(),
    reservationsByCust: new Map(),
    fetchErrors: new Map(),
  };
  const errs = env.fetchErrors!;
  const recordErr = (key: ProgressSectionKey, e: unknown, clinicMismatch = false): void => {
    // 이미 clinicMismatch 로 기록된 섹션은 후속 일반에러로 덮어쓰지 않음(더 구체적인 진단 보존).
    const prev = errs.get(key);
    if (prev?.clinicMismatch && !clinicMismatch) return;
    errs.set(key, { reason: errText(e), clinicMismatch });
  };
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return env;

  // clinic 컨텍스트 오설정 감지: clinicId 공란/누락 → clinic-scoped 쿼리(.eq('clinic_id',…))가
  //   silent 0-row 를 반환(에러 아님) → '데이터 없음(정상)' 으로 위장. 사전에 clinicMismatch 로 표기.
  const clinicMissing = !clinicId || !String(clinicId).trim();
  if (clinicMissing) {
    for (const k of ['milestones', 'nextResv', 'activePkgs', 'reservations'] as ProgressSectionKey[]) {
      errs.set(k, { reason: 'clinic 컨텍스트 미설정(clinic_id 공란)', clinicMismatch: true });
    }
  }

  // 1) 도래 회차 마일스톤(고객별) — 활성 패키지 + used 카운트 + (used+1)%interval==0. (스크립트 코호트 로직 그대로·interval 기본6)
  try {
    const pkgs: Array<{ id: string; customer_id: string; total_sessions: number | null }> = [];
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('packages')
        .select('id, customer_id, total_sessions')
        .eq('clinic_id', clinicId)
        .eq('status', 'active')
        .in('customer_id', slice);
      assertNoQueryError({ error });
      for (const p of arr<{ id: string; customer_id: string | null; total_sessions: number | null }>(data)) {
        if (p.id && p.customer_id && (p.total_sessions ?? 0) > 0) {
          pkgs.push({ id: p.id, customer_id: p.customer_id, total_sessions: p.total_sessions });
        }
      }
    }
    const usedMap = new Map<string, number>();
    const pkgIds = pkgs.map((p) => p.id);
    for (const slice of chunkIds(pkgIds, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('package_sessions')
        .select('package_id')
        .in('package_id', slice)
        .eq('status', 'used');
      assertNoQueryError({ error });
      for (const s of arr<{ package_id: string }>(data)) {
        usedMap.set(s.package_id, (usedMap.get(s.package_id) ?? 0) + 1);
      }
    }
    for (const p of pkgs) {
      const used = usedMap.get(p.id) ?? 0;
      if (!isSixMultipleTarget({ usedSessions: used, totalSessions: p.total_sessions }, interval)) continue;
      const list = env.milestonesByCust.get(p.customer_id) ?? [];
      list.push({ anticipated: anticipatedSession(used), used, total: p.total_sessions ?? 0 });
      env.milestonesByCust.set(p.customer_id, list);
    }
  } catch (e) {
    recordErr('milestones', e, clinicMissing); // 마일스톤 보강 실패 — 헤더 회차 라벨만 폴백
  }

  // 2) 내원 횟수(취소제외) — check_ins.
  try {
    const cnt = new Map<string, number>();
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('check_ins')
        .select('customer_id, status')
        .in('customer_id', slice);
      assertNoQueryError({ error });
      for (const c of arr<{ customer_id: string | null; status: string | null }>(data)) {
        if (!c.customer_id) continue;
        if (c.status === 'cancelled') continue; // IS DISTINCT FROM 'cancelled'
        cnt.set(c.customer_id, (cnt.get(c.customer_id) ?? 0) + 1);
      }
    }
    env.visitCountByCust = cnt;
  } catch (e) {
    recordErr('visitCount', e);
  }

  // 3) 다음 예약(오늘 이후 미취소 최이른) per customer.
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('reservations')
        .select('customer_id, reservation_date, reservation_time, registrar_name, status')
        .eq('clinic_id', clinicId)
        .in('customer_id', slice)
        .gte('reservation_date', today)
        .neq('status', 'cancelled')
        .order('reservation_date', { ascending: true })
        .order('reservation_time', { ascending: true });
      assertNoQueryError({ error });
      for (const rv of arr<Record<string, unknown>>(data)) {
        const cid = rv['customer_id'] ? String(rv['customer_id']) : '';
        if (!cid) continue;
        const d = String(rv['reservation_date'] ?? '');
        const t = rv['reservation_time'] ? String(rv['reservation_time']).slice(0, 5) : null;
        const prev = env.nextResvByCust.get(cid);
        if (prev) {
          const prevKey = `${prev.reservation_date} ${prev.reservation_time ?? ''}`;
          const curKey = `${d} ${t ?? ''}`;
          if (curKey >= prevKey) continue;
        }
        env.nextResvByCust.set(cid, {
          reservation_date: d,
          reservation_time: t,
          registrar_name: rv['registrar_name'] ? String(rv['registrar_name']) : null,
        });
      }
    }
  } catch (e) {
    recordErr('nextResv', e, clinicMissing); // 미예약 취급 → 조회 실패 표기
  }

  // 4) 치료메모(활성).
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('customer_treatment_memos')
        .select('customer_id, content, created_at, created_by, created_by_name')
        .in('customer_id', slice)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      assertNoQueryError({ error });
      for (const m of arr<Record<string, unknown>>(data)) {
        const cid = String(m['customer_id'] ?? '');
        if (!cid) continue;
        const list = env.memosByCust.get(cid) ?? [];
        list.push({
          content: (m['content'] as string) ?? null,
          created_at: (m['created_at'] as string) ?? null,
          created_by: (m['created_by'] as string) ?? null,
          created_by_name: (m['created_by_name'] as string) ?? null,
        });
        env.memosByCust.set(cid, list);
      }
    }
  } catch (e) {
    recordErr('memos', e);
  }

  // 5) 처방내역(prescriptions + items). 테이블 미사용 가능 → 방어.
  try {
    const allRx: Array<Rx & { customer_id: string }> = [];
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('prescriptions')
        .select('id, customer_id, prescribed_at, prescribed_by_name, diagnosis, memo, created_at')
        .in('customer_id', slice)
        .order('created_at', { ascending: true });
      assertNoQueryError({ error });
      for (const r of arr<Record<string, unknown>>(data)) {
        allRx.push({
          id: String(r['id'] ?? ''),
          customer_id: String(r['customer_id'] ?? ''),
          prescribed_at: (r['prescribed_at'] as string) ?? null,
          prescribed_by_name: (r['prescribed_by_name'] as string) ?? null,
          diagnosis: (r['diagnosis'] as string) ?? null,
          memo: (r['memo'] as string) ?? null,
          created_at: (r['created_at'] as string) ?? null,
          items: [],
        });
      }
    }
    const rxIds = allRx.map((r) => r.id).filter(Boolean);
    const itemsByRx = new Map<string, RxItem[]>();
    for (const slice of chunkIds(rxIds, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('prescription_items')
        .select('prescription_id, medication_name, dosage, duration_days, quantity, memo, sort_order')
        .in('prescription_id', slice)
        .order('sort_order', { ascending: true });
      assertNoQueryError({ error });
      for (const it of arr<Record<string, unknown>>(data)) {
        const rid = String(it['prescription_id'] ?? '');
        if (!rid) continue;
        const list = itemsByRx.get(rid) ?? [];
        list.push({
          medication_name: (it['medication_name'] as string) ?? null,
          dosage: (it['dosage'] as string) ?? null,
          duration_days: (it['duration_days'] as number) ?? null,
          quantity: (it['quantity'] as number) ?? null,
          memo: (it['memo'] as string) ?? null,
        });
        itemsByRx.set(rid, list);
      }
    }
    for (const r of allRx) {
      r.items = itemsByRx.get(r.id) ?? [];
      const list = env.rxByCust.get(r.customer_id) ?? [];
      list.push(r);
      env.rxByCust.set(r.customer_id, list);
    }
  } catch (e) {
    recordErr('rx', e);
  }

  // 6) 과거력(health_q_results, 고객당 최초 제출).
  try {
    const seen = new Set<string>();
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('health_q_results')
        .select('customer_id, form_data, submitted_at, created_at')
        .in('customer_id', slice)
        .order('created_at', { ascending: true });
      assertNoQueryError({ error });
      for (const h of arr<Record<string, unknown>>(data)) {
        const cid = String(h['customer_id'] ?? '');
        if (!cid || seen.has(cid)) continue; // DISTINCT ON (customer_id) ORDER BY created_at ASC → 최초 1건
        seen.add(cid);
        env.hqByCust.set(cid, {
          form_data: (h['form_data'] as Record<string, unknown>) ?? null,
          submitted_at: (h['submitted_at'] as string) ?? null,
          created_at: (h['created_at'] as string) ?? null,
        });
      }
    }
  } catch (e) {
    recordErr('hq', e);
  }

  // 7) 첫 방문일(check_ins min date, 취소제외).
  try {
    const minBy = new Map<string, string>();
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('check_ins')
        .select('customer_id, checked_in_at, status')
        .in('customer_id', slice);
      assertNoQueryError({ error });
      for (const c of arr<Record<string, unknown>>(data)) {
        const cid = String(c['customer_id'] ?? '');
        if (!cid || c['status'] === 'cancelled') continue;
        const d = c['checked_in_at'] ? String(c['checked_in_at']).slice(0, 10) : '';
        if (!d) continue;
        const prev = minBy.get(cid);
        if (!prev || d < prev) minBy.set(cid, d);
      }
    }
    env.firstVisitByCust = minBy;
  } catch (e) {
    recordErr('firstVisit', e);
  }

  // 8) 상담메모(활성 전량).
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('customer_consult_memos')
        .select('customer_id, content, created_at, created_by_name')
        .in('customer_id', slice)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      assertNoQueryError({ error });
      for (const c of arr<Record<string, unknown>>(data)) {
        const cid = String(c['customer_id'] ?? '');
        if (!cid) continue;
        const list = env.consultByCust.get(cid) ?? [];
        list.push({
          content: (c['content'] as string) ?? null,
          created_at: (c['created_at'] as string) ?? null,
          created_by_name: (c['created_by_name'] as string) ?? null,
        });
        env.consultByCust.set(cid, list);
      }
    }
  } catch (e) {
    recordErr('consult', e);
  }

  // 9) 진료차트(medical_charts, is_deleted 제외 = IS NOT TRUE).
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('medical_charts')
        .select(
          'customer_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, materials_used, treatment_result, created_by_name, created_at, is_deleted',
        )
        .in('customer_id', slice)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('visit_date', { ascending: true })
        .order('created_at', { ascending: true });
      assertNoQueryError({ error });
      for (const c of arr<Record<string, unknown>>(data)) {
        const cid = String(c['customer_id'] ?? '');
        if (!cid) continue;
        const list = env.chartByCust.get(cid) ?? [];
        list.push({
          visit_date: (c['visit_date'] as string) ?? null,
          chief_complaint: (c['chief_complaint'] as string) ?? null,
          diagnosis: (c['diagnosis'] as string) ?? null,
          treatment_record: (c['treatment_record'] as string) ?? null,
          clinical_progress: (c['clinical_progress'] as string) ?? null,
          materials_used: (c['materials_used'] as string) ?? null,
          treatment_result: (c['treatment_result'] as string) ?? null,
          created_by_name: (c['created_by_name'] as string) ?? null,
          created_at: (c['created_at'] as string) ?? null,
        });
        env.chartByCust.set(cid, list);
      }
    }
  } catch (e) {
    recordErr('chart', e);
  }

  // 10) 루틴상용구 사전(섹션5 R1) = phrase_templates + super_phrases (clinic-global, 1회).
  try {
    const { data: pt, error } = await supabase
      .from('phrase_templates')
      .select('content, phrase_type')
      .in('phrase_type', ['customer_chart', 'medical_chart', 'pen_chart']);
    assertNoQueryError({ error });
    for (const r of arr<{ content: string | null }>(pt)) {
      const n = norm(r.content);
      if (n) env.boilerSet.add(n);
    }
  } catch (e) {
    recordErr('boiler', e); // 상용구 사전 로드 실패 — 섹션5 발췌는 R1 미적용으로 진행(무해)
  }
  try {
    const { data: sp, error } = await supabase.from('super_phrases').select('diagnosis, clinical_progress');
    assertNoQueryError({ error });
    for (const r of arr<{ diagnosis: string | null; clinical_progress: string | null }>(sp)) {
      for (const v of [r.diagnosis, r.clinical_progress]) {
        const n = norm(v);
        if (n) env.boilerSet.add(n);
      }
    }
  } catch (e) {
    recordErr('boiler', e);
  }

  // 11) 【6】 진료내역 — check_ins 방문 전건(취소 제외), 방문일 오름차순. (id 는 【7】 동선 조인 키)
  try {
    const byCust = new Map<string, VisitRecord[]>();
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_id, checked_in_at, completed_at, visit_type, treatment_category, status')
        .in('customer_id', slice)
        .order('checked_in_at', { ascending: true });
      assertNoQueryError({ error });
      for (const c of arr<Record<string, unknown>>(data)) {
        const cid = String(c['customer_id'] ?? '');
        if (!cid) continue;
        if (c['status'] === 'cancelled') continue; // 취소 제외 (스크립트 내원카운트 규칙과 동일)
        const list = byCust.get(cid) ?? [];
        list.push({
          id: String(c['id'] ?? ''),
          checked_in_at: (c['checked_in_at'] as string) ?? null,
          completed_at: (c['completed_at'] as string) ?? null,
          visit_type: (c['visit_type'] as string) ?? null,
          treatment_category: (c['treatment_category'] as string) ?? null,
          status: (c['status'] as string) ?? null,
        });
        byCust.set(cid, list);
      }
    }
    env.visitsByCust = byCust;
  } catch (e) {
    recordErr('visits', e);
  }

  // 12) 【7】 동선 로그 — check_in_room_logs (방문별 슬롯 체류). check_in_id 기준, logged_at 오름차순.
  try {
    const visitsMap = env.visitsByCust ?? new Map<string, VisitRecord[]>();
    const roomLogMap = env.roomLogsByCheckIn ?? new Map<string, VisitRoomLog[]>(); // init 에서 세팅됨(동일 참조)
    const checkInIds: string[] = [];
    for (const list of visitsMap.values()) for (const v of list) if (v.id) checkInIds.push(v.id);
    const uniqCheckInIds = [...new Set(checkInIds)];
    for (const slice of chunkIds(uniqCheckInIds, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('check_in_room_logs')
        .select('check_in_id, assigned_room, room_type, logged_at')
        .in('check_in_id', slice)
        .order('logged_at', { ascending: true });
      assertNoQueryError({ error });
      for (const r of arr<Record<string, unknown>>(data)) {
        const kid = String(r['check_in_id'] ?? '');
        if (!kid) continue;
        const list = roomLogMap.get(kid) ?? [];
        list.push({
          check_in_id: kid,
          assigned_room: (r['assigned_room'] as string) ?? null,
          room_type: (r['room_type'] as string) ?? null,
          logged_at: (r['logged_at'] as string) ?? null,
        });
        roomLogMap.set(kid, list);
      }
    }
    env.roomLogsByCheckIn = roomLogMap;
  } catch (e) {
    recordErr('roomLogs', e); // 동선 로그 테이블 미존재/권한 → '조회 실패' 표기
  }

  // 13) 【8】 활성 패키지 — packages(status='active') 시술구분별 발급 총회차 + package_sessions 소진(used) 카운트.
  //   표시로직 = PackageTicketReadonlyList.tsx 그대로(재가공 금지). 스텝1(마일스톤)과 별개 조회(무접촉).
  try {
    interface PkgRaw {
      id: string;
      customer_id: string;
      package_name: string | null;
      package_type: string | null;
      unheated_sessions: number | null;
      heated_sessions: number | null;
      podologe_sessions: number | null;
      iv_sessions: number | null;
      trial_sessions: number | null;
      reborn_sessions: number | null;
    }
    const pkgs: PkgRaw[] = [];
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('packages')
        .select(
          'id, customer_id, package_name, package_type, unheated_sessions, heated_sessions, podologe_sessions, iv_sessions, trial_sessions, reborn_sessions',
        )
        .eq('clinic_id', clinicId)
        .eq('status', 'active')
        .in('customer_id', slice)
        .order('created_at', { ascending: true });
      assertNoQueryError({ error });
      for (const p of arr<Record<string, unknown>>(data)) {
        const cid = String(p['customer_id'] ?? '');
        const pid = String(p['id'] ?? '');
        if (!cid || !pid) continue;
        pkgs.push({
          id: pid,
          customer_id: cid,
          package_name: (p['package_name'] as string) ?? null,
          package_type: (p['package_type'] as string) ?? null,
          unheated_sessions: (p['unheated_sessions'] as number) ?? 0,
          heated_sessions: (p['heated_sessions'] as number) ?? 0,
          podologe_sessions: (p['podologe_sessions'] as number) ?? 0,
          iv_sessions: (p['iv_sessions'] as number) ?? 0,
          trial_sessions: (p['trial_sessions'] as number) ?? 0,
          reborn_sessions: (p['reborn_sessions'] as number) ?? 0,
        });
      }
    }
    // 소진(used) 카운트: package_id × session_type. (PackageTicketReadonlyList usedByType 규칙 동일)
    const usedByPkgType = new Map<string, Record<string, number>>();
    const pkgIds = pkgs.map((p) => p.id);
    for (const slice of chunkIds(pkgIds, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('package_sessions')
        .select('package_id, session_type')
        .in('package_id', slice)
        .eq('status', 'used');
      assertNoQueryError({ error });
      for (const s of arr<{ package_id: string; session_type: string | null }>(data)) {
        const pid = String(s.package_id ?? '');
        if (!pid) continue;
        const st = String(s.session_type ?? '');
        const rec = usedByPkgType.get(pid) ?? {};
        rec[st] = (rec[st] ?? 0) + 1;
        usedByPkgType.set(pid, rec);
      }
    }
    for (const p of pkgs) {
      const usedRec = usedByPkgType.get(p.id) ?? {};
      const rows: ActivePackageRow[] = [];
      for (const def of PKG_SESSION_TYPES) {
        const total = (p[def.qtyKey as keyof PkgRaw] as number) ?? 0;
        const used = usedRec[def.sessionType] ?? 0;
        if (total <= 0 && used <= 0) continue; // 발급·소진 모두 0인 구분은 표기 생략
        rows.push({ label: def.label, total, used, remaining: total - used });
      }
      const totalRemaining = rows.reduce((acc, r) => acc + r.remaining, 0);
      const list = env.activePkgsByCust!.get(p.customer_id) ?? [];
      list.push({
        package_name: p.package_name,
        package_type: p.package_type,
        rows,
        totalRemaining,
      });
      env.activePkgsByCust!.set(p.customer_id, list);
    }
  } catch (e) {
    recordErr('activePkgs', e, clinicMissing); // 활성 패키지 조회 실패/권한/clinic-mismatch
  }

  // 14) 【9】 예약내역 — reservations 전건(취소 포함), 최신순. 예약메모(booking_memo canonical)+memo+brief_note.
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('reservations')
        .select(
          'customer_id, reservation_date, reservation_time, status, booking_memo, memo, brief_note, registrar_name',
        )
        .eq('clinic_id', clinicId)
        .in('customer_id', slice)
        .order('reservation_date', { ascending: false })
        .order('reservation_time', { ascending: false });
      assertNoQueryError({ error });
      for (const rv of arr<Record<string, unknown>>(data)) {
        const cid = String(rv['customer_id'] ?? '');
        if (!cid) continue;
        const list = env.reservationsByCust!.get(cid) ?? [];
        list.push({
          reservation_date: String(rv['reservation_date'] ?? ''),
          reservation_time: rv['reservation_time'] ? String(rv['reservation_time']).slice(0, 5) : null,
          status: (rv['status'] as string) ?? null,
          booking_memo: (rv['booking_memo'] as string) ?? null,
          memo: (rv['memo'] as string) ?? null,
          brief_note: (rv['brief_note'] as string) ?? null,
          registrar_name: (rv['registrar_name'] as string) ?? null,
        });
        env.reservationsByCust!.set(cid, list);
      }
    }
  } catch (e) {
    recordErr('reservations', e, clinicMissing); // 예약내역 조회 실패/권한/clinic-mismatch
  }

  return env;
}

/* ────────────────────────── md 조립 (스크립트 L.push 시퀀스 그대로) ────────────────────────── */

/**
 * 한 환자의 경과분석 인풋 .md 문자열 생성(스크립트 출력과 동일 구조).
 */
export function buildProgressAnalysisMd(
  p: ProgressAnalysisPatient,
  env: ProgressAnalysisEnvelope,
  // T-20260822-foot-PROGANALYSIS-DUE-CYCLE-CONFIGURABLE: 도래 회차 간격(설정값). 기본6 시 헤더 문구 byte-identical.
  interval: number = DEFAULT_CHECKPOINT_INTERVAL,
): string {
  const fvd = env.firstVisitByCust.get(p.id) ?? null;
  const memoList = env.memosByCust.get(p.id) ?? [];
  const rxList = env.rxByCust.get(p.id) ?? [];
  const hq = env.hqByCust.get(p.id) ?? null;
  const consultList = env.consultByCust.get(p.id) ?? [];
  const chartList = env.chartByCust.get(p.id) ?? [];
  const visitCount = env.visitCountByCust.get(p.id) ?? 0;
  const milestones = env.milestonesByCust.get(p.id) ?? [];
  const boilerSet = env.boilerSet;
  const visitList = env.visitsByCust?.get(p.id) ?? [];
  const activePkgs = env.activePkgsByCust?.get(p.id) ?? [];
  const reservationList = env.reservationsByCust?.get(p.id) ?? [];

  // ─── fetch 실패 진단(FETCH-SILENT-SWALLOW-HARDEN) ───
  //   빈 섹션이 (a)데이터없음(정상) 인지 (b)조회실패 인지 구분. 아래 문구는 '데이터 없음' 브랜치에서만
  //   덮어쓴다(list 비어있을 때 한정) → 데이터가 있는 정상 경로 출력은 절대 불변(회귀0).
  const fetchErrors = env.fetchErrors;
  const sectionError = (...keys: ProgressSectionKey[]): SectionFetchError | null => {
    if (!fetchErrors) return null;
    for (const k of keys) {
      const e = fetchErrors.get(k);
      if (e) return e;
    }
    return null;
  };
  const errLine = (e: SectionFetchError): string =>
    e.clinicMismatch ? '⚠ 조회 실패(clinic 컨텍스트 확인 필요)' : `⚠ 조회 실패: ${e.reason}`;
  // 빈 섹션 문구 산출: 조회실패면 '⚠ 조회 실패…', 아니면 기존 '없음' 문구 그대로.
  const emptyOrError = (fallback: string, ...keys: ProgressSectionKey[]): string => {
    const e = sectionError(...keys);
    return e ? errLine(e) : fallback;
  };

  const L: string[] = [];
  L.push(`# 경과분석 자료 — ${pad(p.name ?? '(이름없음)')}`);
  L.push('');
  L.push('## 【행정】 환자 식별 정보');
  L.push('');
  L.push(`- 성함: ${pad(p.name ?? '(이름없음)')}`);
  L.push(`- 차트번호: ${p.chart_number ?? '(없음)'}`);
  L.push('');
  // 6배수 예정 회차·예약일 (★티켓 요구 헤더)
  const nr = env.nextResvByCust.get(p.id) ?? null;
  const msLabels = [...milestones]
    .sort((a, b) => a.anticipated - b.anticipated)
    .map((m) => `${m.anticipated}회 경과분석 (현재 ${m.used}/${m.total}회 진행 → 다음 내방 ${m.anticipated}회차)`);
  const resvLabel = nr
    ? `${nr.reservation_date}${nr.reservation_time ? ' ' + String(nr.reservation_time).slice(0, 5) : ''}${
        nr.registrar_name ? ' · 담당 ' + pad(nr.registrar_name) : ''
      }`
    : '(다음 예약 없음)';
  L.push(`### ${interval}배수 예정 회차 · 예약일`);
  L.push('');
  L.push(`- 도래 회차(예정): ${msLabels.length ? msLabels.join(' / ') : '(회차 정보 없음)'}`);
  L.push(`- 다음 예약일: ${resvLabel}`);
  L.push('');
  L.push('### 내원 요약');
  L.push('');
  L.push(`- 고객 ID: ${p.id}`);
  L.push(`- 첫 방문일: ${fvd ?? '(없음)'}`);
  L.push(`- 내원 횟수(check_in, 취소제외): ${visitCount}`);
  L.push(
    `- 치료메모 ${memoList.length}건 / 처방 ${rxList.length}건 / 과거력질문지 ${hq ? '있음' : '없음'} / 첫날상담 ${
      consultList.length ? '있음' : '없음'
    }`,
  );
  L.push('');

  // ===== 섹션 1: 치료메모 =====
  L.push('---');
  L.push('');
  L.push('# 【1】 치료메모');
  L.push('');
  if (memoList.length === 0) {
    L.push(`_${emptyOrError('기록 없음', 'memos')}_`);
    L.push('');
  } else {
    memoList.forEach((m, i) => {
      L.push(`## ${i + 1}번째 치료메모`);
      L.push('');
      L.push(`- 방문 날짜: ${dOnly(m.created_at)}`);
      L.push(`- 작성일시: ${m.created_at ?? '(없음)'}`);
      L.push(`- 작성자: ${m.created_by_name ?? m.created_by ?? '(미상)'}`);
      L.push('');
      L.push(String(m.content ?? '').replace(/\r\n/g, '\n'));
      L.push('');
    });
  }

  // ===== 섹션 2: 처방내역 =====
  L.push('---');
  L.push('');
  L.push('# 【2】 처방내역');
  L.push('');
  if (rxList.length === 0) {
    const rxErr = sectionError('rx');
    L.push(rxErr ? `_${errLine(rxErr)}_` : '_기록 없음_  (처방 테이블·차트/접수 처방필드 전부 미기재)');
    L.push('');
  } else {
    rxList.forEach((r, i) => {
      L.push(`## 처방 ${i + 1}`);
      L.push('');
      L.push(`- 처방일: ${dOnly(r.prescribed_at ?? r.created_at)}`);
      L.push(`- 처방자: ${r.prescribed_by_name ?? '(미상)'}`);
      if (r.diagnosis) L.push(`- 진단: ${pad(r.diagnosis)}`);
      if (r.memo) L.push(`- 메모: ${pad(r.memo)}`);
      const its = r.items ?? [];
      L.push('');
      if (its.length) {
        L.push('| 약품 | 용법 | 일수 | 수량 | 비고 |');
        L.push('|---|---|---|---|---|');
        for (const it of its)
          L.push(
            `| ${pad(it.medication_name)} | ${pad(it.dosage)} | ${it.duration_days ?? ''} | ${
              it.quantity ?? ''
            } | ${pad(it.memo)} |`,
          );
      } else {
        L.push('_처방 약품 항목 없음_');
      }
      L.push('');
    });
  }

  // ===== 섹션 3: 과거력 =====
  L.push('---');
  L.push('');
  L.push('# 【3】 과거력 (QR 셀프접수 입력)');
  L.push('');
  if (!hq || !hq.form_data) {
    L.push(`_${emptyOrError('기록 없음', 'hq')}_`);
    L.push('');
  } else {
    const fd = hq.form_data;
    L.push(`- 질문지 작성일: ${dOnly(hq.submitted_at ?? hq.created_at)}`);
    L.push('');
    L.push('### 의료 과거력');
    L.push('');
    for (const [k, label, kind] of HQ_MED_FIELDS) L.push(`- ${label}: ${renderHqValue(kind, fd[k])}`);
    L.push('');
    L.push('### 발/증상·기타 문진');
    L.push('');
    for (const [k, label, kind] of HQ_FOOT_FIELDS) L.push(`- ${label}: ${renderHqValue(kind, fd[k])}`);
    const known = new Set([...HQ_MED_FIELDS, ...HQ_FOOT_FIELDS].map((x) => x[0]).concat(['_lang']));
    const extra = Object.keys(fd).filter((k) => !known.has(k));
    if (extra.length) {
      L.push('');
      L.push('### 기타 질문지 항목');
      L.push('');
      for (const k of extra)
        L.push(`- ${k}: ${renderHqValue('raw', typeof fd[k] === 'object' ? JSON.stringify(fd[k]) : fd[k])}`);
    }
    L.push('');
  }

  // ===== 섹션 4: 첫날 상담차트 =====
  L.push('---');
  L.push('');
  L.push('# 【4】 첫날 상담차트 (첫 방문일 초진 기록)');
  L.push('');
  L.push(`- 첫 방문일: ${fvd ?? '(없음)'}`);
  L.push('');
  const consultFirstDay = fvd ? consultList.filter((c) => dOnly(c.created_at) === String(fvd)) : [];
  const chartFirstDay = fvd ? chartList.filter((c) => String(c.visit_date) === String(fvd)) : [];

  L.push('### 초진 상담 기록');
  L.push('');
  if (consultFirstDay.length) {
    consultFirstDay.forEach((c, i) => {
      if (consultFirstDay.length > 1) L.push(`#### 상담 ${i + 1}`);
      L.push(`- 작성일시: ${c.created_at ?? '(없음)'}`);
      L.push(`- 작성자: ${c.created_by_name ?? '(미상)'}`);
      L.push('');
      L.push(String(c.content ?? '').replace(/\r\n/g, '\n'));
      L.push('');
    });
  } else if (consultList.length) {
    const c = consultList[0];
    L.push(`_첫 방문일(${fvd}) 상담기록 없음 — 최초 상담메모(${dOnly(c.created_at)}) 대체표기_`);
    L.push('');
    L.push(`- 작성일시: ${c.created_at ?? '(없음)'}`);
    L.push(`- 작성자: ${c.created_by_name ?? '(미상)'}`);
    L.push('');
    L.push(String(c.content ?? '').replace(/\r\n/g, '\n'));
    L.push('');
  } else {
    L.push(`_${emptyOrError('기록 없음', 'consult')}_`);
    L.push('');
  }

  const chartsToShow = chartFirstDay.length ? chartFirstDay : [];
  if (chartsToShow.length) {
    L.push('### 초진 진료차트(의사)');
    L.push('');
    chartsToShow.forEach((c, i) => {
      if (chartsToShow.length > 1) L.push(`#### 차트 ${i + 1}`);
      L.push(`- 방문일: ${c.visit_date ?? '(없음)'}`);
      L.push(`- 작성자: ${c.created_by_name ?? '(미상)'}`);
      const fields: Array<[string, unknown]> = [
        ['주호소(C.C)', c.chief_complaint],
        ['진단', c.diagnosis],
        ['치료기록', c.treatment_record],
        ['임상경과', c.clinical_progress],
        ['사용재료', c.materials_used],
        ['치료결과', c.treatment_result],
      ];
      const shown = fields.filter(([, v]) => v != null && String(v).trim() !== '');
      L.push('');
      if (shown.length) {
        for (const [lab, v] of shown) {
          L.push(`**${lab}**: ${String(v).replace(/\r\n/g, '\n')}`);
          L.push('');
        }
      } else {
        L.push('_차트 본문 항목 없음(빈 차트)_');
        L.push('');
      }
    });
  }

  // ===== 섹션 5: 임상 유의미 텍스트 =====
  L.push('---');
  L.push('');
  L.push('# 【5】 임상 유의미 텍스트 (전체 경과 · 루틴상용구 제외)');
  L.push('');
  L.push(
    '_루틴상용구(정형 서식·빈 스켈레톤·의사서명)를 결정론적 규칙으로 제외하고, 환자 개별 특이정보만 발췌. 외부 AI 미경유._',
  );
  L.push('');

  // 5-A. 상담메모(전량) 유의미 발췌
  L.push('### 상담메모 발췌 (전 방문)');
  L.push('');
  if (consultList.length === 0) {
    L.push(`_${emptyOrError('상담메모 없음', 'consult')}_`);
    L.push('');
  } else {
    consultList.forEach((c) => {
      const { kept, dropped, wholeBoiler } = extractMeaningful(c.content, boilerSet);
      L.push(`**[${dOnly(c.created_at)} · ${c.created_by_name ?? '미상'}]**`);
      if (wholeBoiler) {
        L.push('- _(루틴상용구 원문 그대로 — 유의미 텍스트 없음)_');
      } else if (kept.length === 0) {
        L.push('- _(정형서식/미기재 — 유의미 텍스트 없음)_');
      } else {
        for (const k of kept) L.push(`- ${k}`);
      }
      if (dropped > 0) L.push(`  <sub>_(정형·미기재 ${dropped}줄 제외)_</sub>`);
      L.push('');
    });
  }

  // 5-B. 진료차트(전 임상필드) 유의미 발췌
  L.push('### 진료차트 발췌 (전 방문, 의사 임상필드)');
  L.push('');
  if (chartList.length === 0) {
    L.push(`_${emptyOrError('진료차트(디지털) 기록 없음', 'chart')}_`);
    L.push('');
  } else {
    let chartAny = false;
    chartList.forEach((c) => {
      const fieldMap: Array<[string, unknown]> = [
        ['주호소', c.chief_complaint],
        ['진단', c.diagnosis],
        ['치료기록', c.treatment_record],
        ['임상경과', c.clinical_progress],
        ['사용재료', c.materials_used],
        ['치료결과', c.treatment_result],
      ];
      const blockLines: string[] = [];
      for (const [lab, v] of fieldMap) {
        const { kept } = extractMeaningful(v, boilerSet);
        if (kept.length) {
          chartAny = true;
          blockLines.push(`- **${lab}**: ${kept.join(' / ')}`);
        }
      }
      if (blockLines.length) {
        L.push(`**[${c.visit_date ?? dOnly(c.created_at)} · ${c.created_by_name ?? '미상'}]**`);
        for (const b of blockLines) L.push(b);
        L.push('');
      }
    });
    if (!chartAny) {
      L.push('_진료차트 임상필드 전부 미기재(빈 차트)_');
      L.push('');
    }
  }

  // ===== 섹션 6: 진료내역 (T-20260822-foot-PROGANALYSIS-EXTRACT-VISIT-MOVEMENT-SECTIONS) =====
  // 방문(check_in, 취소제외) 전건을 방문별 한 줄. 방문일 / 접수시각 / 귀가시각 / 사유. 방문일 오름차순.
  L.push('---');
  L.push('');
  L.push('# 【6】 진료내역 (방문별 · check_in 기준 전건, 취소 제외)');
  L.push('');
  if (visitList.length === 0) {
    L.push(`_${emptyOrError('진료내역 없음', 'visits')}_`);
    L.push('');
  } else {
    L.push('| 방문일 | 접수시각 | 귀가시각 | 사유 |');
    L.push('|---|---|---|---|');
    for (const v of visitList) {
      const inn = seoulDateTime(v.checked_in_at);
      const out = seoulDateTime(v.completed_at);
      const reason = visitReasonLabel(v.visit_type, v.treatment_category);
      L.push(`| ${inn.date} | ${inn.time} | ${v.completed_at ? out.time : '(미기록)'} | ${reason} |`);
    }
    L.push('');
  }

  // ===== 섹션 7: 동선 로그 (방문별 슬롯 체류) =====
  // 방문별 슬롯명/체류시간. 레이저 슬롯 유무 → 치료 시행 판정. 이상치(수백h)는 원값 유지 + 표기 병행.
  L.push('---');
  L.push('');
  L.push('# 【7】 동선 로그 (방문별 슬롯 체류 · 레이저 슬롯 유무 = 치료 시행 판정)');
  L.push('');
  if (visitList.length === 0) {
    L.push(`_${emptyOrError('진료내역 없음 — 동선 로그 대조 대상 없음', 'visits')}_`);
    L.push('');
  } else {
    const roomLogErr = sectionError('roomLogs');
    for (const v of visitList) {
      const inn = seoulDateTime(v.checked_in_at);
      const logs = (env.roomLogsByCheckIn?.get(v.id) ?? []).filter((l) => l.logged_at);
      const laserDone = logs.some((l) => isLaserRoom(l.room_type, l.assigned_room));
      L.push(`## 방문일 ${inn.date} (접수 ${inn.time})`);
      L.push('');
      const laserVerdict = laserDone
        ? '**치료 시행(레이저 슬롯 있음)**'
        : roomLogErr
          ? `**판정 불가(${errLine(roomLogErr)})**`
          : '치료 시행 근거 없음(레이저 슬롯 없음)';
      L.push(`- 치료 시행 판정: ${laserVerdict}`);
      L.push('');
      if (logs.length === 0) {
        L.push(`_${roomLogErr ? errLine(roomLogErr) : '동선 로그 없음'}_`);
        L.push('');
        continue;
      }
      L.push('| 슬롯명 | 진입시각 | 체류시간 |');
      L.push('|---|---|---|');
      logs.forEach((l, i) => {
        const enter = seoulDateTime(l.logged_at);
        // 체류 종료: 다음 로그 진입시각, 마지막 로그는 귀가시각(completed_at)
        const nextTs = i + 1 < logs.length ? logs[i + 1].logged_at : v.completed_at;
        let dwellMs: number | null = null;
        if (l.logged_at && nextTs) {
          const start = new Date(String(l.logged_at)).getTime();
          const end = new Date(String(nextTs)).getTime();
          if (Number.isFinite(start) && Number.isFinite(end)) dwellMs = end - start;
        }
        L.push(`| ${roomSlotLabel(l.room_type, l.assigned_room)} | ${enter.time} | ${formatDwell(dwellMs)} |`);
      });
      L.push('');
    }
  }

  // ===== 섹션 8: 활성 패키지 (T-20260822-foot-PROGANALYSIS-EXTRACT-PKGRESV-SECTIONS) =====
  // 패키지명 + 시술구분(비가열/가열/…)×(총/사용/잔여) 행 + 전체잔여. 없으면 "활성 패키지 없음"(빈 섹션 금지).
  L.push('---');
  L.push('');
  L.push('# 【8】 활성 패키지 (status=active · 시술구분별 총/사용/잔여)');
  L.push('');
  if (activePkgs.length === 0) {
    L.push(`_${emptyOrError('활성 패키지 없음', 'activePkgs')}_`);
    L.push('');
  } else {
    activePkgs.forEach((pkg, i) => {
      const nameLabel = pad(pkg.package_name ?? '(패키지명 없음)');
      const typeTag = pkg.package_type ? ` (${pad(pkg.package_type)})` : '';
      L.push(`## 패키지 ${i + 1}: ${nameLabel}${typeTag}`);
      L.push('');
      if (pkg.rows.length === 0) {
        L.push('_시술구분 회차 없음_');
        L.push('');
      } else {
        L.push('| 시술구분 | 총 | 사용 | 잔여 |');
        L.push('|---|---|---|---|');
        for (const r of pkg.rows) {
          L.push(`| ${r.label} | ${r.total}회 | ${r.used}회 | ${r.remaining}회 |`);
        }
        L.push(`| **전체잔여** |  |  | **${pkg.totalRemaining}회** |`);
        L.push('');
      }
    });
  }

  // ===== 섹션 9: 예약내역 (전건 최신순 · 예약메모) =====
  // 예약일시 + 예약메모(booking_memo canonical). 취소예약은 (취소) 명시 표기(현장친화·이력 온전). 없으면 "예약내역 없음".
  L.push('---');
  L.push('');
  L.push('# 【9】 예약내역 (전건 · 최신순 · 예약메모)');
  L.push('');
  if (reservationList.length === 0) {
    L.push(`_${emptyOrError('예약내역 없음', 'reservations')}_`);
    L.push('');
  } else {
    for (const rv of reservationList) {
      const when = `${rv.reservation_date || '(일자미상)'}${rv.reservation_time ? ' ' + rv.reservation_time : ''}`;
      const st = resvStatusLabel(rv.status);
      const reg = rv.registrar_name ? ` · 등록 ${pad(rv.registrar_name)}` : '';
      L.push(`## ${when} [${st}]${reg}`);
      const memoParts: string[] = [];
      if (norm(rv.booking_memo)) memoParts.push(`- 예약메모: ${pad(rv.booking_memo)}`);
      if (norm(rv.brief_note)) memoParts.push(`- 간략메모(주증상): ${pad(rv.brief_note)}`);
      if (norm(rv.memo)) memoParts.push(`- 메모: ${pad(rv.memo)}`);
      if (memoParts.length === 0) {
        L.push('- _예약메모 없음_');
      } else {
        for (const line of memoParts) L.push(line);
      }
      L.push('');
    }
  }

  // ===== 참고: 6회차 가열(힐러)/비가열 판정 표기 (별도 필드 아님 — 섹션 내 참고표기) =====
  // 판정 우선순위: 1순위 예약메모(가열/힐러↔비가열) > 2순위 예약메모 단서 없고 활성패키지 가열잔여>0 이면 일반규칙.
  //   예약 우선(가열은 뒤로 밀릴 수 있음). 최신 미취소 예약메모부터 단서 스캔.
  {
    const activeResv = reservationList.filter((rv) => rv.status !== 'cancelled');
    let memoSignal: 'heated' | 'unheated' | null = null;
    let memoSignalWhen = '';
    for (const rv of activeResv) {
      const sig =
        detectHeatingSignal(rv.booking_memo) ??
        detectHeatingSignal(rv.brief_note) ??
        detectHeatingSignal(rv.memo);
      if (sig) {
        memoSignal = sig;
        memoSignalWhen = `${rv.reservation_date}${rv.reservation_time ? ' ' + rv.reservation_time : ''}`;
        break;
      }
    }
    const heatedRemaining = activePkgs.reduce(
      (acc, pkg) => acc + pkg.rows.filter((r) => r.label === '가열').reduce((a, r) => a + r.remaining, 0),
      0,
    );
    L.push('---');
    L.push('');
    L.push('### 참고: 6회차 가열(힐러)/비가열 판정');
    L.push('');
    if (memoSignal) {
      const label = memoSignal === 'heated' ? '가열(힐러)' : '비가열';
      L.push(`- **판정(1순위·예약메모): ${label}** — 예약메모 단서(${memoSignalWhen}) 기준.`);
    } else if (heatedRemaining > 0) {
      L.push(
        `- **판정(2순위·활성패키지): 가열 가능** — 예약메모 단서 없음 + 활성패키지 가열잔여 ${heatedRemaining}회. 일반규칙(12회 내 가열 1회면 6회차 가열) 적용 대상.`,
      );
      L.push('  <sub>_예약 우선 원칙상 실제 가열은 뒤 회차로 밀릴 수 있음 — 확정 아님, 참고._</sub>');
    } else {
      L.push('- **판정: 비가열(추정)** — 예약메모 단서 없음 + 활성패키지 가열잔여 없음.');
    }
    L.push('');
  }

  return L.join('\n');
}

/** 파일명(확장자 제외) = {차트번호|id-xxxx}_{이름} (스크립트 규칙 그대로). */
export function progressAnalysisMdBasename(p: ProgressAnalysisPatient): string {
  const chartTag = p.chart_number ? safeName(p.chart_number) : `id-${String(p.id).slice(0, 8)}`;
  return `${chartTag}_${safeName(p.name)}`;
}

/** PHI 반출 감사로그(csv/txt export 와 동일 패턴). */
export interface ProgressMdAuditMeta {
  actor: string | null;
  actorRole?: string | null;
  clinicId?: string | null;
  patientCount: number;
  chartNumbers: Array<string | null>;
  // T-20260822-foot-PROGANALYSIS-EXTRACT-INDIVIDUAL-MD-BATCH: 'individual' = ZIP 없이 개별 .md 일괄 다운로드.
  mode: 'row' | 'zip' | 'individual';
}
export function logProgressMdExport(meta: ProgressMdAuditMeta): void {
  const record = {
    tag: '[PHI-AUDIT][progress-md-export]',
    at: new Date().toISOString(),
    actor: meta.actor ?? '(unknown)',
    actorRole: meta.actorRole ?? null,
    clinicId: meta.clinicId ?? null,
    mode: meta.mode,
    patientCount: meta.patientCount,
    chartNumbers: meta.chartNumbers,
  };
  console.info(record.tag, JSON.stringify(record));
}

/** 단일 .md 문자열을 파일로 다운로드(무의존, UTF-8 BOM). */
export function downloadMd(content: string, basename: string): void {
  const blob = new Blob(['﻿', content], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${basename}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
