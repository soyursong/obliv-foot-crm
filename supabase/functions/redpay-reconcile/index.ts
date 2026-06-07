// T-20260607-foot-REDPAY-PORT — Edge Function: redpay-reconcile (풋센터 이식)
//
// 출처: T-20260520-crm-PAY-RECON-001 (롱레CRM 검증 완료) → 풋CRM 이식.
//   Redpay 결제 Reconciliation 워커 (단방향 read-only 매칭)
//   M0  — 폴러 + upsert + 4-Tier 매칭 + 4종 알림 로직 (키 없으면 blocked)
//   M1  — 폴러 활성화 (풋 단말기 TID 화이트리스트 확정 후)
//   M2  — 매칭 규칙 실전 적용 (4-Tier)
//   M3  — 운영 알림 4종 실발송 (풋 shadow 검증 후)
//
// ── 풋 변형 (롱레와 다른 점) ─────────────────────────────────────────────────
//   - payments 에 source_system 컬럼 없음(단일 도메인) → 매칭 쿼리에서 필터 제거.
//   - 풋 단말기 TID 화이트리스트 별도 env (REDPAY_TID_WHITELIST).
//   - payments-side .eq(clinic_id) 안티패턴 금지 (부모 incident
//     matcher_clinic_id_mismatch 교훈) — 단일 merchant 폴링이므로 external 키로 안전 매칭.
//
// ── G5 launchd hard-lock ─────────────────────────────────────────────────────
//   키/화이트리스트 확정 전까지 REDPAY_DRY_RUN=true(기본값) 유지 → 실 API 호출 차단.
//   픽스처 시뮬레이션으로 매칭 알고리즘만 검증.
//
// ── 환경 변수 ──────────────────────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — 자동 주입
//   REDPAY_API_KEY         — D1 (기존 검증 키)
//   REDPAY_BUSINESS_NO     — 풋 사업자번호 (종로 풋 511-60-00988)
//   REDPAY_TID_WHITELIST   — 풋 단말기 TID 목록 (쉼표 구분)
//   REDPAY_DRY_RUN         — 'true'(기본) = 실호출 차단, 픽스처 시뮬레이션
//   REDPAY_ALERT_CHANNEL   — M3 알림 채널 (비워두면 로그만)
//   REDPAY_SLACK_BOT_TOKEN — M3 장쳰봇 토큰
//   INTERNAL_CRON_SECRET   — pg_cron 인증 공유 시크릿

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  matchTransactionsBatch,
  detectMissingInCrm,
  detectMissingAtVan,
  detectAmountMismatch,
  detectRefundNotInCrm,
  formatAlertMessage,
  type RawTransaction,
  type CrmPayment,
  type ReconEvent,
} from "./matcher.ts";

// ── 픽스처 (DRY_RUN 모드용) ─────────────────────────────────────────────────
import FIXTURES from "./__fixtures__/redpay-responses.json" with { type: "json" };

// ── 환경 변수 ─────────────────────────────────────────────────────────────
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDPAY_API_KEY            = Deno.env.get("REDPAY_API_KEY") ?? "";
const REDPAY_BUSINESS_NO        = Deno.env.get("REDPAY_BUSINESS_NO") ?? "";
const REDPAY_TID_WHITELIST      = Deno.env.get("REDPAY_TID_WHITELIST") ?? "";
const REDPAY_DRY_RUN            = (Deno.env.get("REDPAY_DRY_RUN") ?? "true") === "true";
const REDPAY_ALERT_CHANNEL      = Deno.env.get("REDPAY_ALERT_CHANNEL") ?? "";
const REDPAY_SLACK_BOT_TOKEN    = Deno.env.get("REDPAY_SLACK_BOT_TOKEN") ?? "";
const INTERNAL_CRON_SECRET      = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
const REDPAY_BASE_URL           = "https://redpay.kr/api/partner/payments.php";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-internal-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── 타입 ──────────────────────────────────────────────────────────────────
interface RunRequest {
  mode:       "incremental" | "daily_full";
  clinic_id?: string;
}

interface RedpayTransaction {
  trxid:          string;
  status:         string;
  status_name?:   string;
  amount:         number;
  approval_no:    string | null;
  root_trxid:     string | null;
  tid:            string | null;
  approved_at:    string | null;
  cancelled_at?:  string | null;
  order_no?:      string | null;
  pg_name?:       string | null;
  pg_type?:       string | null;
  payment_method?: string | null;
  merchant?: {
    id:          string;
    name:        string;
    member_id?:  string;
    member_name?: string;
    tel?:        string;
  };
  [key: string]: unknown;
}

interface RedpayPageResult {
  items:      RedpayTransaction[];
  totalPage:  number;
  total:      number;
}

interface PollerResult {
  fetched:    number;
  upserted:   number;
  matched:    number;
  events:     number;
  errors:     number;
  mode:       string;
  dry_run:    boolean;
  window:     { from: string; to: string };
  elapsed_ms: number;
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // ── 인증 ────────────────────────────────────────────────────────────────
  const cronHeader = req.headers.get("x-internal-cron");
  const authHeader = req.headers.get("authorization");
  const isInternalCron = INTERNAL_CRON_SECRET !== "" && cronHeader === INTERNAL_CRON_SECRET;
  const isServiceRole  = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;

  if (!isInternalCron && !isServiceRole) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── DRY_RUN 모드 분기 (G5 hard-lock) ────────────────────────────────────
  if (REDPAY_DRY_RUN) {
    console.log(
      "[redpay-reconcile][foot] DRY_RUN=true — 픽스처 시뮬레이션 모드. " +
      "실제 API 호출 없음. 매칭 알고리즘 검증 목적."
    );
    let body: RunRequest = { mode: "incremental" };
    try { body = await req.json(); } catch { /* ignore */ }

    const result = await runDryRun(body.mode);
    return json({ status: "ok", dry_run: true, ...result });
  }

  // ── G4 빈 키 silent exit ─────────────────────────────────────────────────
  if (!REDPAY_API_KEY || !REDPAY_BUSINESS_NO) {
    console.warn(
      "[redpay-reconcile][foot] G4 BLOCKED: REDPAY_API_KEY / REDPAY_BUSINESS_NO 미등록. " +
      "키 + 풋 TID 화이트리스트 도착 후 Supabase Vault 등록 필요. 알림 발사 없음."
    );
    return json(
      {
        status: "blocked",
        reason: "REDPAY_API_KEY 또는 REDPAY_BUSINESS_NO 환경변수 미등록. " +
                "외부 의존 대기 중 (ref: T-20260607-foot-REDPAY-PORT AC-2).",
        dry_run: false,
      },
      200
    );
  }

  let body: RunRequest = { mode: "incremental" };
  try { body = await req.json(); } catch { /* ignore */ }

  try {
    const result = await runPoller(body.mode);
    console.log("[redpay-reconcile][foot] 완료:", JSON.stringify(result));
    return json({ status: "ok", dry_run: false, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[redpay-reconcile][foot] 치명 오류:", msg);
    return json({ status: "error", error: msg }, 500);
  }
});

// ── DRY_RUN 파이프라인 (픽스처 → 매처 → 로그만) ──────────────────────────────
async function runDryRun(mode: "incremental" | "daily_full"): Promise<Omit<PollerResult, "dry_run">> {
  const startMs = Date.now();
  const now    = new Date();
  const fromDt = buildFromDate(now, mode);
  const window = { from: fromDt.toISOString(), to: now.toISOString() };

  console.log(`[redpay-reconcile][foot][DRY_RUN] mode=${mode} window=${window.from}~${window.to}`);

  const allFixtureTrx: RedpayTransaction[] = [
    ...FIXTURES.single_approval.response.data.items,
    ...FIXTURES.refund_bundle.response.data.items,
    ...FIXTURES.cancelled.response.data.items,
  ] as RedpayTransaction[];

  const CLINIC_ID = "dry-run-clinic";
  const rawList   = allFixtureTrx.map((t) => toRawTrxRow(CLINIC_ID, t));

  const tidWhitelistDry = new Set(
    REDPAY_TID_WHITELIST.split(",").map((t) => t.trim()).filter(Boolean)
  );
  const rawTrxList = rawList.map((r) => ({
    ...r,
    // toRawTrxRow()는 id를 반환하지 않음 → DRY_RUN용 임시 UUID 부여
    id:                 crypto.randomUUID(),
    matched_payment_id: null,
  })) as import("./matcher.ts").RawTransaction[];

  const matchResults = matchTransactionsBatch(rawTrxList, [], tidWhitelistDry);
  const matchedCount = matchResults.filter((r) => r.matched).length;
  const events: ReconEvent[] = [];

  const unmatchedY = rawTrxList.filter(
    (r) => r.external_status === "Y" &&
    !matchResults.some((mr) => mr.raw_transaction_id === r.id && mr.matched)
  );
  events.push(...detectMissingInCrm(unmatchedY, REDPAY_ALERT_CHANNEL));

  for (const raw of rawTrxList) {
    const refundEvent = detectRefundNotInCrm(raw, [], REDPAY_ALERT_CHANNEL);
    if (refundEvent) events.push(refundEvent);
  }

  for (const evt of events) {
    if (evt.alert_payload) {
      const msg = formatAlertMessage(evt.alert_payload);
      console.log(`[DRY_RUN][${evt.event_type}]`, msg);
    }
  }

  const elapsedMs = Date.now() - startMs;
  console.log(`[redpay-reconcile][foot][DRY_RUN] 완료 elapsed_ms=${elapsedMs}`);

  return {
    fetched:    allFixtureTrx.length,
    upserted:   0,
    matched:    matchedCount,
    events:     events.length,
    errors:     0,
    mode,
    window,
    elapsed_ms: elapsedMs,
  };
}

// ── 실제 폴러 파이프라인 (M1 활성화 후) ─────────────────────────────────────
const EF_TIMEOUT_WARN_MS = 45_000; // 60s 타임아웃의 75% — 경고 임계

const WINDOW_OVERLAP_MS      = 2 * 60 * 1000;      // 2분 오버랩
const WINDOW_MAX_LOOKBACK_MS = 2 * 60 * 60 * 1000; // 최대 2시간 lookback

async function runPoller(mode: "incremental" | "daily_full"): Promise<Omit<PollerResult, "dry_run">> {
  const startMs = Date.now();
  const now    = new Date();

  // ── 윈도 슬라이딩: state 기반 from 계산 ──────────────────────────────────
  let fromDt: Date;
  if (mode === "incremental") {
    const { data: stateRow, error: stateErr } = await supabase
      .from("redpay_poller_state")
      .select("last_incremental_to")
      .eq("id", 1)
      .maybeSingle();

    if (stateErr) {
      console.warn("[redpay-reconcile][foot] state 조회 오류 — fallback 1시간:", stateErr.message);
    }

    const lastTo = stateRow?.last_incremental_to
      ? new Date(stateRow.last_incremental_to as string)
      : null;

    if (lastTo && !isNaN(lastTo.getTime())) {
      const proposed = new Date(lastTo.getTime() - WINDOW_OVERLAP_MS);
      fromDt = new Date(Math.max(proposed.getTime(), now.getTime() - WINDOW_MAX_LOOKBACK_MS));
      console.log(
        `[redpay-reconcile][foot] 윈도 슬라이딩: last_to=${lastTo.toISOString()} → from=${fromDt.toISOString()}`
      );
    } else {
      fromDt = new Date(now.getTime() - 60 * 60 * 1000);
      console.log(`[redpay-reconcile][foot] 윈도 초기화 (state 없음): from=${fromDt.toISOString()}`);
    }
  } else {
    fromDt = buildFromDate(now, mode);
  }

  const window = { from: fromDt.toISOString(), to: now.toISOString() };

  console.log(`[redpay-reconcile][foot] mode=${mode} window=${window.from}~${window.to}`);

  const tidList = REDPAY_TID_WHITELIST
    ? REDPAY_TID_WHITELIST.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  let totalFetched  = 0;
  let totalUpserted = 0;
  let totalMatched  = 0;
  let totalEvents   = 0;
  let totalErrors   = 0;
  let page          = 1;
  const PAGE_SIZE   = 500;

  // clinic_id 조회 (business_no 기준 — 풋 단일 클리닉)
  const { data: clinic } = await supabase
    .from("clinics")
    .select("id")
    .eq("business_no", REDPAY_BUSINESS_NO)
    .maybeSingle();

  const clinicId: string | null = clinic?.id ?? null;
  if (!clinicId) {
    throw new Error(`clinic_id 조회 실패 — business_no=${REDPAY_BUSINESS_NO}`);
  }

  while (true) {
    const { items, totalPage } = await fetchRedpayPage(fromDt, now, tidList, page, PAGE_SIZE);
    if (items.length === 0) break;

    totalFetched += items.length;

    const { upserted, errors } = await upsertRawTransactions(clinicId, items);
    totalUpserted += upserted;
    totalErrors   += errors;

    if (page >= totalPage) break;
    page++;
  }

  // M2 매칭 실행 (4-Tier 알고리즘)
  const { matched, events } = await runMatcher(clinicId);
  totalMatched += matched;
  totalEvents  += events;

  const elapsedMs = Date.now() - startMs;
  console.log(
    `[redpay-reconcile][foot] mode=${mode} 완료 elapsed_ms=${elapsedMs} ` +
    `fetched=${totalFetched} upserted=${totalUpserted} errors=${totalErrors}`
  );

  if (elapsedMs > EF_TIMEOUT_WARN_MS) {
    console.warn(
      `[redpay-reconcile][foot][TIMEOUT-WARN] mode=${mode} elapsed_ms=${elapsedMs} ` +
      `경고임계(${EF_TIMEOUT_WARN_MS}ms) 초과 — TID 확장 시 60s 타임아웃 위험. 청크 분할 검토 필요.`
    );
  }

  // ── 윈도 슬라이딩 상태 저장 ─────────────────────────────────────────────
  try {
    type StateUpsert = {
      id:                   number;
      updated_at:           string;
      last_incremental_to?: string;
      last_fetched_count?:  number;
      last_upserted_count?: number;
      last_daily_to?:       string;
    };
    const stateUpdate: StateUpsert = {
      id:         1,
      updated_at: now.toISOString(),
    };
    if (mode === "incremental") {
      stateUpdate.last_incremental_to  = now.toISOString();
      stateUpdate.last_fetched_count   = totalFetched;
      stateUpdate.last_upserted_count  = totalUpserted;
    } else {
      stateUpdate.last_daily_to = now.toISOString();
    }
    const { error: stateWriteErr } = await supabase
      .from("redpay_poller_state")
      .upsert(stateUpdate);
    if (stateWriteErr) {
      console.warn("[redpay-reconcile][foot] state 저장 실패 (다음 사이클 재시도):", stateWriteErr.message);
    } else {
      console.log(`[redpay-reconcile][foot] 윈도 state 저장 완료: mode=${mode} to=${now.toISOString()}`);
    }
  } catch (stateErr) {
    const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
    console.warn("[redpay-reconcile][foot] state 저장 예외 (다음 사이클 재시도):", msg);
  }

  return {
    fetched:    totalFetched,
    upserted:   totalUpserted,
    matched:    totalMatched,
    events:     totalEvents,
    errors:     totalErrors,
    mode,
    window,
    elapsed_ms: elapsedMs,
  };
}

// ── M2 매칭 실행기 (4-Tier 알고리즘) ─────────────────────────────────────────
// 풋 변형: source_system 필터 제거 (단일 도메인). payments-side clinic_id 필터 금지
//          (AC-2 부모 incident matcher_clinic_id_mismatch 교훈) — 단일 merchant
//          폴링이므로 approval_no/tid/amount/approved_at±윈도 키로 안전 매칭.
async function runMatcher(clinicId: string): Promise<{ matched: number; events: number }> {
  const now = new Date();

  // 1. 미매칭 raw 거래 조회 (Y 상태 + 미매칭)
  const { data: rawTrxList, error: rawErr } = await supabase
    .from("redpay_raw_transactions")
    .select("id,clinic_id,external_trxid,external_status,amount,approval_no,root_trxid,tid,approved_at,matched_payment_id")
    .eq("clinic_id", clinicId)
    .eq("external_status", "Y")
    .is("matched_payment_id", null)
    .order("approved_at", { ascending: true })
    .limit(1000);

  if (rawErr) {
    console.error("[runMatcher][foot] raw 조회 오류:", rawErr.message);
    return { matched: 0, events: 0 };
  }
  if (!rawTrxList?.length) {
    console.log("[runMatcher][foot] 미매칭 raw Y건 없음 — 매칭 불필요");
    return { matched: 0, events: 0 };
  }

  // 2. 비교 대상 CRM 결제 조회 (최근 14일, card + payment + 미매칭)
  //    풋: source_system 필터 없음. payments-side clinic_id 필터 금지(AC-2).
  const since14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: crmPayments, error: crmErr } = await supabase
    .from("payments")
    .select("id,clinic_id,amount,method,payment_type,created_at,external_trxid,external_approval_no,external_tid,reconciled_at")
    .eq("method", "card")
    .eq("payment_type", "payment")
    .is("reconciled_at", null)
    .is("external_trxid", null)
    .gte("created_at", since14d);

  if (crmErr) {
    console.error("[runMatcher][foot] CRM payments 조회 오류:", crmErr.message);
    return { matched: 0, events: 0 };
  }

  // Tier 0 대상: external_approval_no 입력건
  const { data: crmDirectPayments } = await supabase
    .from("payments")
    .select("id,clinic_id,amount,method,payment_type,created_at,external_trxid,external_approval_no,external_tid,reconciled_at")
    .eq("payment_type", "payment")
    .is("reconciled_at", null)
    .is("external_trxid", null)
    .not("external_approval_no", "is", null)
    .gte("created_at", since14d);

  // Tier 0 대상: external_tid 입력건
  const { data: crmTidPayments } = await supabase
    .from("payments")
    .select("id,clinic_id,amount,method,payment_type,created_at,external_trxid,external_approval_no,external_tid,reconciled_at")
    .eq("payment_type", "payment")
    .is("reconciled_at", null)
    .is("external_trxid", null)
    .not("external_tid", "is", null)
    .gte("created_at", since14d);

  // 전체 후보 풀 (중복 제거)
  const allCrmMap = new Map<string, CrmPayment>();
  for (const p of (crmPayments ?? []) as CrmPayment[]) allCrmMap.set(p.id, p);
  for (const p of (crmDirectPayments ?? []) as CrmPayment[]) allCrmMap.set(p.id, p);
  for (const p of (crmTidPayments ?? []) as CrmPayment[]) allCrmMap.set(p.id, p);
  const allCrmPayments = Array.from(allCrmMap.values());

  if (!allCrmPayments.length) {
    console.log("[runMatcher][foot] 미매칭 CRM payments 없음 — 매칭 불필요");
    return { matched: 0, events: 0 };
  }

  const tidWhitelist = new Set(
    REDPAY_TID_WHITELIST.split(",").map((t) => t.trim()).filter(Boolean)
  );

  console.log(
    `[runMatcher][foot] raw Y 미매칭: ${rawTrxList.length}건, CRM pool: ${allCrmPayments.length}건, ` +
    `TID whitelist: [${[...tidWhitelist].join(",")}]`
  );

  // 3. 배치 매칭 (이중 매칭 방지 포함)
  const matchResults = matchTransactionsBatch(
    rawTrxList as RawTransaction[],
    allCrmPayments,
    tidWhitelist
  );

  // 4. 매칭 결과 DB 반영
  let matched = 0;
  const allEvents: ReconEvent[] = [];
  const reconNow = now.toISOString();

  const tierCount: Record<string, number> = {
    tier0_direct: 0, tier1_tight: 0, tier2_loose: 0,
    tier3_daily_unique: 0, tier4_manual: 0, skip: 0,
  };

  for (const result of matchResults) {
    if (result.matched && result.payment_id) {
      const matchedPay = allCrmPayments.find((p) => p.id === result.payment_id)!;
      const rawRow = (rawTrxList as RawTransaction[]).find((r) => r.id === result.raw_transaction_id)!;

      const mismatch = detectAmountMismatch(rawRow, matchedPay, REDPAY_ALERT_CHANNEL);
      if (mismatch) {
        allEvents.push(mismatch);
        tierCount["skip"]++;
        continue;
      }

      const { error: rawUpdateErr } = await supabase
        .from("redpay_raw_transactions")
        .update({
          matched_payment_id: result.payment_id,
          match_rule:         result.match_rule,
        })
        .eq("id", rawRow.id);

      if (rawUpdateErr) {
        console.error(`[runMatcher][foot] raw update 오류 (${rawRow.id}):`, rawUpdateErr.message);
        continue;
      }

      const { error: payUpdateErr } = await supabase
        .from("payments")
        .update({
          reconciled_at:   reconNow,
          external_trxid:  rawRow.external_trxid,
          external_status: rawRow.external_status,
        })
        .eq("id", result.payment_id);

      if (payUpdateErr) {
        console.error(`[runMatcher][foot] payment update 오류 (${result.payment_id}):`, payUpdateErr.message);
        await supabase.from("redpay_raw_transactions")
          .update({ matched_payment_id: null, match_rule: null })
          .eq("id", rawRow.id);
        continue;
      }

      matched++;
      tierCount[result.match_rule ?? "tier4_manual"]++;

      allEvents.push({
        clinic_id:          clinicId,
        raw_transaction_id: rawRow.id,
        payment_id:         result.payment_id,
        event_type:         "auto_matched",
        match_rule:         result.match_rule,
        mismatch_reason:    null,
        external_trxid:     rawRow.external_trxid,
        external_amount:    rawRow.amount,
        crm_amount:         matchedPay.amount,
        alert_payload:      null,
      });
    } else if (result.needs_manual) {
      const rawRow = (rawTrxList as RawTransaction[]).find((r) => r.id === result.raw_transaction_id)!;
      if (rawRow) {
        allEvents.push({
          clinic_id:          clinicId,
          raw_transaction_id: rawRow.id,
          payment_id:         null,
          event_type:         "match_failed",
          match_rule:         "tier4_manual",
          mismatch_reason:    result.fail_reason,
          external_trxid:     rawRow.external_trxid,
          external_amount:    rawRow.amount,
          crm_amount:         null,
          alert_payload:      null,
        });
      }
      tierCount["tier4_manual"]++;
    }
  }

  console.log(
    `[runMatcher][foot] 매칭 완료: total=${matched}건 | ` +
    `tier0=${tierCount.tier0_direct} tier1=${tierCount.tier1_tight} ` +
    `tier2=${tierCount.tier2_loose} tier3=${tierCount.tier3_daily_unique} ` +
    `tier4(manual)=${tierCount.tier4_manual} skip=${tierCount.skip}`
  );

  // 5. missing_in_crm / missing_at_van 탐지
  const stillUnmatched = (rawTrxList as RawTransaction[]).filter(
    (r) => !matchResults.some((mr) => mr.raw_transaction_id === r.id && mr.matched)
  );
  const missingEvents = detectMissingInCrm(stillUnmatched, REDPAY_ALERT_CHANNEL);
  allEvents.push(...missingEvents);

  const missingAtVan = detectMissingAtVan(allCrmPayments, now, REDPAY_ALERT_CHANNEL);
  allEvents.push(...missingAtVan);

  // 환불 추적 (N/X/M raw 건)
  const { data: cancelledRaw } = await supabase
    .from("redpay_raw_transactions")
    .select("id,clinic_id,external_trxid,external_status,amount,approval_no,root_trxid,tid,approved_at,matched_payment_id")
    .eq("clinic_id", clinicId)
    .in("external_status", ["N", "X", "M"])
    .limit(100);

  if (cancelledRaw?.length) {
    // 환불 추적: reconciled CRM payments 조회 (clinic_id 필터 금지 — AC-2)
    const { data: reconciledPays } = await supabase
      .from("payments")
      .select("id,clinic_id,amount,method,payment_type,created_at,external_trxid,external_approval_no,external_tid,reconciled_at")
      .not("reconciled_at", "is", null)
      .not("external_trxid", "is", null);

    for (const raw of cancelledRaw as RawTransaction[]) {
      const refundEvent = detectRefundNotInCrm(raw, (reconciledPays ?? []) as CrmPayment[], REDPAY_ALERT_CHANNEL);
      if (refundEvent) allEvents.push(refundEvent);
    }
  }

  // 6. reconciliation_log 기록
  await insertReconEvents(allEvents);

  // 7. M3 알림 발송 (REDPAY_ALERT_CHANNEL 있을 때만)
  await dispatchAlerts(allEvents);

  console.log(
    `[runMatcher][foot] 이벤트 총계: auto_matched=${allEvents.filter(e=>e.event_type==="auto_matched").length} ` +
    `match_failed=${allEvents.filter(e=>e.event_type==="match_failed").length} ` +
    `missing_in_crm=${missingEvents.length} ` +
    `missing_at_van=${missingAtVan.length}`
  );

  return { matched, events: allEvents.length };
}

// ── reconciliation_log insert ───────────────────────────────────────────────
async function insertReconEvents(events: ReconEvent[]): Promise<void> {
  if (events.length === 0) return;

  const rows = events.map((e) => ({
    clinic_id:          e.clinic_id,
    raw_transaction_id: e.raw_transaction_id,
    payment_id:         e.payment_id,
    event_type:         e.event_type,
    match_rule:         e.match_rule,
    mismatch_reason:    e.mismatch_reason,
    external_trxid:     e.external_trxid,
    external_amount:    e.external_amount,
    crm_amount:         e.crm_amount,
    raw_payload:        e.alert_payload,
  }));

  const { error } = await supabase
    .from("payment_reconciliation_log")
    .insert(rows);

  if (error) {
    console.error("[redpay-reconcile][foot] reconciliation_log insert 오류:", error.message);
  }
}

// ── M3 알림 디스패처 ─────────────────────────────────────────────────────
//   채널 또는 토큰 미설정이면 로그만 (실발송 없음 — G7 풋 shadow 검증 전 단계)
//   30분 쿨다운 + 배치 요약 1건 (알림 피로 방지)
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

async function dispatchAlerts(events: ReconEvent[]): Promise<void> {
  const alertableTypes = new Set([
    "missing_in_crm", "missing_at_van", "amount_mismatch", "refund_not_in_crm",
  ]);

  const alertEvents = events.filter(
    (e) => alertableTypes.has(e.event_type) && e.alert_payload
  );

  if (alertEvents.length === 0) return;

  if (!REDPAY_ALERT_CHANNEL || !REDPAY_SLACK_BOT_TOKEN) {
    console.log(
      `[redpay-reconcile][foot][G7] REDPAY_ALERT_CHANNEL 또는 REDPAY_SLACK_BOT_TOKEN 미설정 — ` +
      `${alertEvents.length}건 로그만 기록 (실발송 없음)`
    );
    for (const evt of alertEvents) {
      const msg = formatAlertMessage(evt.alert_payload!);
      console.log(`[ALERT_LOG][${evt.event_type}]`, msg);
    }
    return;
  }

  const now = new Date();
  try {
    const { data: stateRow } = await supabase
      .from("redpay_poller_state")
      .select("last_alert_sent_at")
      .eq("id", 1)
      .maybeSingle();

    const lastSentAt = stateRow?.last_alert_sent_at
      ? new Date(stateRow.last_alert_sent_at as string)
      : null;

    if (lastSentAt && now.getTime() - lastSentAt.getTime() < ALERT_COOLDOWN_MS) {
      const remainMs = ALERT_COOLDOWN_MS - (now.getTime() - lastSentAt.getTime());
      console.log(
        `[redpay-reconcile][foot][G7] 알림 쿨다운 중 (마지막 발송: ${lastSentAt.toISOString()}, ` +
        `잔여: ${Math.round(remainMs / 60000)}분) — ${alertEvents.length}건 스킵`
      );
      return;
    }
  } catch (cooldownErr) {
    const msg = cooldownErr instanceof Error ? cooldownErr.message : String(cooldownErr);
    console.warn(`[redpay-reconcile][foot][G7] 쿨다운 상태 조회 실패 (발송 진행):`, msg);
  }

  const counts: Record<string, number> = {};
  for (const evt of alertEvents) {
    counts[evt.event_type] = (counts[evt.event_type] ?? 0) + 1;
  }

  const nowKST = now.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  const lines: string[] = [
    `🚨 *[Redpay 정산 알림 · 풋센터]* ${nowKST}`,
    ``,
  ];
  if (counts["missing_in_crm"])    lines.push(`• 🔴 *CRM 미등록*: ${counts["missing_in_crm"]}건 — 단말기 승인 → CRM 결제 없음`);
  if (counts["missing_at_van"])    lines.push(`• ⚠️ *VAN 미확인*: ${counts["missing_at_van"]}건 — CRM 결제 → 단말기 없음`);
  if (counts["amount_mismatch"])   lines.push(`• ⚠️ *금액 불일치*: ${counts["amount_mismatch"]}건`);
  if (counts["refund_not_in_crm"]) lines.push(`• 🔴 *취소 미반영*: ${counts["refund_not_in_crm"]}건`);
  lines.push(``, `합계 *${alertEvents.length}건* 확인 필요 → CRM 관리자 > 결제 조회`);

  const message = lines.join("\n");

  const sent = await sendSlackMessage(REDPAY_ALERT_CHANNEL, message, REDPAY_SLACK_BOT_TOKEN);

  if (sent) {
    try {
      const { error: updateErr } = await supabase
        .from("redpay_poller_state")
        .update({ last_alert_sent_at: now.toISOString() })
        .eq("id", 1);
      if (updateErr) {
        console.warn(`[redpay-reconcile][foot][G7] last_alert_sent_at 갱신 실패:`, updateErr.message);
      }
    } catch (updateEx) {
      const msg = updateEx instanceof Error ? updateEx.message : String(updateEx);
      console.warn(`[redpay-reconcile][foot][G7] last_alert_sent_at 갱신 예외:`, msg);
    }
  }
}

// ── Slack API 발송 헬퍼 (M3 직접 호출 — 장쳰봇 토큰 사용) ─────────────────
async function sendSlackMessage(
  channel: string,
  text:    string,
  token:   string
): Promise<boolean> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json; charset=utf-8",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });

    const data = await res.json() as { ok: boolean; error?: string; ts?: string };
    if (!data.ok) {
      console.error(`[redpay-reconcile][foot][SLACK] 발송 실패: ${data.error} (channel=${channel})`);
      return false;
    }
    console.log(`[redpay-reconcile][foot][SLACK] 발송 성공 → channel=${channel} ts=${data.ts ?? "?"}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[redpay-reconcile][foot][SLACK] 발송 예외: ${msg}`);
    return false;
  }
}

// ── Redpay API 호출 ────────────────────────────────────────────────────────
async function fetchRedpayPage(
  from:    Date,
  to:      Date,
  tidList: string[],
  page:    number,
  limit:   number
): Promise<RedpayPageResult> {
  const params = new URLSearchParams({
    from:        formatRedpayDate(from),
    to:          formatRedpayDate(to),
    business_no: REDPAY_BUSINESS_NO,
    page:        String(page),
    limit:       String(limit),
  });

  if (tidList.length === 1) {
    params.set("tid", tidList[0]);
  }

  const res = await fetchWithRetry(`${REDPAY_BASE_URL}?${params}`, {
    headers: {
      "X-API-KEY": REDPAY_API_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Redpay API 오류 ${res.status}: ${body.slice(0, 200)}`);
  }

  interface RedpayEnvelope {
    success:  boolean;
    message:  string;
    data: {
      items:      RedpayTransaction[];
      pagination: { page: number; limit: number; total: number; total_page: number };
    };
  }
  const envelope = await res.json() as RedpayEnvelope;

  if (!envelope.success) {
    throw new Error(`Redpay API 응답 실패: ${envelope.message}`);
  }

  const items     = envelope.data?.items ?? [];
  const totalPage = envelope.data?.pagination?.total_page ?? 1;
  const total     = envelope.data?.pagination?.total ?? items.length;

  return { items, totalPage, total };
}

// ── Supabase upsert ────────────────────────────────────────────────────────
async function upsertRawTransactions(
  clinicId:     string,
  transactions: RedpayTransaction[]
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0;
  let errors   = 0;

  const rows = transactions.map((t) => toRawTrxRow(clinicId, t));

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from("redpay_raw_transactions")
      .upsert(chunk, {
        onConflict:       "external_trxid,external_status,amount",
        ignoreDuplicates: false,
        count:            "exact",
      });

    if (error) {
      console.error("[redpay-reconcile][foot] upsert 오류:", error.message);
      errors += chunk.length;
    } else {
      upserted += count ?? chunk.length;
    }
  }

  return { upserted, errors };
}

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────────

// Redpay approved_at / cancelled_at KST→UTC 변환 헬퍼
//   Redpay API는 "YYYY-MM-DD HH:MM:SS" 형식의 KST 문자열 반환.
//   Deno Edge Function은 UTC 환경 → "+09:00" 명시 후 toISOString().
function parseKstDatetime(s: string): string | null {
  if (!s || s.startsWith("0000")) return null;
  const iso = s.trim().replace(" ", "T") + "+09:00";
  const d   = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toRawTrxRow(clinicId: string, t: RedpayTransaction) {
  const rootTrxid = t.root_trxid && t.root_trxid !== "" ? t.root_trxid : null;
  const approvedAt  = parseKstDatetime(t.approved_at  ?? "");
  const cancelledAt = parseKstDatetime(t.cancelled_at ?? "");

  return {
    clinic_id:       clinicId,
    external_trxid:  t.trxid,
    external_status: t.status,
    amount:          t.amount,
    approval_no:     t.approval_no ?? null,
    root_trxid:      rootTrxid,
    tid:             t.tid ?? null,
    approved_at:     approvedAt,
    cancelled_at:    cancelledAt,
    raw_payload:     t,
  };
}

function buildFromDate(now: Date, mode: "incremental" | "daily_full"): Date {
  if (mode === "daily_full") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return new Date(yesterday.getTime() - 9 * 60 * 60 * 1000); // KST→UTC
  }
  return new Date(now.getTime() - 60 * 60 * 1000); // incremental: 최근 1시간
}

// Redpay API 날짜 포맷: YYYY-MM-DD
function formatRedpayDate(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchWithRetry(
  url:     string,
  options: RequestInit,
  maxTries = 3,
  delayMs  = 2000
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < maxTries) {
        console.warn(`[redpay][foot] HTTP ${res.status} — ${attempt}/${maxTries}회 재시도`);
        await sleep(delayMs * attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[redpay][foot] fetch 오류 (${attempt}/${maxTries}):`, lastError.message);
      if (attempt < maxTries) await sleep(delayMs * attempt);
    }
  }
  throw lastError ?? new Error("fetchWithRetry: 알 수 없는 오류");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
