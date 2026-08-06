// T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN — 공유 발송 모듈
//
// 상담대기방 Slack 발송의 단일 delivery 로직. 호출자:
//   (a) send-consult-notify EF — [확정] 직후 best-effort 인라인 발송(낮은 지연·정상 채널 즉시 delivered).
//   (b) consult-notify-dispatch EF — pg_cron worker 가 재시도로 호출.
// 둘 다 이 함수를 통해 발송 → 발송/분류/상태전이 로직 SSOT(중복 방지).
//
// PHI 가드(dev-foot verify): outbox.payload 에 환자 성명 미저장. 이 함수가 발송시점에 check_ins.customer_name /
//   staff.slack_user_id 를 server-authoritative 로 해소 → DLQ(장기 잔존)에 환자 신원 미축적. §16-3 마스킹 N/A-by-design.
//
// VG3 멱등: 종결(delivered/duplicate/failed·dlq) 행 재발송 금지. 발송 성공 시 delivered 마킹 + check_ins 'sent' 승격.
// VG5 종단분류: channel-gone(channel_not_found/not_in_channel/is_archived 등)=terminal(즉시 DLQ, 무한재시도 금지),
//   transient(network/5xx/rate_limited/timeout)=retry. attempts>=MAX_ATTEMPTS 소진 시 terminal.
// INV-1 RED LINE: consultant_id/assigned_consultant_id write 0. consult_notify_* 컬럼만.

export const MAX_ATTEMPTS = 7;

// 채널 소멸/봇 접근상실 = self-heal 불가 → terminal (ops 채널 재배선 필요). (VG5 discriminator)
export const SLACK_TERMINAL_ERRORS = [
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "channel_is_archived",
  "account_inactive",
  "token_revoked",
  "invalid_auth",
  "no_permission",
  "restricted_action",
];

export function classifySlackError(err: string | undefined): "transient" | "terminal" {
  const e = (err ?? "").trim();
  return SLACK_TERMINAL_ERRORS.includes(e) ? "terminal" : "transient";
}

// 6명 실장 ↔ Slack ID 매핑 (send-consult-notify SILJANG_SLACK_MAP 동일 표 — 변경 시 양쪽 동기화).
export const SILJANG_SLACK_MAP: Record<string, string> = {
  "엄경은": "U0B4JFD5Z6V",
  "송지현": "U0B4BSU84E9",
  "정연주": "U0B49P7JB3P",
  "강경민": "U0BFYC35B0X",
  "김지윤": "U0B902NG8JF",
  "김주연": "U0ATDB587PV",
  "최현희": "U0BKRDWDG9Z",
  "진이서": "U0BM25FTBFZ",
  "송민근": "U0BMKHRLCJV",
};

export function nameKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s*실장\s*$/u, "").trim();
}

async function sendSlackMessage(
  channel: string,
  text: string,
  token: string,
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const data = await res.json() as { ok: boolean; error?: string; ts?: string };
    if (!data.ok) return { ok: false, error: data.error };
    return { ok: true, ts: data.ts };
  } catch (err) {
    // network 예외 → transient 취급
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// deno-lint-ignore no-explicit-any
type SB = any;

interface OutboxRow {
  id: string;
  event_id: string;
  check_in_id: string;
  clinic_id: string;
  channel: string;
  inflow: string | null;
  consultant_id: string | null;
  status: string;
  attempts: number;
  dlq: boolean;
}

export interface DeliverResult {
  delivered: boolean;
  skipped?: boolean;
  terminal?: boolean;
  error?: string;
  reason?: string;
}

/**
 * outbox 1행을 상담대기방으로 발송 + 상태전이. 멱등(VG3) · 분류(VG5) · PHI-safe(발송시점 성명해소).
 * 발송실패는 예외를 던지지 않고 결과 객체로 반환(호출자 [확정] 성공 전파 금지 — decouple 경계).
 */
export async function deliverConsultNotify(
  supabase: SB,
  row: OutboxRow,
  slackToken: string,
): Promise<DeliverResult> {
  const nowIso = new Date().toISOString();

  // VG3: 이미 종결된 건 재발송 금지 (멱등)
  if (row.dlq || ["delivered", "duplicate", "failed"].includes(row.status)) {
    return { delivered: row.status === "delivered", skipped: true, reason: "already_terminal" };
  }

  // 봇 토큰 미설정 → transient(재시도, DLQ 아님). check_ins 상태는 'sending' 유지.
  if (!slackToken) {
    await supabase.from("consult_notify_outbox")
      .update({ status: "pending", error_class: "transient", last_error: "slack_token_not_configured", updated_at: nowIso })
      .eq("id", row.id);
    return { delivered: false, error: "slack_token_not_configured" };
  }

  // ── PHI-safe 성명·mention 해소 (발송시점, server-authoritative) ──
  const { data: ci } = await supabase
    .from("check_ins")
    .select("customer_name, consultant_id, consult_notify_status")
    .eq("id", row.check_in_id)
    .maybeSingle();

  if (!ci) {
    // 원본 배정건 소멸 → 발송 대상 부재 = terminal(재시도 무의미). DLQ.
    await supabase.from("consult_notify_outbox")
      .update({ status: "failed", dlq: true, error_class: "terminal", last_error: "check_in_gone", updated_at: nowIso })
      .eq("id", row.id);
    return { delivered: false, terminal: true, error: "check_in_gone" };
  }

  const consultantId = (ci.consultant_id as string | null) ?? row.consultant_id;
  let displayName = "담당실장";
  let slackId = "";
  if (consultantId) {
    const { data: st } = await supabase
      .from("staff")
      .select("name, slack_user_id")
      .eq("id", consultantId)
      .maybeSingle();
    const staffRow = (st ?? {}) as { name?: string | null; slack_user_id?: string | null };
    displayName = (staffRow.name ?? "").trim() || "담당실장";
    slackId = (staffRow.slack_user_id ?? "").trim() || SILJANG_SLACK_MAP[nameKey(staffRow.name)] || "";
  }
  const mention = slackId ? `<@${slackId}>` : displayName;
  const customerName = ((ci.customer_name as string | null) ?? "").trim() || "고객";
  const inflow = (row.inflow ?? "").trim() ? `${(row.inflow ?? "").trim()} ` : "";
  const text = `${mention} ${customerName}님 ${inflow}상담 대기중`;

  // ── 발송 ──
  const sent = await sendSlackMessage(row.channel, text, slackToken);

  if (sent.ok) {
    // VG3: delivered 마킹 + check_ins 'sent' 승격 (내 'sending' claim 만).
    await supabase.from("consult_notify_outbox")
      .update({ status: "delivered", delivered_at: nowIso, slack_ts: sent.ts ?? null, last_error: null, error_class: null, updated_at: nowIso })
      .eq("id", row.id);
    await supabase.from("check_ins")
      .update({ consult_notify_status: "sent", consult_notify_sent_at: nowIso, consult_notify_slack_ts: sent.ts ?? null })
      .eq("id", row.check_in_id).eq("clinic_id", row.clinic_id)
      .eq("consult_notify_status", "sending");
    return { delivered: true };
  }

  // ── 발송 실패 → VG5 분류 ──
  const cls = classifySlackError(sent.error);
  const exhausted = row.attempts >= MAX_ATTEMPTS;

  if (cls === "terminal" || exhausted) {
    // terminal(채널 소멸 등) 또는 재시도 소진 → DLQ + VG4 check_ins 'failed' 가시화.
    const reason = cls === "terminal" ? `terminal:${sent.error}` : `retry_exhausted(${row.attempts}) last=${sent.error}`;
    await supabase.from("consult_notify_outbox")
      .update({ status: "failed", dlq: true, error_class: cls, last_error: reason.slice(0, 500), updated_at: nowIso })
      .eq("id", row.id);
    await supabase.from("check_ins")
      .update({ consult_notify_status: "failed" })
      .eq("id", row.check_in_id).eq("clinic_id", row.clinic_id)
      .eq("consult_notify_status", "sending");
    return { delivered: false, terminal: true, error: sent.error };
  }

  // transient(재시도) — worker next_attempt_at(claim 시 backoff 선반영)에 재시도. check_ins 'sending' 유지.
  await supabase.from("consult_notify_outbox")
    .update({ status: "pending", error_class: "transient", last_error: `transient:${sent.error}`.slice(0, 500), updated_at: nowIso })
    .eq("id", row.id);
  return { delivered: false, error: sent.error };
}
