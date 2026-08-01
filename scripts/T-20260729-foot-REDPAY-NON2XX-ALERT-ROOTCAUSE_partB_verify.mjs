#!/usr/bin/env node
/**
 * T-20260729-foot-REDPAY-NON2XX-ALERT-ROOTCAUSE — Part B AC-B4 발송 실측 검증 probe
 *
 * 목적: 배포된 redpay-webhook EF 에 의도적으로 non-2xx 를 유발(잘못된 서명 → 401)해
 *       상시 슬랙 알림이 실제로 발송되는지 실측 검증.
 *
 * 방식: X-WEBHOOK-SIGNATURE 를 고의로 틀린 값으로 넣어 POST → EF 가 401 invalid_signature 반환.
 *       → choke point 가 non-2xx 감지 → REDPAY_ALERT_CHANNEL 로 장쳰봇 알림 발송.
 *       (결제 데이터 무영향: 서명검증 실패로 어떤 적재도 발생하지 않음 = 안전한 유발.)
 *
 * ★배포 선행: 본 probe 는 이 티켓 배포(EF live) 이후 실행해야 유효. 배포 전 구버전은 401 은 반환하나
 *   알림 코드가 없어 슬랙 미발송(정상). 배포 후 재실행 → 슬랙 채널에서 알림 수신 육안 확인.
 * ★dedup: 동일 401 은 창(기본 60s) 내 1건만 발송. 반복 검증 시 60s 간격 또는 서로 다른 원인 사용.
 *
 * 실행: SUPABASE_URL 은 .env.redpay-foot 에서 로드. write/DB 없음(순수 HTTP POST).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch {}
  return out;
}
const env = { ...loadEnvFile(join(homedir(), ".env.redpay")), ...loadEnvFile(join(homedir(), ".env.redpay-foot")) };
const cfg = (k, d = "") => (process.env[k] ?? env[k] ?? d).trim();
const URL = cfg("SUPABASE_URL", "https://rxlomoozakkjesdqjtvd.supabase.co");
const EF = `${URL}/functions/v1/redpay-webhook`;

// 결제 유발 안전성: 서명검증 실패로 어떤 적재도 발생하지 않는 최소 payload.
const payload = JSON.stringify({
  event_id: `ACB4-VERIFY-${Date.now()}`,
  event_type: "payment.approved",
  occurred_at: new Date().toISOString(),
  data: { merchant_id: "AC-B4-TEST", tid: "AC-B4-TEST-TID", trxid: "AC-B4-TEST-TRX", amount: 1 },
});

console.log("═══════════════════════════════════════════════════════════════");
console.log("Part B AC-B4 — non-2xx 유발 → 슬랙 알림 발송 실측 검증");
console.log("EF:", EF);
console.log("방식: 고의로 틀린 X-WEBHOOK-SIGNATURE → 401 invalid_signature 기대");
console.log("═══════════════════════════════════════════════════════════════");

const res = await fetch(EF, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-WEBHOOK-SIGNATURE": "deadbeef_intentionally_invalid_signature_for_acb4",
  },
  body: payload,
});
const text = await res.text();
console.log(`\n응답 status = ${res.status}`);
console.log(`응답 body   = ${text}`);

if (res.status === 401) {
  console.log("\n✅ 401 invalid_signature 확인 — 배포된 EF 라면 non-2xx choke point 가 슬랙 알림 발송.");
  console.log("   → REDPAY_ALERT_CHANNEL 슬랙 채널에서 '🚨 [redpay-webhook][foot] non-2xx 응답' 알림 육안 확인.");
  console.log("   (알림 미수신 시: 배포 전이거나 REDPAY_ALERT_CHANNEL/REDPAY_SLACK_BOT_TOKEN env 미설정 점검.)");
} else if (res.status === 200) {
  console.log("\n⚠️ 200 반환 — REDPAY_WEBHOOK_SECRET 미설정(ignored_secret_unset) 가능. 이 경우 서명검증 자체 미수행.");
  console.log("   secret 설정 후 재실행하면 401 유발 가능.");
} else {
  console.log(`\n(status=${res.status}) — 예상과 다름. 응답 body 확인.`);
}
