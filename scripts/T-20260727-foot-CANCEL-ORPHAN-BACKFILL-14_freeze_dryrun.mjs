/**
 * T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14 — FREEZE + DRY-RUN + 판정근거 스냅샷 (WRITE 0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-CRM Data-Correction Backfill SOP 봉투 — 풋 취소 orphan "14건" canonical
 * re-enqueue 백필의 READ-ONLY prep(freeze/dry-run/판정스냅샷). apply 는 별도 게이트
 * (recv-live-flip applied=true 실관측 + DA CONSULT §S2.4 + 박민지 comp-gate) 통과 후에만.
 *
 *  ★ 이 스크립트는 절대 write 하지 않는다. 하는 일:
 *    (1) live gate 관측: dopamine_callback_config.mode (foot dispatch 측).
 *    (2) freeze-set 도출: 버그경로 지문 교집합
 *          = status='cancelled' ∧ cancelled_at IS NULL ∧ source_system='dopamine'
 *            ∧ external_id NOT NULL  (pre-flip RPC 취소 → composite event_id NULL →
 *            enqueue 미발화 가설의 지문). 단일 count 기준 대상선정 금지.
 *    (3) outbox 실재 교차검증: 도출셋 각 reservation_id 에 cancelled outbox 행 존재 여부.
 *          → TRUE ORPHAN = 지문 매치 ∧ outbox 행 부재.
 *    (4) 수렴 관측: foot cancelled outbox 의 status 분포 + status='sent'(applied=true) 존재 여부.
 *          → foot cancel 이 receiver 에서 live apply 되는지(수렴 가능성) 관측.
 *    (5) 대상 고객(reservation_id 357be722…) 대상행·outbox 행 지목. (PHI §4.3: UUID-PK-only)
 *    (6) 판정근거 스냅샷 출력.
 *
 *  인증컨텍스트: service_role (DB 전건 read). 무영속(write 0) — INSERT/UPDATE/DELETE 미호출.
 *  작성: dev-foot / ticket T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14
 */
import { readFileSync } from "node:fs";

function loadEnv(p) {
  const o = {};
  try {
    for (const l of readFileSync(p, "utf8").split("\n")) {
      const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      o[m[1]] = v;
    }
  } catch {}
  return o;
}

const e = loadEnv(".env.local");
const SB = e.VITE_SUPABASE_URL || "https://rxlomoozakkjesdqjtvd.supabase.co";
const SR = e.SUPABASE_SERVICE_ROLE_KEY;
if (!SR) { console.error("SUPABASE_SERVICE_ROLE_KEY 미설정"); process.exit(2); }
const H = { apikey: SR, Authorization: `Bearer ${SR}` };

async function q(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
async function count(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
  return r.headers.get("content-range");
}

const TARGET_RESV = "357be722-291c-42be-b85d-150a7aef4efb"; // 대상 고객 reservation (PHI §4.3: UUID-PK-only)

(async () => {
  console.log("═══ T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14 · FREEZE/DRY-RUN (WRITE 0) ═══");
  console.log("SB =", SB, "· ts(host) =", new Date().toISOString());

  // (1) live gate — foot dispatch 측 mode
  const cfg = await q("dopamine_callback_config?select=*");
  console.log("\n[1] dopamine_callback_config (foot dispatch mode):", JSON.stringify(cfg));

  // (2) freeze-set 지문 도출
  const cand = await q(
    "reservations?select=id,status,cancelled_at,source_system,external_id,created_at,updated_at" +
    "&status=eq.cancelled&cancelled_at=is.null&source_system=eq.dopamine&external_id=not.is.null&order=updated_at.asc"
  );
  console.log(`\n[2] freeze 지문(cancelled ∧ cancelled_at NULL ∧ dopamine ∧ external_id) count = ${cand.length}`);

  // (3) outbox 교차검증
  const ids = cand.map((r) => r.id);
  let outbox = [];
  if (ids.length) {
    const inList = ids.map((i) => `"${i}"`).join(",");
    outbox = await q(`dopamine_callback_outbox?event_type=eq.cancelled&reservation_id=in.(${inList})&select=reservation_id,status,event_id,sent_at`);
  }
  const haveSet = new Set(outbox.map((o) => o.reservation_id));
  const orphans = cand.filter((r) => !haveSet.has(r.id));
  console.log(`[3] 지문셋 중 cancelled outbox 행 존재 = ${haveSet.size} / ${cand.length}`);
  console.log(`    ⇒ TRUE ORPHAN (지문 ∧ outbox 부재) = ${orphans.length}`);
  for (const r of orphans) {
    console.log(`      ORPHAN resv=${r.id} | updated=${r.updated_at} | ext=${r.external_id}`);
  }

  // (4) 수렴 관측 — status 분포 + applied=true 존재 여부
  console.log("\n[4] foot cancelled outbox status 분포:");
  for (const st of ["pending", "processing", "sent", "duplicate", "failed"]) {
    console.log(`      ${st.padEnd(11)} ${await count(`dopamine_callback_outbox?event_type=eq.cancelled&status=eq.${st}&select=id`)}`);
  }
  const sent = await q("dopamine_callback_outbox?event_type=eq.cancelled&status=eq.sent&select=id,event_id,sent_at&limit=3");
  console.log(`    status='sent'(applied=true) 표본 = ${JSON.stringify(sent)}  ⇒ foot cancel live-apply ${sent.length ? "관측됨" : "전무(all-time)"}`);

  // (5) 대상 고객 (PHI §4.3: reservation_id 로만 조회/표기)
  const tgt = await q(`reservations?select=id,status,cancelled_at,source_system,external_id&id=eq.${TARGET_RESV}`);
  console.log("\n[5] 대상 예약행(resv=" + TARGET_RESV + "):", JSON.stringify(tgt));
  if (tgt.length) {
    const ao = await q(`dopamine_callback_outbox?reservation_id=eq.${tgt[0].id}&select=id,event_type,event_id,status,sent_at,payload`);
    console.log("    대상 cancelled outbox 행:", JSON.stringify(ao));
  }

  // (6) 판정근거 스냅샷
  console.log("\n[6] ═══ 판정근거 스냅샷 ═══");
  console.log(`    · freeze 지문 count             = ${cand.length}`);
  console.log(`    · TRUE ORPHAN(outbox 부재)      = ${orphans.length}   ← re-enqueue 대상`);
  console.log(`    · 이미 enqueue 됨(outbox 존재)  = ${haveSet.size}`);
  console.log(`    · foot cancel applied=true 이력 = ${sent.length ? "있음" : "전무 (전량 duplicate/applied=false = receiver SUPPRESS)"}`);
  console.log(`    · dispatch config.mode          = ${cfg[0]?.mode}`);
  console.log("\n    결론:", orphans.length === 0
    ? "re-enqueue 대상 0건 — 티켓 premise(14 orphan 미발화) 현 prod 상태에서 미재현. apply 금지."
    : `re-enqueue 후보 ${orphans.length}건 — 단, applied=true 수렴 경로 확인(recv SUPPRESS 해소) 선행 필수.`);
  console.log("    ⚠ WRITE 0 — 본 스크립트는 어떤 write 도 수행하지 않았다.");
})().catch((err) => { console.error("FATAL:", err.message); process.exit(1); });
