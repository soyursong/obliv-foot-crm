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
 * GATE: read-only 조회만. DB/스키마/트리거/write 0(db_change=false). 외부 AI 미경유(결정론 규칙).
 * PHI: 산출 .md = 진료성 PHI. 호출부(경과분석 탭)에서 admin/manager(운영권한) 게이팅 + export 감사로그.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { anticipatedSession, isSixMultipleTarget, chunkIds, IN_CHUNK_SIZE } from './progressSixMultiple';

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
}

/* ────────────────────────── 데이터 fetch (browser supabase, read-only) ────────────────────────── */

type SB = SupabaseClient;

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
  };
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return env;

  // 1) 6배수 도래 마일스톤(고객별) — 활성 패키지 + used 카운트 + (used+1)%6==0. (스크립트 코호트 로직 그대로)
  try {
    const pkgs: Array<{ id: string; customer_id: string; total_sessions: number | null }> = [];
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('packages')
        .select('id, customer_id, total_sessions')
        .eq('clinic_id', clinicId)
        .eq('status', 'active')
        .in('customer_id', slice);
      for (const p of arr<{ id: string; customer_id: string | null; total_sessions: number | null }>(data)) {
        if (p.id && p.customer_id && (p.total_sessions ?? 0) > 0) {
          pkgs.push({ id: p.id, customer_id: p.customer_id, total_sessions: p.total_sessions });
        }
      }
    }
    const usedMap = new Map<string, number>();
    const pkgIds = pkgs.map((p) => p.id);
    for (const slice of chunkIds(pkgIds, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('package_sessions')
        .select('package_id')
        .in('package_id', slice)
        .eq('status', 'used');
      for (const s of arr<{ package_id: string }>(data)) {
        usedMap.set(s.package_id, (usedMap.get(s.package_id) ?? 0) + 1);
      }
    }
    for (const p of pkgs) {
      const used = usedMap.get(p.id) ?? 0;
      if (!isSixMultipleTarget({ usedSessions: used, totalSessions: p.total_sessions })) continue;
      const list = env.milestonesByCust.get(p.customer_id) ?? [];
      list.push({ anticipated: anticipatedSession(used), used, total: p.total_sessions ?? 0 });
      env.milestonesByCust.set(p.customer_id, list);
    }
  } catch {
    /* 마일스톤 보강 실패 — 헤더 회차 라벨만 폴백 */
  }

  // 2) 내원 횟수(취소제외) — check_ins.
  try {
    const cnt = new Map<string, number>();
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('check_ins')
        .select('customer_id, status')
        .in('customer_id', slice);
      for (const c of arr<{ customer_id: string | null; status: string | null }>(data)) {
        if (!c.customer_id) continue;
        if (c.status === 'cancelled') continue; // IS DISTINCT FROM 'cancelled'
        cnt.set(c.customer_id, (cnt.get(c.customer_id) ?? 0) + 1);
      }
    }
    env.visitCountByCust = cnt;
  } catch {
    /* 무시 */
  }

  // 3) 다음 예약(오늘 이후 미취소 최이른) per customer.
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('reservations')
        .select('customer_id, reservation_date, reservation_time, registrar_name, status')
        .eq('clinic_id', clinicId)
        .in('customer_id', slice)
        .gte('reservation_date', today)
        .neq('status', 'cancelled')
        .order('reservation_date', { ascending: true })
        .order('reservation_time', { ascending: true });
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
  } catch {
    /* 미예약 취급 */
  }

  // 4) 치료메모(활성).
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('customer_treatment_memos')
        .select('customer_id, content, created_at, created_by, created_by_name')
        .in('customer_id', slice)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
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
  } catch {
    /* 기록 없음 처리 */
  }

  // 5) 처방내역(prescriptions + items). 테이블 미사용 가능 → 방어.
  try {
    const allRx: Array<Rx & { customer_id: string }> = [];
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('prescriptions')
        .select('id, customer_id, prescribed_at, prescribed_by_name, diagnosis, memo, created_at')
        .in('customer_id', slice)
        .order('created_at', { ascending: true });
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
      const { data } = await supabase
        .from('prescription_items')
        .select('prescription_id, medication_name, dosage, duration_days, quantity, memo, sort_order')
        .in('prescription_id', slice)
        .order('sort_order', { ascending: true });
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
  } catch {
    /* 처방 미사용 — 기록 없음 */
  }

  // 6) 과거력(health_q_results, 고객당 최초 제출).
  try {
    const seen = new Set<string>();
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('health_q_results')
        .select('customer_id, form_data, submitted_at, created_at')
        .in('customer_id', slice)
        .order('created_at', { ascending: true });
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
  } catch {
    /* 기록 없음 */
  }

  // 7) 첫 방문일(check_ins min date, 취소제외).
  try {
    const minBy = new Map<string, string>();
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('check_ins')
        .select('customer_id, checked_in_at, status')
        .in('customer_id', slice);
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
  } catch {
    /* 무시 */
  }

  // 8) 상담메모(활성 전량).
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('customer_consult_memos')
        .select('customer_id, content, created_at, created_by_name')
        .in('customer_id', slice)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
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
  } catch {
    /* 없음 */
  }

  // 9) 진료차트(medical_charts, is_deleted 제외 = IS NOT TRUE).
  try {
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('medical_charts')
        .select(
          'customer_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, materials_used, treatment_result, created_by_name, created_at, is_deleted',
        )
        .in('customer_id', slice)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('visit_date', { ascending: true })
        .order('created_at', { ascending: true });
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
  } catch {
    /* 진료차트 없음 */
  }

  // 10) 루틴상용구 사전(섹션5 R1) = phrase_templates + super_phrases (clinic-global, 1회).
  try {
    const { data: pt } = await supabase
      .from('phrase_templates')
      .select('content, phrase_type')
      .in('phrase_type', ['customer_chart', 'medical_chart', 'pen_chart']);
    for (const r of arr<{ content: string | null }>(pt)) {
      const n = norm(r.content);
      if (n) env.boilerSet.add(n);
    }
  } catch {
    /* 상용구 사전 로드 실패 — 섹션5 발췌는 R1 미적용으로 진행(무해) */
  }
  try {
    const { data: sp } = await supabase.from('super_phrases').select('diagnosis, clinical_progress');
    for (const r of arr<{ diagnosis: string | null; clinical_progress: string | null }>(sp)) {
      for (const v of [r.diagnosis, r.clinical_progress]) {
        const n = norm(v);
        if (n) env.boilerSet.add(n);
      }
    }
  } catch {
    /* 무시 */
  }

  // 11) 【6】 진료내역 — check_ins 방문 전건(취소 제외), 방문일 오름차순. (id 는 【7】 동선 조인 키)
  try {
    const byCust = new Map<string, VisitRecord[]>();
    for (const slice of chunkIds(ids, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('check_ins')
        .select('id, customer_id, checked_in_at, completed_at, visit_type, treatment_category, status')
        .in('customer_id', slice)
        .order('checked_in_at', { ascending: true });
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
  } catch {
    /* 진료내역 없음 처리 */
  }

  // 12) 【7】 동선 로그 — check_in_room_logs (방문별 슬롯 체류). check_in_id 기준, logged_at 오름차순.
  try {
    const visitsMap = env.visitsByCust ?? new Map<string, VisitRecord[]>();
    const roomLogMap = env.roomLogsByCheckIn ?? new Map<string, VisitRoomLog[]>(); // init 에서 세팅됨(동일 참조)
    const checkInIds: string[] = [];
    for (const list of visitsMap.values()) for (const v of list) if (v.id) checkInIds.push(v.id);
    const uniqCheckInIds = [...new Set(checkInIds)];
    for (const slice of chunkIds(uniqCheckInIds, IN_CHUNK_SIZE)) {
      const { data } = await supabase
        .from('check_in_room_logs')
        .select('check_in_id, assigned_room, room_type, logged_at')
        .in('check_in_id', slice)
        .order('logged_at', { ascending: true });
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
  } catch {
    /* 동선 로그 테이블 미존재/권한 — 해당 섹션 "동선 로그 없음" 정직 표기 */
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
  L.push('### 6배수 예정 회차 · 예약일');
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
    L.push('_기록 없음_');
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
    L.push('_기록 없음_  (처방 테이블·차트/접수 처방필드 전부 미기재)');
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
    L.push('_기록 없음_');
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
    L.push('_기록 없음_');
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
    L.push('_상담메모 없음_');
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
    L.push('_진료차트(디지털) 기록 없음_');
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
    L.push('_진료내역 없음_');
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
    L.push('_진료내역 없음 — 동선 로그 대조 대상 없음_');
    L.push('');
  } else {
    for (const v of visitList) {
      const inn = seoulDateTime(v.checked_in_at);
      const logs = (env.roomLogsByCheckIn?.get(v.id) ?? []).filter((l) => l.logged_at);
      const laserDone = logs.some((l) => isLaserRoom(l.room_type, l.assigned_room));
      L.push(`## 방문일 ${inn.date} (접수 ${inn.time})`);
      L.push('');
      L.push(`- 치료 시행 판정: ${laserDone ? '**치료 시행(레이저 슬롯 있음)**' : '치료 시행 근거 없음(레이저 슬롯 없음)'}`);
      L.push('');
      if (logs.length === 0) {
        L.push('_동선 로그 없음_');
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
