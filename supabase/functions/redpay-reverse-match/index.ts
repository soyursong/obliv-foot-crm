// redpay-reverse-match — 레드페이 역방향 매칭([수납] 저장 훅) write-path 오케스트레이션 EF
// ════════════════════════════════════════════════════════════════════════════════
// T-20260730-foot-REDPAY-REVERSE-MATCH-SUSU-HOOK-BUILD
//   SSOT   = da_consult_reply_foot_redpay_reverse_match_susu_hook_20260730.md
//   decision_id = DA-20260730-FOOT-REDPAY-REVERSE-MATCH-SUSU-HOOK · verdict=GO · change-class=no-DDL
//   write-path 확정 = planner MSG-20260730-160252(D1~D4) + kn3b foot-native 필드계약(§52-53 REPLACE)
//
// ── 무엇 ──────────────────────────────────────────────────────────────────────
//   직원이 [수납]을 저장(payments INSERT)한 직후, 그 payment 를 기준으로 유효창(10분) 내 승인됐으나
//   auto-match 실패로 matched_payment_id IS NULL 로 남은 redpay raw(reverse-miss)를 1건 안전 연결한다.
//   판정(후보선택·유효창·모호스킵·앵커일자)은 reverseMatch.ts(순수, deno test 전수검증)가 결정하고,
//   본 EF 는 그 판정대로 DB write(claim-first 3-write 단일 논리 txn) + cue.paid emit 편입을 수행한다.
//
// ── D1 원자성 = EF claim-first(신규 RPC/CREATE FUNCTION 도입 없음 → no-DDL 유지, forward 매처 패턴) ──
//   ① raw claim   : UPDATE redpay_raw_transactions SET matched_payment_id=?, match_rule='reverse_susu_hook'
//                    WHERE id=? AND matched_payment_id IS NULL  → rows-affected=1 검증(유일 직렬화점).
//                    패자(rows-affected=0) = webhook auto-match/OPT3버튼 경쟁 패배 → 후속 write 진입 전 abort.
//   ② payment annotate : UPDATE payments SET reconciled_at/external_*/accounting_date(=approved_at KST) WHERE id=?
//                    → rows-affected=1 검증. 실패 시 ① rollback(matched_payment_id=NULL). ★payment 삭제 금지(D2).
//   ③ reconciliation_log INSERT : event_type='reverse_matched'(신규 값, DA (d)). best-effort(실패해도 rollback 없음).
//
// ── D2 race-loss = payment 유지(annotate-on-existing) ──────────────────────────
//   [수납] 저장이 payment 를 이미 생성 → race 패자 시 payment 저장 유지(정상 수납), 귀속 annotate 만 no-op.
//
// ── D3 매출-일자 앵커 = accounting_date = raw.approved_at Seoul 달력일 ─────────────
//   본건 최중요 AC(late-arrival 일경계 drift). payments INSERT 트리거가 created_at KST 로 stamp 한 값을
//   approved_at KST 로 덮어씀(UPDATE 는 INSERT 트리거 재발화 없음).
//
// ── D4 cue.paid SoT emit = forward cue.paid emit hook 미러 ──────────────────────
//   매칭 성공 + 연결 payment 의 check_in→reservation 이 dopamine-origin 이면 DOPAMINE_CALLBACK type='paid' emit.
//   본 EF 는 emit-intent 만 계산해 응답에 실어 보내고(서버측 게이트 판정), 실제 발화는 세션 보유 클라이언트가
//   forward(PaymentDialog) 와 동일 경로(supabase.functions.invoke(DOPAMINE_CALLBACK))로 수행(멱등=outbound_log).
//
// ── 인증 ──────────────────────────────────────────────────────────────────────
//   verify_jwt=true(게이트웨이 기본) — [수납] 저장한 로그인 스태프 세션 JWT 검증(dopamine-callback 동형).
//   내부 write 는 service_role(redpay_raw_transactions/payment_reconciliation_log = 대사 테이블, RLS 바이패스).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  REVERSE_MATCH_RETENTION_MS,
  buildReverseClaimUpdate,
  buildReverseClaimRollback,
  buildReverseMatchPaymentUpdate,
  buildReverseReconLogRow,
  selectReverseMatchCandidate,
  type ReverseRaw,
  type SavedPayment,
} from "../redpay-reconcile/reverseMatch.ts";

const LOG = "[redpay-reverse-match][foot]";
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // ── 인증 — [수납] 저장 스태프 세션 JWT(dopamine-callback 동형) ──────────────────
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
  const paymentId = body["payment_id"] as string | undefined;
  if (!paymentId) return json(400, { ok: false, error: "missing_payment_id" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    // ── 1. 기준 payment 로드(서버측 진실 — 클라 스푸핑 금지) ─────────────────────
    const { data: pay, error: payErr } = await admin
      .from("payments")
      .select("id, clinic_id, amount, method, payment_type, created_at, reconciled_at, check_in_id")
      .eq("id", paymentId)
      .maybeSingle();
    if (payErr) throw payErr;
    if (!pay) return json(200, { ok: true, matched: false, reason: "payment_not_found" });

    // 멱등 — 이미 대사(reconciled_at≠NULL)된 payment 는 재-annotate 금지(no-op).
    if (pay.reconciled_at != null) {
      return json(200, { ok: true, matched: false, reason: "already_reconciled" });
    }

    const payment: SavedPayment = {
      id: pay.id,
      clinic_id: pay.clinic_id,
      amount: Number(pay.amount),
      method: pay.method,
      payment_type: pay.payment_type,
      created_at: pay.created_at,
    };

    // 비대상(카드·payment 만) 조기 반환 — raw 조회 비용 절감. selectReverseMatchCandidate 도 동일 게이트.
    if (payment.method !== "card" || payment.payment_type !== "payment") {
      return json(200, { ok: true, matched: false, reason: "not_card_payment" });
    }

    // ── 2. unmatched 승인 raw 후보 pool 조회(보관창 1h·같은 clinic·같은 금액) ────────
    //   E-1 (b) 보관창(1h) = 조회 pool 시간 하한. 실 자동대조 유효창(10분)은 순수모듈이 필터.
    const nowMs = Date.now();
    const retentionCutoffIso = new Date(nowMs - REVERSE_MATCH_RETENTION_MS).toISOString();
    const { data: rawsRaw, error: rawErr } = await admin
      .from("redpay_raw_transactions")
      .select("id, clinic_id, amount, approved_at, external_status, matched_payment_id, external_trxid, approval_no, tid, raw_payload")
      .eq("clinic_id", payment.clinic_id)
      .is("matched_payment_id", null)
      .eq("external_status", "Y")
      .eq("amount", payment.amount)
      .gte("approved_at", retentionCutoffIso);
    if (rawErr) throw rawErr;
    const raws = (rawsRaw ?? []) as ReverseRaw[];

    // ── 3. 순수 판정 — 후보 선택(E-2 4조건 강제) ────────────────────────────────
    const decision = selectReverseMatchCandidate(payment, raws, nowMs);
    if (decision.reason !== "matched" || !decision.raw) {
      console.log(`${LOG} no-op payment=${paymentId} reason=${decision.reason} cand=${decision.candidateCount}`);
      return json(200, {
        ok: true,
        matched: false,
        reason: decision.reason,
        candidate_count: decision.candidateCount,
      });
    }
    const raw = decision.raw;
    const reconNow = new Date(nowMs).toISOString();

    // ── 4. D1 claim-first ① raw claim(유일 직렬화점, rows-affected=1) ──────────────
    const { data: claimed, error: claimErr } = await admin
      .from("redpay_raw_transactions")
      .update(buildReverseClaimUpdate(payment.id))
      .eq("id", raw.id)
      .is("matched_payment_id", null) // ★직렬화 가드 — 경쟁 패자는 여기서 0-row.
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length !== 1) {
      // race-loss(D2) — 다른 경쟁자(webhook/OPT3)가 선점. payment 무접촉(annotate 진입 안 함).
      console.log(`${LOG} race-lost payment=${paymentId} raw=${raw.id} (rows=${claimed?.length ?? 0})`);
      return json(200, { ok: true, matched: false, reason: "race_lost", raw_id: raw.id });
    }

    // ── 4. ② payment annotate(reconciled_at/external_*/accounting_date=approved_at KST) ──
    const payUpdate = buildReverseMatchPaymentUpdate(raw, reconNow, /* includeAccountingDate */ true);
    const { data: payUpdated, error: payUpdErr } = await admin
      .from("payments")
      .update(payUpdate)
      .eq("id", payment.id)
      .select("id"); // C2 rows-affected 검증(silent write-failure 금지).
    if (payUpdErr || !payUpdated || payUpdated.length !== 1) {
      // rollback ①(raw 링크만) — ★payment 삭제 금지(D2). 다음 저장/워커가 재시도.
      await admin.from("redpay_raw_transactions").update(buildReverseClaimRollback()).eq("id", raw.id);
      const msg = payUpdErr?.message ?? `rows-affected≠1(${payUpdated?.length ?? 0})`;
      console.error(`${LOG} payment annotate 실패 → raw claim rollback: ${msg}`);
      return json(200, { ok: false, matched: false, reason: "payment_annotate_failed", detail: msg });
    }

    // ── 4. ③ reconciliation_log INSERT(event_type='reverse_matched') — best-effort ──
    const { error: logErr } = await admin
      .from("payment_reconciliation_log")
      .insert(buildReverseReconLogRow(raw, payment, REDPAY_CENTER));
    if (logErr) console.error(`${LOG} reconciliation_log insert 오류(비치명): ${logErr.message}`);

    console.log(`${LOG} matched payment=${paymentId} ← raw=${raw.id} amount=${payment.amount} approved_at=${raw.approved_at}`);

    // ── 5. D4 cue.paid SoT emit parity ──────────────────────────────────────────
    //   본 훅은 annotate-on-existing(D2) — payment 는 [수납] 저장이 이미 생성했고, 그 '생성 표면'이
    //   cue.paid SoT emit 의 소유자다(dopamine-origin 첫 패키지결제 → PaymentDialog 가 DOPAMINE_CALLBACK
    //   'paid' 발화). 역방향 매칭은 그 payment 에 VAN 링크 메타(reconciled_at/external_*/accounting_date)만
    //   덧씌울 뿐 '결제됨(paid)' 의미를 새로 만들지 않는다 → 신규 paid 이벤트 없음(재발화 시 중복).
    //   ★forward auto_matched 매처(redpay-reconcile)도 paid 를 발화하지 않음 → "auto-match 과 동일 emit" =
    //     발화 부재의 parity. 또한 DOPAMINE_CALLBACK 'paid' 는 package_id/package_name(첫 패키지결제) 계약이라
    //     payments(single/checkin) 대상인 본 훅에서 유효한 callback 을 만들 수 없다(fabrication 금지).
    //   ∴ 여기서 emit 을 재발화하지 않는다. linked_dopamine 은 supervisor 매출정합·관측용 플래그(발화 아님).
    let linkedDopamine = false;
    if (pay.check_in_id) {
      try {
        const { data: ci } = await admin
          .from("check_ins").select("reservation_id").eq("id", pay.check_in_id).maybeSingle();
        if (ci?.reservation_id) {
          const { data: rsv } = await admin
            .from("reservations").select("source_system, external_id").eq("id", ci.reservation_id).maybeSingle();
          linkedDopamine = rsv?.source_system === "dopamine" && !!rsv?.external_id;
        }
      } catch (e) {
        console.warn(`${LOG} linked-reservation 조회 오류(비치명):`, e instanceof Error ? e.message : String(e));
      }
    }

    return json(200, {
      ok: true,
      matched: true,
      payment_id: payment.id,
      raw_id: raw.id,
      accounting_date: (payUpdate as { accounting_date?: string }).accounting_date ?? null,
      linked_dopamine: linkedDopamine, // 관측 전용(D4 parity=annotate-on-existing, 재발화 없음).
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} 처리 예외 → 500: ${msg}`);
    return json(500, { ok: false, error: "unexpected_error", message: msg });
  }
});
