// T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST — Edge Function: redpay-unreg-digest (풋센터)
//
// 레드페이 미등록 회선(merchant_id/tid) 등록 알람 하루 1회 요약(digest).
//   배경: redpay-webhook unknown 경로가 push 당 즉시 Slack(쿨다운 0) → 재시도 반복 = 스팸
//     (15:52~16:32 동일내용 5회). 등록담당 즉시처리 불가 시 하루 수십회 → 타 알람 묻힘.
//   전환: webhook 는 accumulate 만(redpay_unregistered_line_seen 멱등 증분, 실시간 Slack 억제),
//     본 EF 가 하루 1회(cron 09:00 KST) 미등록 회선을 모아 요약 1건 발송.
//
// ── 동작 ──────────────────────────────────────────────────────────────────────
//   1) redpay_unregistered_line_seen 에서 resolved_at IS NULL(아직 미등록) 행 조회.
//   2) 각 행을 registry(redpay_terminal_registry, domain=foot, active) 재대조 —
//      이미 등록된 merchant_id 는 resolved_at=now 스탬프 → 이번+이후 digest 자동 제외(전이 반영).
//   3) 남은 미등록 회선 ≥1 → Slack 요약 1건 발송(AC5: 하나라도 있으면 반드시 발송).
//      0건 → no-send(빈 digest 금지). 발송 행은 last_digest_at 갱신.
//   각 행: `가맹점 <merchant_id> / 회선 <tid> (첫 감지 M/D, 누적 N건)`.
//   4) AC7: 첫 감지 ≥3일 & 여전히 미등록 회선 → 일일 요약과 별개 '장기 미처리 에스컬레이션' 1건
//      (digest 1회/일 → 회선당 1회/일 상한 자연 충족).
//
// ── 격리(AC5 무영향) ───────────────────────────────────────────────────────────
//   본 EF 는 redpay_unregistered_line_seen(신규) + redpay_terminal_registry(read-only) 만 접촉.
//   payments / redpay_raw_transactions / 정산 뷰 / 기존 알람 경로 완전 무접촉.
//
// ── 환경 변수 ─────────────────────────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — 자동 주입
//   INTERNAL_CRON_SECRET   — cron(trigger_redpay_unreg_digest) 인증 헤더 X-Internal-Cron
//   REDPAY_ALERT_CHANNEL   — 미등록 회선 요약 Slack 채널(비면 로그만)
//   REDPAY_SLACK_BOT_TOKEN — 장쳰봇 토큰

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  buildDigestText,
  buildEscalationText,
  partitionByRegistry,
  selectLongUnprocessed,
  type UnregRow,
} from "./digest-lib.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("CRM_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_SECRET      = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
const REDPAY_ALERT_CHANNEL      = Deno.env.get("REDPAY_ALERT_CHANNEL") ?? "";
const REDPAY_SLACK_BOT_TOKEN    = Deno.env.get("REDPAY_SLACK_BOT_TOKEN") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const LOG = "[redpay-unreg-digest][foot]";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-internal-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ── Slack 발송 (redpay-webhook/reconcile 와 동일 구현) ──────────────────────────
async function sendSlackMessage(channel: string, text: string, token: string): Promise<boolean> {
  if (!channel || !token) {
    console.warn(`${LOG}[SLACK] 채널/토큰 미설정 → 로그만: ${text}`);
    return false;
  }
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const data = await res.json() as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error(`${LOG}[SLACK] 발송 실패: ${data.error} (channel=${channel})`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${LOG}[SLACK] 발송 예외: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  // 인증: cron(X-Internal-Cron) 또는 service_role.
  const cronHeader = req.headers.get("x-internal-cron");
  const authHeader = req.headers.get("authorization");
  const isInternalCron = INTERNAL_CRON_SECRET !== "" && cronHeader === INTERNAL_CRON_SECRET;
  const isServiceRole  = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (!isInternalCron && !isServiceRole) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  // 1) 미등록(resolved_at NULL) 회선 조회.
  const { data: rowsRaw, error: qErr } = await supabase
    .from("redpay_unregistered_line_seen")
    .select("id, merchant_id, merchant_name, tid, first_seen_at, hit_count")
    .is("resolved_at", null)
    .order("first_seen_at", { ascending: true });
  if (qErr) {
    console.error(`${LOG} 미등록 회선 조회 실패: ${qErr.message}`);
    return json(500, { ok: false, error: "query_failed", detail: qErr.message });
  }
  const rows = (rowsRaw ?? []) as UnregRow[];

  // 2) registry 재대조 — 등록 전이(resolved) 스탬프. 조회 실패 시 전이판정 생략(fail-safe: 전량 미등록 취급 = 유실 0).
  const { data: regRows, error: regErr } = await supabase
    .from("redpay_terminal_registry")
    .select("merchant_id")
    .eq("domain", "foot")
    .eq("active", true);
  const activeSet = new Set<string>();
  if (regErr) {
    console.warn(`${LOG} registry 조회 실패 → 전이판정 생략(전량 미등록 취급): ${regErr.message}`);
  } else {
    for (const r of (regRows ?? []) as { merchant_id: string | null }[]) {
      if (r.merchant_id) activeSet.add(r.merchant_id.trim());
    }
  }

  const nowIso = new Date().toISOString();
  // 미등록→등록 전이 분리(순수 로직, digest-lib). AC5: activeSet 비어도 전량 stillUnreg → 유실 0.
  const { stillUnreg, resolvedIds } = partitionByRegistry(rows, activeSet);

  // 전이분 resolved 스탬프(best-effort — 실패해도 발송은 진행).
  if (resolvedIds.length > 0) {
    const { error: rErr } = await supabase
      .from("redpay_unregistered_line_seen")
      .update({ resolved_at: nowIso, updated_at: nowIso })
      .in("id", resolvedIds);
    if (rErr) console.warn(`${LOG} resolved 스탬프 실패(무해): ${rErr.message}`);
    else console.log(`${LOG} 등록 전이 ${resolvedIds.length}건 resolved 처리(digest 제외).`);
  }

  // 3) 미등록 0건 → no-send(빈 digest 금지).
  if (stillUnreg.length === 0) {
    console.log(`${LOG} 미등록 회선 0건 → digest 미발송(정상). resolved_this_run=${resolvedIds.length}.`);
    return json(200, { ok: true, sent: false, unregistered: 0, resolved: resolvedIds.length });
  }

  // 요약 1건 조립(순수 로직, digest-lib).
  const nowKST = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const text = buildDigestText(stillUnreg, nowKST);

  const sent = await sendSlackMessage(REDPAY_ALERT_CHANNEL, text, REDPAY_SLACK_BOT_TOKEN);

  // 발송 성공 시 last_digest_at 갱신(관측). 미발송(채널 미설정)은 로그만 — 상태 오염 없음.
  if (sent) {
    const { error: uErr } = await supabase
      .from("redpay_unregistered_line_seen")
      .update({ last_digest_at: nowIso, updated_at: nowIso })
      .in("id", stillUnreg.map((r) => r.id));
    if (uErr) console.warn(`${LOG} last_digest_at 갱신 실패(무해): ${uErr.message}`);
  }

  // AC7(MSG-76a9): 3일+ 장기 미처리 회선 → 일일 요약과 별개 에스컬레이션 1건.
  //   digest 가 하루 1회(cron) → 회선당 1회/일 상한 자연 충족. 미등록(stillUnreg) 부분집합만 대상.
  const nowMs = Date.now();
  const longRows = selectLongUnprocessed(stillUnreg, nowMs);
  let escalationSent = false;
  if (longRows.length > 0) {
    const escText = buildEscalationText(longRows, nowKST, nowMs);
    escalationSent = await sendSlackMessage(REDPAY_ALERT_CHANNEL, escText, REDPAY_SLACK_BOT_TOKEN);
    console.log(`${LOG} AC7 장기 미처리 ${longRows.length}건 에스컬레이션 slack_sent=${escalationSent}.`);
  }

  console.log(
    `${LOG} digest 처리 — 미등록 ${stillUnreg.length}건, 전이 resolved ${resolvedIds.length}건, `
      + `장기미처리 ${longRows.length}건, slack_sent=${sent}, escalation_sent=${escalationSent}.`,
  );
  return json(200, {
    ok: true,
    sent,
    unregistered: stillUnreg.length,
    resolved: resolvedIds.length,
    long_unprocessed: longRows.length,
    escalation_sent: escalationSent,
  });
});
