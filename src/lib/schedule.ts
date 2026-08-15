import type { Clinic, OperatingHoursGeneration } from './types';

/**
 * T-20260530-foot-WALKIN-OFFHOUR-SLOT: 풋센터(204) 확정 운영시간
 * 현장 확인: 2026-05-30 08:42 KST (김주연 총괄)
 * AC-5 업데이트: 2026-05-30 KST (김주연 총괄) — 일요일 토요일과 동일 적용
 *
 * ⚠️  코드·화면 표시용 "실제 영업시간" — slot 생성용 close_time 은 +30분 (DB 값 기준)
 *     weekday → DB close_time           = '20:30' → 마지막 슬롯 20:00
 *     saturday/sunday → DB weekend_close_time = '18:30' → 마지막 슬롯 18:00
 */
export const CLINIC_HOURS = {
  weekday:  { open: '10:00', close: '20:00' }, // 월~금
  saturday: { open: '10:00', close: '18:00' }, // 토
  sunday:   { open: '10:00', close: '18:00' }, // 일 (토요일 동일, 2026-05-30 김주연 총괄)
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901: date-aware 운영시간 세대 resolver.
//   CEO MISSION(MSG-20260815-150459-1ma4) — 2026-09-01 forward-only 발효(jongno-foot 단독).
//   발효방식 = 롱레 clinic_operating_hours date-aware 세대 테이블 이식(CEO 택일).
//   DA CONSULT-REPLY = DA-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901 (CONDITIONAL-GO · ADDITIVE · verbatim mirror).
//
//   ★모델 = 롱레 clinic_operating_hours verbatim mirror (DA Q2/Q3):
//     day_of_week / open_time / close_time(독립 운영종료) / last_booking_slot(INCLUSIVE) / effective_from + effective_to.
//   ★발견 A 해소(DA Q3, load-bearing): last_booking_slot 은 INCLUSIVE 로 저장(canonical, 롱레 mirror).
//     foot generateSlots 는 [open, close) EXCLUSIVE → resolver 가 EXCLUSIVE close = last_booking_slot + slot_interval
//     로 파생한다(저장 아님·2nd-SoT 아님). close_time(운영종료)은 슬롯 상한이 아니라 표시/사실 컬럼.
//   ★발견 B 해소(DA Q4): 휴무 = 해당 요일 row-absent(negative-space). is_closed 컬럼 발명 없음(롱레 census dispositive).
//     활성 세대가 조회일을 커버하는데 그 요일 행이 없으면 = 휴무(예약 불가 + 슬롯 0 + 폼/제출 실차단).
//   ★forward-only: 조회일 커버 세대 부재(effective_from > 조회일 / 미배포 / 미관리) → flat 3컬럼 fallback
//     → 2026-08-31 이전 날짜 무교란(AC-2). 세대 테이블 미배포 DB 도 동일 경로로 안전 폴백.
// ─────────────────────────────────────────────────────────────────────────────

/** Date → 로컬(Asia/Seoul 런타임) 'YYYY-MM-DD' (UTC 변환 없이 캘린더 날짜 그대로) */
function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** PostgREST TIME 컬럼('HH:MM:SS')·표시값('HH:MM') → 'HH:MM' 정규화 */
function hhmm(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

/**
 * 'HH:MM' + 분 → 'HH:MM'. INCLUSIVE last_booking_slot → EXCLUSIVE close 파생용(발견 A).
 *   운영시간상 자정 초과는 미발생이나 방어적으로 24h wrap 처리.
 */
function addMinutes(hm: string, minutes: number): string {
  const [h, m] = hhmm(hm).split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export interface OpWindow {
  isClosed: boolean;
  open: string;   // 'HH:MM' 하한 (휴무면 '')
  close: string;  // 'HH:MM' EXCLUSIVE 상한 (generateSlots [open,close) 직결, 휴무면 '')
}

/**
 * 해당 날짜의 운영 window(SSOT).
 *   1) clinic_operating_hours 에서 effective_from<=조회일 & (effective_to null|>=조회일) 로 '커버' 하는 세대행 집합.
 *      집합이 비면 → flat fallback(2026-08-31 이전 / 미배포 / 미관리 지점 무교란, AC-2).
 *   2) 커버 집합의 max(effective_from) = 활성 세대. 그 안에서 day_of_week 매칭 1행:
 *      · 매칭 행 있음 → 영업(open=open_time, EXCLUSIVE close = last_booking_slot + slot_interval 파생).
 *      · 매칭 행 없음(요일 row-absent) → 휴무(isClosed). ★is_closed 컬럼 없이 휴무 표현(DA Q4).
 */
export function slotWindowFor(date: Date, clinic: Clinic): OpWindow {
  const gens = clinic.operating_hours;
  if (gens && gens.length > 0) {
    const ymd = toLocalYmd(date);
    // 커버 = 조회일을 발효구간에 포함하는 모든 세대행(요일 무관 — 세대 관리 여부 판별용).
    const covering = gens.filter(
      (g) => g.effective_from <= ymd && (g.effective_to === null || g.effective_to >= ymd),
    );
    if (covering.length > 0) {
      // 활성 세대 = 커버 중 max(effective_from) (forward-only 최신 세대 우선).
      let maxEff = covering[0].effective_from;
      for (const g of covering) if (g.effective_from > maxEff) maxEff = g.effective_from;
      const dow = date.getDay(); // 0=일 … 6=토
      const row = covering.find((g) => g.effective_from === maxEff && g.day_of_week === dow);
      if (!row) {
        // 활성 세대가 이 날짜를 관리하나 해당 요일 행 부재 = 휴무(row-absent negative-space).
        return { isClosed: true, open: '', close: '' };
      }
      // INCLUSIVE last_booking_slot → EXCLUSIVE close 파생(발견 A · AC-3). close_time 은 슬롯 상한 아님.
      return {
        isClosed: false,
        open: hhmm(row.open_time),
        close: addMinutes(row.last_booking_slot, clinic.slot_interval),
      };
    }
    // covering 비었으면 flat fallback (forward-only: 조회일 이전 세대 없음).
  }
  // flat fallback: 현행 flat 3컬럼(현행 동작 무교란, AC-2). close=EXCLUSIVE(clinics.close_time 시맨틱).
  return { isClosed: false, open: clinic.open_time, close: closeTimeFor(date, clinic) };
}

/**
 * 운영일 여부(date-aware, 발견 B). 휴무 세대 → false(예약 불가). clinic 미제공 시 true(하위호환).
 */
export function isOpenDay(date: Date, clinic?: Clinic | null): boolean {
  if (!clinic) return true;
  return !slotWindowFor(date, clinic).isClosed;
}

/**
 * 해당 날짜의 신규예약 가능 슬롯 목록(SSOT). 휴무일 → [] (슬롯 0). 날짜별 운영시간(세대/flat) 자동 반영.
 */
export function slotsForDate(date: Date, clinic: Clinic): string[] {
  const w = slotWindowFor(date, clinic);
  if (w.isClosed) return [];
  return generateSlots(w.open, w.close, clinic.slot_interval);
}

/**
 * 주(week) 뷰 그리드 행 목록 = 주간 영업일들의 union window(min open ~ max close).
 *   휴무일 열은 caller 가 isOpenDay 로 회색/비활성 처리. 전부 휴무면 [].
 */
export function weekSlotRange(days: Date[], clinic: Clinic): string[] {
  let minOpen: string | null = null;
  let maxClose: string | null = null;
  for (const d of days) {
    const w = slotWindowFor(d, clinic);
    if (w.isClosed) continue;
    if (minOpen === null || w.open < minOpen) minOpen = w.open;
    if (maxClose === null || w.close > maxClose) maxClose = w.close;
  }
  if (minOpen === null || maxClose === null) return [];
  return generateSlots(minOpen, maxClose, clinic.slot_interval);
}

// 해당 날짜의 close_time (flat 폴백용 — 토요일·일요일은 weekend_close_time). 세대는 slotWindowFor 참조.
export function closeTimeFor(date: Date, clinic: Clinic): string {
  const dow = date.getDay();
  if (dow === 6 || dow === 0) return clinic.weekend_close_time;
  return clinic.close_time;
}

export function openTimeFor(clinic: Clinic): string {
  return clinic.open_time;
}

// "10:00" + 30 → ["10:00", "10:30", ...] up to close (EXCLUSIVE: close 미포함)
export function generateSlots(open: string, close: string, intervalMin: number): string[] {
  const [oh, om] = hhmm(open).split(':').map(Number);
  const [ch, cm] = hhmm(close).split(':').map(Number);
  const startMin = oh * 60 + om;
  const endMin = ch * 60 + cm;
  const slots: string[] = [];
  for (let m = startMin; m < endMin; m += intervalMin) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return slots;
}

export const WEEK_DAYS_KO = ['월', '화', '수', '목', '금', '토', '일'];

// T-20260716-foot-TIMESLOT-RESCHEDULE-EMPTYDATE: 예약 시간 선택 그리드 SSOT (07:00~22:00, 30분).
//   - 신규예약 폼(ReservationDetailPopup NEW_RESV_TIME_SLOTS)이 쓰던 규칙과 동일(editor EDIT_TIME_SLOTS 규칙).
//   - 예약상세 reschedule 에서 "예약 0건 날짜"에도 이 그리드로 클릭 가능한 시간 슬롯을 렌더(빈 슬롯 = count 0).
//   두 경로가 같은 그리드를 공유하도록 단일 상수로 승격(하드코딩 중복 제거).
export const RESV_TIME_GRID = generateSlots('07:00', '22:00', 30);

// 참조 타입 재수출(caller 편의)
export type { OperatingHoursGeneration };
