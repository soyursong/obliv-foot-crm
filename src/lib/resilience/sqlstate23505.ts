/**
 * sqlstate23505.ts — 23505(unique_violation) constraint-name disambiguation (순수 코어)
 *
 * spec: ~/claude-sync/memory/spec_xcrm_refresh401_resilience.md §3.3 (기준3·기준4)
 * 티켓: T-20260818-foot-REFRESH401-RESILIENCE-PILOT (Step2 (c), R2)
 * DA: MSG-20260818-223942-l4ka (CONSULT-REPLY) + census-gate item4 (prod pg_indexes/pg_constraint 실측)
 *
 * ── 무엇을 푸는가 (R2) ──
 *   (c) write-buffer 가 유실0 재전송을 하면, 서버는 이미 커밋된 write 의 재전송에 대해 23505 를
 *   던진다. 이 23505 를 "성공(내 멱등키 충돌=이미 커밋)"과 "실패(다른 비즈니스 유니크와의 진짜
 *   도메인 충돌)"로 **감별**해야 한다.
 *
 *   ★DA HARD 금지: **全 23505 를 성공 취급 금지** — 실충돌(예: 진짜 중복예약)을 은폐하면
 *   유실0 이 아니라 데이터오염이 된다. constraint **이름**을 파싱해 3분기한다.
 *
 * 분기(census-gate item4, prod 실측 constraint 이름):
 *   A. own-key(내 멱등키/PK 충돌 = 이미 커밋)           → committed  (dequeue, R6 response-loss 흡수)
 *   B. genuine domain conflict(다른 비즈니스 유니크)     → domain_conflict (사용자 surface, 성공취급 금지)
 *   C. find-or-create(기존 재-resolve 로 이미 흡수)       → resolved   (기존 행 재사용, 기 구현 경로)
 *
 * 이 모듈은 순수(React/supabase 비의존) — 이름 매칭만. Node(Playwright collection)에서 그대로 import.
 */

/** 23505 감별 결과. */
export type Sqlstate23505Verdict =
  | 'own_key' // A: 내 멱등키/PK — 이미 커밋됨(성공으로 취급, dequeue)
  | 'domain_conflict' // B: 다른 비즈니스 유니크 — 진짜 충돌(surface, 성공취급 금지)
  | 'find_or_create' // C: 기존 find-or-create 유니크 — 기존 행 재-resolve(성공)
  | 'unknown_unique'; // 미분류 유니크 — 보수적으로 domain_conflict 처럼 surface(성공취급 금지)

/**
 * A) own-key: 내 멱등 substrate(PK 또는 전용 멱등키) 충돌 = 내가 이미 성공적으로 커밋했다는 증거.
 *   재전송(R6 response-loss)이 여기 착지하면 effectively-once 완성 → committed 로 dequeue.
 *   · *_pkey       : 18개 대상 테이블 전부 client-gen UUID PK(census item2).
 *   · ux_*_payment_attempt_id : Class1 CAT 경로 전용 멱등키(partial UNIQUE WHERE NOT NULL).
 */
const OWN_KEY_EXACT = new Set<string>([
  'ux_payments_payment_attempt_id',
  'ux_package_payments_payment_attempt_id',
]);
/** *_pkey 접미사(테이블 PK) = own-key. */
function isPkey(name: string): boolean {
  return /_pkey$/.test(name);
}

/**
 * C) find-or-create: 이미 "insert-then-on-23505-resolve"(기존 행 재-select) 로 흡수 중인 유니크.
 *   blind upsert(DO UPDATE) 금지 — 동시편집 clobber(DA Q-A). 23505 → 기존 행 재사용이 canonical.
 *   · idx_customers_clinic_phone      : customers(clinic_id, phone) — Reservations/Customers/CustomerChartPage 23505-handled
 *   · uix_mc_customer_clinic_date     : medical_charts(customer_id, clinic_id, visit_date) WHERE is_deleted=false — MedicalChartPanel 23505-handled
 */
const FIND_OR_CREATE_EXACT = new Set<string>([
  'idx_customers_clinic_phone',
  'uix_mc_customer_clinic_date',
]);

/**
 * B) genuine domain conflict: 진짜 비즈니스 충돌 → 사용자에게 surface(성공취급 HARD 금지).
 *   재전송이 여기 착지하면 그것은 "내 재전송 dedup"이 아니라 "정당한 다른 행과의 실충돌"이다.
 *   census item4-B 전수(prod 실측). 열거는 문서화/가독 목적 — 매칭은 A/C 아니면 전부 domain(아래 참조).
 */
const DOMAIN_CONFLICT_KNOWN = new Set<string>([
  'idx_reservations_customer_daily', // 중복예약(clinic,customer,date WHERE status<>cancelled)
  'idx_reservations_source_external', // source_system,external_id
  'unique_reservation_checkin', // reservation_id WHERE not null AND status<>cancelled
  'pending_payment_open_uq', // clinic,customer WHERE open
  'package_sessions_package_id_session_number_key',
  'unique_package_checkin_session',
  'uq_form_submissions_clinic_doc_serial_seq',
  'customers_chart_number_unique',
  'payments_external_trxid_unique',
  'payments_ocr_receipt_idempotent_idx',
  'uq_chart_diagnoses_one_primary', // 비즈니스 규칙(primary 1개) — 재전송키 아님
]);

/** PostgREST 에러 메시지/디테일에서 constraint 이름 추출. */
export function extractConstraintName(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { constraint?: unknown; message?: unknown; details?: unknown };
  // supabase-js/PostgREST 는 constraint 를 별도 필드로 주지 않는 경우가 많음 → message/details 파싱.
  if (typeof e.constraint === 'string' && e.constraint) return e.constraint;
  const hay = `${typeof e.message === 'string' ? e.message : ''} ${
    typeof e.details === 'string' ? e.details : ''
  }`;
  const m = /unique constraint "([^"]+)"|violates unique constraint "([^"]+)"/i.exec(hay);
  if (m) return m[1] ?? m[2] ?? null;
  const m2 = /constraint "([^"]+)"/i.exec(hay);
  return m2 ? m2[1] : null;
}

/** 에러가 SQLSTATE 23505(unique_violation) 인가. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === '23505') return true;
  return typeof e.message === 'string' && /duplicate key value|unique constraint/i.test(e.message);
}

/**
 * 23505 감별(R2). constraint 이름으로 A/B/C 분기.
 *   이름 미상 → 'unknown_unique'(보수적 surface — 성공취급 금지가 안전 기본값).
 */
export function classify23505(err: unknown): Sqlstate23505Verdict {
  const name = extractConstraintName(err);
  if (!name) return 'unknown_unique';
  if (isPkey(name) || OWN_KEY_EXACT.has(name)) return 'own_key';
  if (FIND_OR_CREATE_EXACT.has(name)) return 'find_or_create';
  if (DOMAIN_CONFLICT_KNOWN.has(name)) return 'domain_conflict';
  return 'unknown_unique';
}

/** 감별 상수 노출(테스트/가독 — SSOT 는 census-gate item4). */
export const CONSTRAINT_SETS = {
  ownKeyExact: OWN_KEY_EXACT,
  findOrCreateExact: FIND_OR_CREATE_EXACT,
  domainConflictKnown: DOMAIN_CONFLICT_KNOWN,
} as const;
