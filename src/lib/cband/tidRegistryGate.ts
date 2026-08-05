/**
 * cband/tidRegistryGate.ts — Plan-A CAT직결 per-seat TID를 redpay_terminal_registry allowlist로 게이트
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260805-foot-PLANA-PERSEAT-TID-REGISTRY-GATE (HARDENING · spin-off of REDPAY-INVISIBLE)
 *
 * ── 봉합하는 구조 갭 ──────────────────────────────────────────────────────────
 *   Plan-A CAT직결 결제는 단말 TID 를 per-seat localStorage(cband.terminal.config, PC별 로컬)에서
 *   읽어 커밋한다. 이 TID 가 canonical redpay_terminal_registry(active) allowlist 와 대조되지 않아,
 *   특정 PC 에서 미등록/오등록 TID(예: 1047479470)를 직접 입력해도 결제가 정산 경로로 수락 →
 *   RedPay 정산 사각(전 기간 조회 0건) 을 재생산했다.
 *
 * ── AC 대응 ──────────────────────────────────────────────────────────────────
 *   AC-1: 결제 커밋 경로에서 현재 seat 의 TID 를 registry allowlist(predicate = tid ∪ superseded_tids,
 *         domain='foot'·active)와 대조. ★redpay-reconcile/index.ts loadRegistryTids() 와 동일 predicate 재사용.
 *   AC-2: 미등록 TID 감지 = 1차 soft-warn + 구조화 로깅(누구/어느 seat/어느 TID/시각). ★hard-block 아님
 *         (현장/DA 협의 게이트 — 임의 결제 거부 금지). 이 모듈은 판정·로깅만, 결제 흐름을 막지 않는다.
 *   AC-3: escape hatch — 관리자 override(이 seat 계속 사용) + override 설정/사용을 구조화 로깅.
 *
 * ── 불변식 ───────────────────────────────────────────────────────────────────
 *   · READ-only: registry SELECT + FE 판정. 스키마 무변경(db_change=false). payments/결제 전문 무접촉.
 *   · registry(RLS read_all + GRANT SELECT authenticated, mig 20260711140000) 를 FE 가 직접 read.
 *   · registry 미가용(DB 오류/미배포) → status='unknown'(degrade-open) — 미등록으로 오판하지 않는다
 *     (거짓 경고로 현장 결제 흐름 교란 금지, EF loadRegistryTids fail-safe 방향과 정합).
 */

import { supabase } from '@/lib/supabase';

/** 이 CRM 은 풋 전용 → registry 도메인 스코프 고정(redpay-reconcile EF REDPAY_DOMAIN 미러). */
export const REDPAY_REGISTRY_DOMAIN = 'foot' as const;

// ════════════════════════════════════════════════════════════════════════════
// 1. 순수 predicate — redpay-reconcile/index.ts loadRegistryTids() 와 동일 union-source
//    canonical = redpay_terminal_registry(domain='foot', active) 의 `tid ∪ unnest(superseded_tids)`.
// ════════════════════════════════════════════════════════════════════════════

/** registry row subset(FE SELECT 결과). EF loadRegistryTids 의 select("tid,superseded_tids") 미러. */
export interface RegistryTidRow {
  tid?: string | null;
  superseded_tids?: unknown;
}

/**
 * registry rows → canonical TID 집합(순수·결정론·DB무관·테스트가능).
 *   ★EF loadRegistryTids 와 동일 규칙: trim·drop-empty·dedup, tid ∪ unnest(superseded_tids).
 */
export function buildRegistryTidSet(rows: readonly RegistryTidRow[]): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    const tid = (r.tid ?? '').toString().trim();
    if (tid) set.add(tid);
    const sup = Array.isArray(r.superseded_tids) ? r.superseded_tids : [];
    for (const s of sup) {
      const t = (s ?? '').toString().trim();
      if (t) set.add(t);
    }
  }
  return set;
}

/** 이 TID 가 allowlist(집합)에 등록되어 있는가(순수). 입력 trim 후 대조. */
export function matchRegistryTid(tid: string | null | undefined, allowlist: ReadonlySet<string>): boolean {
  const t = (tid ?? '').toString().trim();
  if (!t) return false;
  return allowlist.has(t);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. FE registry 로더 — authenticated SELECT(RLS read_all). read-only·PHI 무접촉.
// ════════════════════════════════════════════════════════════════════════════

/**
 * registry(domain='foot', active) allowlist 를 FE 에서 로드.
 *   조회 실패/빈 결과 → null 반환(호출측 degrade-open: 'unknown' 처리, 미등록 오판 금지).
 *   ★EF loadRegistryTids 와 동일 predicate — no-DDL·read-only.
 */
export async function loadRegistryTidAllowlist(): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabase
      .from('redpay_terminal_registry')
      .select('tid,superseded_tids')
      .eq('domain', REDPAY_REGISTRY_DOMAIN)
      .eq('active', true);
    if (error) {
      console.warn(`[cband][tid-gate] registry 조회 오류 → 미판정(unknown): ${error.message}`);
      return null;
    }
    if (!Array.isArray(data) || data.length === 0) {
      // 미배포/미seed = 도메인 경계 소실 → unknown(degrade-open, 거짓 경고 금지).
      return null;
    }
    const set = buildRegistryTidSet(data as RegistryTidRow[]);
    return set.size > 0 ? set : null;
  } catch (e) {
    console.warn(`[cband][tid-gate] registry 조회 예외 → 미판정(unknown): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 판정(verdict) — registered / unregistered / unknown
// ════════════════════════════════════════════════════════════════════════════

export type TidRegistryStatus =
  | 'registered'    // seat TID ∈ registry allowlist → 정상.
  | 'unregistered'  // registry 로드 성공 + seat TID ∉ allowlist → soft-warn 대상(AC-2).
  | 'unknown';      // registry 미가용(DB 오류/미배포) 또는 seat TID 빈값 → degrade-open(경고 안 함).

export interface TidRegistryVerdict {
  status: TidRegistryStatus;
  /** 대조한 seat TID(정규화). */
  tid: string;
  /** registry 로드 성공 여부(false=unknown). */
  checked: boolean;
  /** allowlist 크기(로드 성공 시). introspection 용. */
  allowlistSize: number;
}

/**
 * seat TID 를 registry allowlist 와 대조해 verdict 반환(AC-1).
 *   · TID 빈값 → 'unknown'(설정 미완 — 별도 게이트가 담당, 여기서 경고 안 함).
 *   · registry 미가용 → 'unknown'(degrade-open).
 *   · 로드 성공 → allowlist 대조로 registered/unregistered.
 */
export async function checkSeatTidRegistered(tid: string | null | undefined): Promise<TidRegistryVerdict> {
  const t = (tid ?? '').toString().trim();
  if (!t) {
    return { status: 'unknown', tid: '', checked: false, allowlistSize: 0 };
  }
  const allowlist = await loadRegistryTidAllowlist();
  if (!allowlist) {
    return { status: 'unknown', tid: t, checked: false, allowlistSize: 0 };
  }
  return {
    status: matchRegistryTid(t, allowlist) ? 'registered' : 'unregistered',
    tid: t,
    checked: true,
    allowlistSize: allowlist.size,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. seat 식별자 — per-seat(PC) 안정 id. localStorage 기반(구조화 로깅 '어느 seat' 축).
// ════════════════════════════════════════════════════════════════════════════

const SEAT_ID_KEY = 'cband.seat.id';

/** 이 PC(seat) 안정 식별자. 없으면 1회 생성해 localStorage 에 고정(비민감·랜덤). */
export function getSeatId(): string {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'no-storage';
    const existing = window.localStorage.getItem(SEAT_ID_KEY);
    if (existing && existing.trim()) return existing;
    const gen =
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `seat-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    window.localStorage.setItem(SEAT_ID_KEY, gen);
    return gen;
  } catch {
    return 'no-storage';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 5. escape hatch — 관리자 override(이 seat 미등록 TID 계속 사용) + 로깅 (AC-3)
//    per-seat localStorage 플래그. override 는 soft-warn 배너를 억제할 뿐 결제 흐름을 바꾸지 않는다.
// ════════════════════════════════════════════════════════════════════════════

const OVERRIDE_KEY = 'cband.tid.gate.override';

/** 이 seat 에 관리자 override 가 설정되어 있는가(미등록 TID 계속 사용 승인). */
export function isTidGateOverridden(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(OVERRIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 관리자 override 설정/해제 + 구조화 로깅(AC-3). on=true 시 배너 억제.
 *   ★설정/해제 모두 로깅 — 누가·어느 seat·어느 TID 로 우회를 승인했는지 감사 흔적.
 */
export function setTidGateOverride(on: boolean, ctx: TidGateActor & { tid: string }): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (on) window.localStorage.setItem(OVERRIDE_KEY, '1');
      else window.localStorage.removeItem(OVERRIDE_KEY);
    }
  } catch {
    /* ignore */
  }
  console.warn(
    `[cband][tid-gate][OVERRIDE-${on ? 'SET' : 'CLEAR'}] ` +
      JSON.stringify({
        event: on ? 'tid_gate_override_set' : 'tid_gate_override_clear',
        tid: ctx.tid,
        seatId: ctx.seatId ?? getSeatId(),
        userId: ctx.userId ?? null,
        userName: ctx.userName ?? null,
        clinicId: ctx.clinicId ?? null,
        at: new Date().toISOString(),
      }),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 구조화 로깅 — 미등록 TID 결제 커밋(누구/어느 seat/어느 TID/시각) (AC-2)
// ════════════════════════════════════════════════════════════════════════════

/** 로깅 행위자(누구·어느 seat·어느 clinic) 컨텍스트. */
export interface TidGateActor {
  userId?: string | null;
  userName?: string | null;
  clinicId?: string | null;
  seatId?: string | null;
}

export interface UnregisteredTidLogCtx extends TidGateActor {
  tid: string;
  /** 이 커밋이 관리자 override 하에서 진행되었는지. */
  overridden?: boolean;
  /** 로깅 계기: 'commit'(결제요청 커밋) | 'detect'(팝업 감지). */
  phase?: 'commit' | 'detect';
}

/**
 * 미등록 TID 사용을 구조화 로깅(AC-2). 정산 사각 사후추적의 유일 흔적(스키마 무변 — console 구조화 로그).
 *   ★hard-block 아님: 결제 흐름을 막지 않고 흔적만 남긴다(현장/DA 협의 전 정책).
 */
export function logUnregisteredTid(ctx: UnregisteredTidLogCtx): void {
  console.warn(
    '[cband][tid-gate][UNREGISTERED-TID] ' +
      JSON.stringify({
        event: 'unregistered_tid_payment',
        phase: ctx.phase ?? 'commit',
        tid: ctx.tid,
        seatId: ctx.seatId ?? getSeatId(),
        userId: ctx.userId ?? null,
        userName: ctx.userName ?? null,
        clinicId: ctx.clinicId ?? null,
        overridden: ctx.overridden ?? false,
        at: new Date().toISOString(),
      }),
  );
}
