/**
 * Critical-Flow PROD-write 금지 가드 (cross-CRM CI 불변식) — Axis-A root-fix
 *   T-20260812-meta-CLOSING-HERALD-CF5-E2E-PROD-WRITE-BAN
 *   SSOT: agents/docs/da_replies/da_decision_foot_closing_herald_emit_timing_drift_reemit_20260812.md
 *
 * 왜: critical-flow E2E spec(CF-1..5)이 실환자 PROD Supabase 에 직접 write =
 *   category error. CF-5 가 PROD 에 가짜 closed daily_closings(single_card=80,000,
 *   memo='CF-5 자동 마감 spec') INSERT → trg_enqueue_closing_confirmed 발화 →
 *   closing_confirmed_outbox rev0 슬롯 선점 → 실 EOD 마감 emit 이
 *   ON CONFLICT(clinic_id,close_date,revision) DO NOTHING 으로 silent-drop →
 *   stale 80k reader-visible. DA 판정: DO NOTHING 은 정당 멱등(결함 아님),
 *   진원 = phantom 점유자(테스트)의 prod-write.
 *
 * 무엇: critical-flow spec 이 반드시 이 모듈에서 createClient 를 import 하게 하고
 *   (불변식 spec 이 강제), client 생성 이전에 target DB 가 PROD ref 이면 fail-closed
 *   hard-fail 한다. 또한 각 CF spec 의 top-level test.beforeAll 이 어떤 시더(fixtures)보다
 *   먼저 assertCriticalFlowDbSafe 를 호출해, fixtures 시드 write 조차 PROD 로 흐르지 않게 한다.
 *   기존 opt-in PRODREF-HARDGUARD(EXPECT_DEV_DB_REF 주입 시에만 동작)의 격차(컷오버 플래그
 *   OFF 시 prod 로 흐르던 구멍)를 **무조건(UNCONDITIONAL)** 검문으로 봉인한다.
 *
 * fail-closed 원칙 & 회귀 0(AC-4): PROD ref 로 판정될 때만 hard-fail. dev/stage/local/
 *   unknown ref 는 통과 → 정당한 dev/stage 실행에 false-positive 0.
 *
 * cross-CRM: 본 모듈은 foot/body/scalp2/women critical-flow 하네스에 동일 내용으로 이식된다.
 */
import { createClient as _realCreateClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * 전 CRM PROD supabase project ref (SSOT: agents/docs/crm_supabase_ref_registry.yaml).
 *   자기 CRM ref 뿐 아니라 형제 CRM 의 prod ref 도 전부 금지 — cross-wired secret
 *   (오프로젝트 오배선)까지 fail-closed 로 잡는다. registry(supervisor 소유)가 canonical.
 */
export const KNOWN_PROD_REFS: readonly string[] = [
  'muvcfrgmxlwtidundlre', // crm (longre / happy-flow-queue)
  'rxlomoozakkjesdqjtvd', // foot (obliv-foot-crm)
  'hmxnjdmdgfxmsfvytssm', // body (obliv-body-crm)
  'suddcjpbgmawshqqurct', // derm (obliv-derm-crm)
  'wpzstrxuwdooaalvoklg', // scalp2 (obliv-scalp2-crm)
  'aycmpnhsjjttqbtamgaf', // women (obliv-women-crm)
  'vucxspurgmrcslvdbiot', // dopamine (tm-flow)
];

/** supabase URL 에서 project ref 추출: https://<ref>.supabase.co (ref=20자 [a-z0-9]). */
export function resolveTargetRef(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/https?:\/\/([a-z0-9]{20})\.supabase\.(co|in|net)\b/i);
  if (m) return m[1].toLowerCase();
  // 커스텀 도메인/포트 등 정규 매칭 실패 시 — 알려진 prod ref 를 substring 으로 탐지(보강).
  const lower = url.toLowerCase();
  for (const ref of KNOWN_PROD_REFS) if (lower.includes(ref)) return ref;
  return null;
}

/** 주어진 ref 가 알려진 PROD ref 인가. */
export function isProdRef(ref: string | null | undefined): boolean {
  return !!ref && (KNOWN_PROD_REFS as readonly string[]).includes(ref.toLowerCase());
}

/**
 * critical-flow spec 이 write 하려는 target DB 가 PROD 이면 fail-closed hard-fail.
 *   UNCONDITIONAL — EXPECT_DEV_DB_REF opt-in 과 무관하게 항상 검문.
 * @param ctx 진단 로그용 spec 식별자(e.g. 'CF-5').
 * @throws target(VITE_SUPABASE_URL)이 알려진 PROD ref 를 가리킬 때.
 */
export function assertCriticalFlowDbSafe(ctx = 'critical-flow'): void {
  const url = (process.env.VITE_SUPABASE_URL ?? '').trim();
  const ref = resolveTargetRef(url);
  if (isProdRef(ref)) {
    throw new Error(
      `[CF-PROD-WRITE-BAN] critical-flow E2E spec(${ctx}) 가 PROD Supabase(ref=${ref}, url=${url}) 를 ` +
        'write 대상으로 삼으려 합니다 → fail-closed abort. critical-flow 는 dev/ephemeral DB 에서만 ' +
        '실행하세요(실환자 DB 마감 outbox phantom 오염 진원 봉인). E2E dev-isolation(dev DB 컷오버)을 ' +
        '활성화하세요. SSOT: da_decision_foot_closing_herald_emit_timing_drift_reemit_20260812 Axis-A / ' +
        'T-20260812-meta-CLOSING-HERALD-CF5-E2E-PROD-WRITE-BAN.',
    );
  }
}

/**
 * 가드된 supabase 클라이언트 팩토리 — @supabase/supabase-js `createClient` 의 drop-in.
 *   client 생성 이전에 assertCriticalFlowDbSafe() 로 PROD-target 을 차단한다. critical-flow
 *   spec 은 반드시 이 모듈에서 createClient 를 import 해야 한다(불변식 spec 이 강제).
 */
export function createClient(
  url: string,
  key: string,
  opts?: Parameters<typeof _realCreateClient>[2],
): SupabaseClient {
  assertCriticalFlowDbSafe();
  return _realCreateClient(url, key, opts);
}

/**
 * AC2 — outbox-inclusive cleanup(belt). CF-5 가 남기는 파생 outbox 행 회수.
 *   daily_closings status→closed 시 trg_enqueue_closing_confirmed 가
 *   closing_confirmed_outbox 에 (clinic_id, close_date, revision) 행을 INSERT 한다.
 *   기존 teardown 은 daily_closings/payments 만 지워 이 outbox 행이 **누수**됐다.
 *   본 helper 가 그 파생 행을 (clinic_id, close_date) 스코프로 회수한다.
 *   - AC1(prod-write 금지)이 primary(진원 봉인) · 본 항은 belt(전환기 잔여 방지).
 *   - 실패-내성: 테이블 부재(outbox 미보유 CRM)·권한 오류는 swallow(teardown 비차단).
 */
export async function cleanupClosingOutbox(
  sb: SupabaseClient,
  clinicId: string,
  closeDate: string,
): Promise<void> {
  try {
    // supabase-js 는 테이블 부재/권한 시 throw 하지 않고 { error } 를 돌려주므로 결과는 무시.
    await sb.from('closing_confirmed_outbox').delete().eq('clinic_id', clinicId).eq('close_date', closeDate);
  } catch {
    /* outbox 미보유/권한 — belt cleanup 이라 비차단 */
  }
}
