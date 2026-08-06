/**
 * T-20260807-foot-CANCEL-ORPHAN-CENSUS-C — STAGE 1 READ-ONLY CENSUS (WRITE 0 to DB)
 * ─────────────────────────────────────────────────────────────────────────────
 * planner NEW-TASK(MSG-20260807-054225-blnq) 지시. freeze-36
 * (727c2a25 scripts/T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14_freeze_dryrun.mjs)
 * 대상 36행 중 dopamine-linked(source=dopamine ∧ external_id NOT NULL) 부분집합을
 * 식별하고, dev-dopamine 이 stage 2 (도파민 READ-ONLY probe) 에서 읽을 최소 아티팩트를
 * 산출한다. A(부모 CLOSE) vs B(dev-dopamine 재발번) 분기용 단일 census.
 *
 *  ★ DB WRITE 0 — DDL/DML/outbox/rail 무접점. 백필·재발화 금지(부모 REFUTED/DEAD).
 *    이 스크립트는 오직 service_role READ 만 수행하고, 결과를 stdout(JSON) 으로 낸다.
 *    파일 아티팩트 기록은 호출자(dev-foot)가 stdout 을 handoff 로 옮겨 담당.
 *
 *  freeze-36 지문(정의상 이미 dopamine-linked 전건):
 *    status='cancelled' ∧ cancelled_at IS NULL ∧ source_system='dopamine'
 *      ∧ external_id NOT NULL
 *    → 지문 자체가 source=dopamine ∧ external_id NOT NULL 을 포함하므로
 *      freeze-36 = dopamine-linked 부분집합 (완전 일치). census 로 실측 재확인.
 *
 *  PHI 최소화(§4.3): crm_reservation_id(UUID-PK) · external_id(도파민 link key) ·
 *    cancelled_at · status 만. 환자 식별정보(이름/연락처/차트/payload) 미포함.
 *
 *  작성: dev-foot / ticket T-20260807-foot-CANCEL-ORPHAN-CENSUS-C (stage 1)
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

(async () => {
  // freeze-36 지문 재도출 (updated_at = cancelled_at NULL 인 pre-flip 취소의 취소시각 proxy)
  const cand = await q(
    "reservations?select=id,status,cancelled_at,source_system,external_id,updated_at" +
    "&status=eq.cancelled&cancelled_at=is.null&source_system=eq.dopamine&external_id=not.is.null" +
    "&order=updated_at.asc"
  );

  // dopamine-linked 부분집합 = source=dopamine ∧ external_id NOT NULL (지문상 전건이지만 명시 재검)
  const dopa = cand.filter((r) => r.source_system === "dopamine" && r.external_id != null && r.external_id !== "");
  const nonDopa = cand.filter((r) => !(r.source_system === "dopamine" && r.external_id != null && r.external_id !== ""));

  const rows = dopa.map((r) => ({
    crm_reservation_id: r.id,       // UUID-PK (PHI §4.3 안전)
    external_id: r.external_id,     // 도파민 link key
    cancelled_at: r.cancelled_at,   // NULL (pre-flip RPC 취소경로 지문)
    status: r.status,               // 'cancelled'
    updated_at_proxy: r.updated_at, // cancelled_at NULL 이므로 취소시각 proxy 참고용
  }));

  const out = {
    ticket: "T-20260807-foot-CANCEL-ORPHAN-CENSUS-C",
    stage: 1,
    kind: "READ-ONLY census (DB WRITE 0)",
    db: "rxlomoozakkjesdqjtvd (foot prod)",
    auth_context: "service_role (DB 전건 read)",
    freeze_source: "727c2a25 scripts/T-20260727-foot-CANCEL-ORPHAN-BACKFILL-14_freeze_dryrun.mjs",
    fingerprint: "status='cancelled' ∧ cancelled_at IS NULL ∧ source_system='dopamine' ∧ external_id NOT NULL",
    freeze_count: cand.length,
    dopamine_linked_count: dopa.length,
    non_dopamine_count: nonDopa.length,
    phi_scope: "crm_reservation_id(UUID-PK) · external_id(도파민 link key) · cancelled_at · status · updated_at(proxy) — 환자 식별정보 제외",
    rows,
  };
  console.log(JSON.stringify(out, null, 2));
  console.error(`[census] freeze=${cand.length} · dopamine_linked=${dopa.length} · non_dopamine=${nonDopa.length}`);
})().catch((err) => { console.error("FATAL:", err.message); process.exit(1); });
