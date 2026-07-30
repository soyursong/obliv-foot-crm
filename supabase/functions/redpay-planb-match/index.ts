// T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD — Edge Function: redpay-planb-match (풋센터)
//
// 레드페이 플랜B(비대기형 결제) 백그라운드 매칭 + 만료 워커.
//   비대기형 결제: FE(PaymentPlanb route)가 pending_payment 선점(open)을 만들고 화면을 즉시 전환.
//   본 EF 가 cron(pg_cron)으로 주기 실행되며 두 패스를 수행한다:
//     ① EXPIRE  — now() >= expires_at 인 open 선점 → status='expired' (TTL 만료, 수기입력 폴백).
//     ② MATCH   — 유효 창(now() < expires_at) open 선점을 웹훅 raw(received_at present, approved)와
//                 예상금액으로 매칭 → status='matched', matched_raw_txid/matched_at set.
//
// ── 설계 원칙 (기존 EF 무접촉) ──────────────────────────────────────────────────
//   · redpay-webhook = OBSERVE-only(pending_payment/payments write 미발화, 런타임 가드 有) → 무변경.
//   · redpay-reconcile = raw↔payments 4-tier 매처 → 무변경.
//   · 본 EF 는 pending_payment(선점표) 전용 매칭을 격리 신설 — 두 기존 EF 의 계약을 건드리지 않음.
//
// ── 불변식 (§550 Model A / §789) ───────────────────────────────────────────────
//   · pending_payment 은 payments 를 write 하지 않는다(매출 grain 아님, 예정=선점).
//     실 매출 기록/대사는 기존 payments 파이프(redpay-reconcile)가 계승 — 본 EF 는 pending_payment 만 전이.
//   · 매칭 방향 = redpay_raw_transactions 역참조(matched_raw_txid). payments 신설참조 금지.
//   · TTL 판정은 pending_payment 에 app-set 된 expires_at/locked_until(정책 단일소스=src/lib/redpayPlanbTtl.ts,
//     write-time 적용)을 그대로 비교 — EF 에 5/6 상수 재복제 없음(divergence 0).
//
// ── 매칭 규율 (충돌 안전) ────────────────────────────────────────────────────────
//   · 같은 (clinic_id, expected_amount) open 선점이 2건+ = 모호 → 자동매칭 스킵(만료 후 수기 폴백).
//   · 이미 다른 선점에 matched_raw_txid 로 소비된 raw 는 재사용 금지(1 raw : 1 선점).
//   · 후보 raw = external_status='Y'(승인) + received_at NOT NULL(웹훅 수신분) + amount>0 +
//               created_at <= received_at < expires_at(자동연결 유효창).
//
// ── 환경 변수 ──────────────────────────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — 자동 주입(service_role = RLS 바이패스 매칭 워커)
//   INTERNAL_CRON_SECRET  — X-Internal-Cron 헤더 인증(pg_cron 호출). service_role bearer 도 허용.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_SECRET      = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const LOG = "[redpay-planb-match][foot]";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

interface OpenPreempt {
  id: string;
  clinic_id: string;
  expected_amount: number;
  created_at: string;
  expires_at: string;
}
interface RawTx {
  id: string;
  clinic_id: string | null;
  amount: number | null;
  received_at: string | null;
}

// ── ① EXPIRE 패스 — now() >= expires_at 인 open → expired ──────────────────────
async function expirePass(nowIso: string): Promise<number> {
  const { data, error } = await supabase
    .from("pending_payment")
    .update({ status: "expired", updated_at: nowIso })
    .eq("status", "open")
    .lte("expires_at", nowIso)
    .select("id");
  if (error) {
    console.error(`${LOG}[EXPIRE] update 오류: ${error.message}`);
    throw error;
  }
  const n = data?.length ?? 0;
  if (n > 0) console.log(`${LOG}[EXPIRE] ${n}건 open→expired (TTL 만료, 수기 폴백).`);
  return n;
}

// ── ② MATCH 패스 — 유효창 open 선점을 웹훅 raw 와 예상금액 매칭 ──────────────────
//   ★ 매칭 대상은 status='open' 만(아래 .eq("status","open")). 따라서 수기입력 폴백 진입으로 제외된
//     'manual_override'(T-20260730-...-MANUALPAY-PREEMPT-EXCLUDE) 및 expired/failed/cancelled/matched 는
//     기존 필터로 자동 제외 → 지연 도착 웹훅(레드페이 재전송)의 자동연결 이중기록 창이 봉인됨(AC2, EF 로직 무변경).
async function matchPass(nowIso: string): Promise<{ matched: number; skippedAmbiguous: number }> {
  // 유효창 open 선점(만료 패스 이후 남은 것 = now() < expires_at).
  const { data: opensRaw, error: e1 } = await supabase
    .from("pending_payment")
    .select("id, clinic_id, expected_amount, created_at, expires_at")
    .eq("status", "open")
    .gt("expires_at", nowIso);
  if (e1) throw e1;
  const opens = (opensRaw ?? []) as OpenPreempt[];
  if (opens.length === 0) return { matched: 0, skippedAmbiguous: 0 };

  // (clinic_id, expected_amount) 그룹핑 — 2건+ 는 모호(자동매칭 제외).
  const groupKey = (clinicId: string, amount: number) => `${clinicId}::${amount}`;
  const groups = new Map<string, OpenPreempt[]>();
  for (const o of opens) {
    const k = groupKey(o.clinic_id, o.expected_amount);
    const bucket = groups.get(k);
    if (bucket) bucket.push(o);
    else groups.set(k, [o]);
  }

  // 이미 소비된 raw(다른 선점의 matched_raw_txid) 집합 — 재사용 금지.
  const { data: usedRaw, error: e2 } = await supabase
    .from("pending_payment")
    .select("matched_raw_txid")
    .not("matched_raw_txid", "is", null);
  if (e2) throw e2;
  const usedTxids = new Set<string>((usedRaw ?? []).map((r) => r.matched_raw_txid as string));

  // 후보 raw — 승인(Y) + 웹훅 수신(received_at NOT NULL) + amount>0. 금액별 후보 조회 최소화 위해 일괄 로드.
  const { data: rawsRaw, error: e3 } = await supabase
    .from("redpay_raw_transactions")
    .select("id, clinic_id, amount, received_at")
    .eq("external_status", "Y")
    .not("received_at", "is", null)
    .gt("amount", 0);
  if (e3) throw e3;
  const raws = (rawsRaw ?? []) as RawTx[];

  let matched = 0;
  let skippedAmbiguous = 0;
  const localUsed = new Set<string>(); // 이 실행 내 raw 이중매칭 방지

  for (const [, list] of groups) {
    if (list.length > 1) { skippedAmbiguous += list.length; continue; } // 모호 그룹 스킵
    const o = list[0];
    // 후보 raw: 같은 clinic + 동일 금액 + created_at <= received_at < expires_at + 미소비.
    const candidates = raws
      .filter((r) =>
        r.clinic_id === o.clinic_id &&
        Number(r.amount) === Number(o.expected_amount) &&
        r.received_at != null &&
        r.received_at >= o.created_at &&
        r.received_at < o.expires_at &&
        !usedTxids.has(r.id) &&
        !localUsed.has(r.id),
      )
      .sort((a, b) => (a.received_at! < b.received_at! ? -1 : 1)); // 가장 이른 수신분 우선

    if (candidates.length === 0) continue;
    const raw = candidates[0];

    // matched 전이 — open 조건 재확인(동시성 가드: WHERE status='open').
    const { data: upd, error: eUpd } = await supabase
      .from("pending_payment")
      .update({ status: "matched", matched_raw_txid: raw.id, matched_at: nowIso, updated_at: nowIso })
      .eq("id", o.id)
      .eq("status", "open")
      .select("id");
    if (eUpd) {
      console.error(`${LOG}[MATCH] 전이 오류(id=${o.id}): ${eUpd.message}`);
      continue;
    }
    if ((upd?.length ?? 0) > 0) {
      matched += 1;
      localUsed.add(raw.id);
      console.log(`${LOG}[MATCH] 선점 ${o.id} ← raw ${raw.id} (amount=${o.expected_amount}) matched.`);
    }
  }
  return { matched, skippedAmbiguous };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  // ── 인증 — X-Internal-Cron(pg_cron) 또는 service_role bearer(redpay-reconcile 동형) ──
  const cronHeader = req.headers.get("x-internal-cron");
  const authHeader = req.headers.get("authorization");
  const isInternalCron = INTERNAL_CRON_SECRET !== "" && cronHeader === INTERNAL_CRON_SECRET;
  const isServiceRole  = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (!isInternalCron && !isServiceRole) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const nowIso = new Date().toISOString();
  try {
    const expired = await expirePass(nowIso);
    const { matched, skippedAmbiguous } = await matchPass(nowIso);
    return json(200, {
      ok: true,
      run_at: nowIso,
      expired,
      matched,
      skipped_ambiguous: skippedAmbiguous,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} 처리 예외 → 500: ${msg}`);
    return json(500, { ok: false, error: "unexpected_error", message: msg });
  }
});
