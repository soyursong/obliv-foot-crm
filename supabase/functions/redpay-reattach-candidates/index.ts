// redpay-reattach-candidates — 승인번호-NULL 수기수납 재부착 '후보검색만' + 담당자 confirm EF
// ════════════════════════════════════════════════════════════════════════════════
// T-20260805-foot-REDPAY-SUGI-REATTACH-CANDIDATEONLY (reporter 최필경, 스레드 1785911915.148039)
//   부모 DORMANTGAP-GUARD(deployed 08-05) = 음성게이트(auto-create 차단). 본 EF = 그 위 양성 candidate 경로.
//   판정(Case 분류·후보검색·candidate-only·confirm 재검증)은 _shared/reattachCandidate.ts(순수, deno test)가
//   결정하고, 본 EF 는 그 판정대로 read(후보 pool 조회) + 담당자 confirm 시 기존행 UPDATE 를 수행한다.
//
// ── 2-case 분기 ────────────────────────────────────────────────────────────────
//   Case A (승인번호 有): 4키 자동매칭 기존경로(본 EF 무관).
//   Case B (승인번호 無 수기): 금액+일자 후보검색만 → 자동연결 절대금지(payment auto-write 0) →
//     후보카드 표시 → 담당자 confirm 후 '기존 수기행'에 승인번호를 채움(UPDATE, 신규행 생성 X).
//
// ── 두 action ──────────────────────────────────────────────────────────────────
//   ① { action:'list', clinic_id, date_from?, date_to? }
//        → Case B 수기수납 각각에 대해 금액+일자 일치 후보 raw 를 붙여 반환(READ-ONLY, write 0).
//          candidate-only: 후보가 1건이어도 자동확정하지 않는다(사람 confirm 전용).
//   ② { action:'confirm', payment_id, raw_id }
//        → 서버 진실로 (payment=Case B, raw=유효후보) 재검증 → claim-first(raw.matched_payment_id IS NULL
//          rows-affected=1) → '기존' payment 행에 external_approval_no + reconciled 메타 UPDATE(신규행 X) →
//          reconciliation_log INSERT(best-effort). ★새 payment 행을 만들지 않는다.
//
// ── db_change=false (스키마 무접촉) ──────────────────────────────────────────────
//   후보검색 = read-only. confirm = 기존 payments 행 UPDATE(external_approval_no/reconciled_at/external_*/
//   accounting_date = 모두 旣존재 컬럼, reverse-match EF 가 이미 사용) + raw.matched_payment_id claim.
//   신규 컬럼/테이블/enum 0 → data-architect CONSULT 불요. 파생/플래그 컬럼 미도입.
//
// ── 인증 ──────────────────────────────────────────────────────────────────────
//   verify_jwt(게이트웨이) — 로그인 스태프 세션 JWT(redpay-reverse-match 동형). 내부 read/write 는
//   service_role(redpay_raw_transactions/payment_reconciliation_log = RLS 바이패스 대사 테이블).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  isCaseBReceipt,
  selectReattachCandidates,
  validateConfirmPair,
  type CandidateRaw,
  type ManualReceiptRow,
} from "../_shared/reattachCandidate.ts";
import {
  REVERSE_MATCH_RULE,
  REVERSE_MATCH_EVENT_TYPE,
  buildReverseMatchPaymentUpdate,
  buildReverseClaimUpdate,
  buildReverseClaimRollback,
} from "../_shared/reverseMatch.ts";

const LOG = "[redpay-reattach-candidates][foot]";
const REDPAY_CENTER = "foot";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// 후보검색 pool 조회창 하한 — 일자 단위 매칭이므로 넉넉히 14일(late 수기입력 커버). read-only 이므로 비용 낮음.
const CANDIDATE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

interface ManualReceiptDbRow extends ManualReceiptRow {
  customer_id?: string | null;
}

const RECEIPT_SELECT =
  "id, clinic_id, amount, method, payment_type, status, deleted_at, external_approval_no, payment_attempt_id, reconciled_at, accounting_date, created_at, customer_id";
const RAW_SELECT =
  "id, clinic_id, amount, approved_at, external_status, matched_payment_id, approval_no, external_trxid, tid, raw_payload";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // ── 인증 — 로그인 스태프 세션 JWT(reverse-match 동형) ──────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(401, { ok: false, error: "unauthorized" });
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.slice(7));
  if (authErr || !user) return json(401, { ok: false, error: "unauthorized" });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_body" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const action = (body["action"] as string | undefined) ?? "list";

  try {
    if (action === "list") return await handleList(admin, body);
    if (action === "confirm") return await handleConfirm(admin, body);
    return json(400, { ok: false, error: "unknown_action", action });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} 처리 예외 → 500: ${msg}`);
    return json(500, { ok: false, error: "unexpected_error", message: msg });
  }
});

// ── ① list — Case B 수기수납 + 후보 raw (READ-ONLY, write 0) ─────────────────────
async function handleList(
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const clinicId = body["clinic_id"] as string | undefined;
  if (!clinicId) return json(400, { ok: false, error: "missing_clinic_id" });

  const nowMs = Date.now();
  const lookbackIso = new Date(nowMs - CANDIDATE_LOOKBACK_MS).toISOString();

  // Case B 후보 수기수납 — 승인번호 NULL·non-CAT·미대사·카드·활성. (넉넉한 조회 후 순수술어로 재확정)
  let receiptQuery = admin
    .from("payments")
    .select(RECEIPT_SELECT)
    .eq("clinic_id", clinicId)
    .eq("method", "card")
    .eq("payment_type", "payment")
    .eq("status", "active")
    .is("deleted_at", null)
    .is("external_approval_no", null)
    .is("payment_attempt_id", null)
    .is("reconciled_at", null)
    .gte("created_at", lookbackIso);
  // 선택 일자 범위(일마감 화면에서 특정일 조회) — accounting_date 우선, created_at 보조.
  const dateFrom = body["date_from"] as string | undefined;
  const dateTo = body["date_to"] as string | undefined;
  if (dateFrom) receiptQuery = receiptQuery.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo) receiptQuery = receiptQuery.lte("created_at", `${dateTo}T23:59:59.999Z`);

  const { data: receiptRows, error: rErr } = await receiptQuery;
  if (rErr) throw rErr;
  const receipts = ((receiptRows ?? []) as ManualReceiptDbRow[]).filter(isCaseBReceipt);

  if (receipts.length === 0) {
    return json(200, { ok: true, action: "list", receipts: [], candidate_pool: 0 });
  }

  // 후보 raw pool — 미매칭 승인 raw(같은 clinic, 조회창 내). 순수술어가 금액·일자·승인번호로 필터.
  const { data: rawRows, error: rawErr } = await admin
    .from("redpay_raw_transactions")
    .select(RAW_SELECT)
    .eq("clinic_id", clinicId)
    .eq("external_status", "Y")
    .is("matched_payment_id", null)
    .not("approval_no", "is", null)
    .gte("approved_at", lookbackIso);
  if (rawErr) throw rawErr;
  const raws = (rawRows ?? []) as CandidateRaw[];

  // 각 수기수납에 후보 붙이기(candidate-only — 1건이어도 auto-pick 하지 않음).
  const out = receipts.map((rc) => {
    const candidates = selectReattachCandidates(rc, raws);
    return {
      payment_id: rc.id,
      amount: rc.amount,
      accounting_date: rc.accounting_date ?? null,
      created_at: rc.created_at ?? null,
      candidate_count: candidates.length, // 0=후보없음, 1+=담당자 확인 필요(자동연결 안 함).
      candidates: candidates.map((c) => ({
        raw_id: c.id,
        approval_no: c.approval_no,
        approved_at: c.approved_at,
        amount: c.amount,
        external_trxid: c.external_trxid ?? null,
        tid: c.tid ?? null,
      })),
    };
  });

  console.log(`${LOG}[list] clinic=${clinicId} caseB=${receipts.length} raw_pool=${raws.length}`);
  return json(200, {
    ok: true,
    action: "list",
    receipts: out,
    candidate_pool: raws.length,
    // ★write 0 — 이 응답은 순수 read. 실제 연결은 담당자 confirm(action='confirm')로만.
    auto_write: 0,
  });
}

// ── ② confirm — 담당자 확정: 기존 수기행에 승인번호 채움(UPDATE, 신규행 X) ──────────
async function handleConfirm(
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const paymentId = body["payment_id"] as string | undefined;
  const rawId = body["raw_id"] as string | undefined;
  if (!paymentId) return json(400, { ok: false, error: "missing_payment_id" });
  if (!rawId) return json(400, { ok: false, error: "missing_raw_id" });

  // ── 1. 기준 수기수납 로드(서버 진실 — 클라 스푸핑 금지) ─────────────────────────
  const { data: payRow, error: payErr } = await admin
    .from("payments")
    .select(RECEIPT_SELECT)
    .eq("id", paymentId)
    .maybeSingle();
  if (payErr) throw payErr;
  if (!payRow) return json(200, { ok: true, matched: false, reason: "payment_not_found" });
  const receipt = payRow as ManualReceiptDbRow;

  // Case B 아님(승인번호 이미 있음/CAT/이미 대사) → 거부(기존경로 무접촉).
  if (!isCaseBReceipt(receipt)) {
    return json(200, { ok: true, matched: false, reason: "not_case_b" });
  }

  // ── 2. 후보 pool 조회 후 confirm 재검증(fabricate/오연결 차단) ──────────────────
  const nowMs = Date.now();
  const lookbackIso = new Date(nowMs - CANDIDATE_LOOKBACK_MS).toISOString();
  const { data: rawRows, error: rawErr } = await admin
    .from("redpay_raw_transactions")
    .select(RAW_SELECT)
    .eq("clinic_id", receipt.clinic_id)
    .eq("external_status", "Y")
    .is("matched_payment_id", null)
    .not("approval_no", "is", null)
    .gte("approved_at", lookbackIso);
  if (rawErr) throw rawErr;
  const raws = (rawRows ?? []) as CandidateRaw[];

  const chosen = validateConfirmPair(receipt, rawId, raws);
  if (!chosen) {
    // 후보 집합에 없는 raw → 승인번호를 채우지 않는다(오연결/추정 차단).
    console.warn(`${LOG}[confirm] 무효 후보 payment=${paymentId} raw=${rawId} → 거부`);
    return json(200, { ok: true, matched: false, reason: "invalid_candidate" });
  }

  const reconNow = new Date(nowMs).toISOString();

  // ── 3. claim-first ① raw claim(유일 직렬화점, rows-affected=1) — reverse-match 동형 ──
  const { data: claimed, error: claimErr } = await admin
    .from("redpay_raw_transactions")
    .update(buildReverseClaimUpdate(paymentId))
    .eq("id", chosen.id)
    .is("matched_payment_id", null) // ★경쟁 패자는 여기서 0-row.
    .select("id");
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length !== 1) {
    console.log(`${LOG}[confirm] race-lost payment=${paymentId} raw=${chosen.id} (rows=${claimed?.length ?? 0})`);
    return json(200, { ok: true, matched: false, reason: "race_lost", raw_id: chosen.id });
  }

  // ── 3. ② '기존' payment 행 UPDATE — external_approval_no + reconciled 메타 채움(신규행 X) ──
  //   reverse-match 와 동일 payload 빌더 재사용(reconciled_at/external_trxid/external_approval_no/
  //   external_tid/accounting_date=approved_at KST). ★INSERT 아님 — 기존 수기행에 승인번호를 채운다.
  //   chosen 은 isEligibleCandidateRaw 통과(external_status==='Y', approval_no 존재) 후보 — Pick 타입에 맞게 정규화.
  const payUpdate = buildReverseMatchPaymentUpdate(
    {
      external_trxid: chosen.external_trxid ?? null,
      external_status: chosen.external_status ?? "Y",
      approval_no: chosen.approval_no ?? null,
      tid: chosen.tid ?? null,
      approved_at: chosen.approved_at,
    },
    reconNow,
    /* includeAccountingDate */ true,
  );
  const { data: payUpdated, error: payUpdErr } = await admin
    .from("payments")
    .update(payUpdate)
    .eq("id", paymentId)
    .is("external_approval_no", null) // 멱등 — 이미 채워졌으면 no-op(중복 confirm 방어).
    .select("id");
  if (payUpdErr || !payUpdated || payUpdated.length !== 1) {
    // rollback ①(raw 링크만) — ★payment 삭제/신규생성 금지. 기존 수기행 그대로 유지.
    await admin.from("redpay_raw_transactions").update(buildReverseClaimRollback()).eq("id", chosen.id);
    const msg = payUpdErr?.message ?? `rows-affected≠1(${payUpdated?.length ?? 0})`;
    console.error(`${LOG}[confirm] payment UPDATE 실패 → raw claim rollback: ${msg}`);
    return json(200, { ok: false, matched: false, reason: "payment_update_failed", detail: msg });
  }

  // ── 3. ③ reconciliation_log INSERT(reverse_matched) — best-effort(실패해도 rollback 없음) ──
  const { error: logErr } = await admin.from("payment_reconciliation_log").insert({
    clinic_id: receipt.clinic_id,
    raw_transaction_id: chosen.id,
    payment_id: paymentId,
    event_type: REVERSE_MATCH_EVENT_TYPE,
    match_rule: REVERSE_MATCH_RULE,
    mismatch_reason: null,
    external_trxid: chosen.external_trxid ?? null,
    external_amount: Number(chosen.amount),
    crm_amount: Number(receipt.amount),
    raw_payload: null,
    center: REDPAY_CENTER,
  });
  if (logErr) console.error(`${LOG}[confirm] reconciliation_log insert 오류(비치명): ${logErr.message}`);

  console.log(`${LOG}[confirm] matched payment=${paymentId} ← raw=${chosen.id} approval_no=${chosen.approval_no} (기존행 UPDATE, 신규행 0)`);
  return json(200, {
    ok: true,
    matched: true,
    payment_id: paymentId,
    raw_id: chosen.id,
    approval_no: chosen.approval_no,
    accounting_date: (payUpdate as { accounting_date?: string }).accounting_date ?? null,
    new_row_created: 0, // ★불변식: 신규 payment 행 생성 없음(기존 수기행만 UPDATE).
  });
}
