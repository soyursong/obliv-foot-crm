#!/usr/bin/env node
// scripts/redpay_envshadow_valuecheck.mjs
// T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK — 두 실행주체 런타임 실 로드값 1:1 대조 (env-shadow 직접 판정).
//
// 총괄(최필경, C0ATE5P6JTH) req1: 코드 대조가 '동일'이어도, 허용목록을 읽는 두 실행주체(poller[env∪registry] ·
//   watchdog[registry membership])가 별도 배포·기동되어 한쪽이 구 env 를 물 수 있음(env-shadow). 각 주체가
//   --introspect-whitelist 로 "지금 실제 로드한" 지문(count+SHA256+정렬목록)을 출력 → 본 probe 가 1:1 대조.
//
//   AC-2  일치 → env-shadow 없음 직접 증거 / 불일치 → env-shadow 직접 증거(어느 쪽 구 env 특정 + diff TID).
//   AC-3  ENVSHADOW-REGUNION-FIX(env∪DB union) 적용 후 두 주체 실값 수렴 여부 = fix 실효 evidence.
//
//   read-only: 각 주체를 introspection 모드로만 기동(폴링/적재/대사/알림 미진입). DB/registry/env 무변경.
//   실행: node scripts/redpay_envshadow_valuecheck.mjs [--json out.json] [--ef]  (--ef: 웹훅 EF introspection 포함)

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json") ? ARGS[ARGS.indexOf("--json") + 1] : null;
const WITH_EF = ARGS.includes("--ef");

// ── 실행주체를 introspection 모드로 기동 → stdout 에서 지문 JSON 라인 파싱 ────────────
function introspect(scriptRelPath, subjectLabel) {
  const scriptPath = join(__dir, scriptRelPath);
  const r = spawnSync("node", [scriptPath, "--introspect-whitelist"], {
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  // stdout 에는 env 로드/기동 로그가 섞임 → subject 키를 가진 마지막 JSON 라인만 추출.
  let fp = null;
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === "object" && o.subject) fp = o;
    } catch { /* not the json line */ }
  }
  if (!fp) {
    return { ok: false, subject: subjectLabel, error: `지문 파싱 실패(exit=${r.status})`, raw_tail: out.split(/\r?\n/).slice(-8).join("\n") };
  }
  return { ok: true, ...fp };
}

// ── 웹훅 EF introspection (선택) — authed GET ?introspect=whitelist ─────────────────
function introspectEf() {
  const base = process.env.REDPAY_WEBHOOK_URL
    || (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/redpay-webhook` : null);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) return { ok: false, subject: "webhook-ef", error: "REDPAY_WEBHOOK_URL/SUPABASE_URL 또는 SERVICE_ROLE_KEY 미설정 — EF introspection skip" };
  const r = spawnSync("curl", ["-sS", "-m", "20", "-H", `Authorization: Bearer ${key}`, `${base}?introspect=whitelist`], { encoding: "utf8", env: process.env });
  try {
    const o = JSON.parse(r.stdout ?? "");
    if (o?.ok && o.fingerprint?.subject) return { ok: true, ...o.fingerprint };
    return { ok: false, subject: "webhook-ef", error: `EF 응답 비정상: ${(r.stdout ?? "").slice(0, 200)}` };
  } catch {
    return { ok: false, subject: "webhook-ef", error: `EF 미배포/응답파싱 실패: ${(r.stdout ?? r.stderr ?? "").slice(0, 200)}` };
  }
}

const setDiff = (a, b) => a.filter((x) => !b.includes(x));

// ── 두 지문의 집합 대조 (TID + merchant) ──────────────────────────────────────────
function compare(aFp, bFp) {
  const aTid = aFp.tid_sorted ?? [], bTid = bFp.tid_sorted ?? [];
  const aM = aFp.merchant_sorted ?? [], bM = bFp.merchant_sorted ?? [];
  return {
    tid: {
      match: aFp.tid_sha256 === bFp.tid_sha256,
      a_count: aFp.tid_count, b_count: bFp.tid_count,
      a_only: setDiff(aTid, bTid),   // A 에만 있음
      b_only: setDiff(bTid, aTid),   // B 에만 있음
    },
    merchant: {
      match: aFp.merchant_sha256 === bFp.merchant_sha256,
      a_count: aFp.merchant_count, b_count: bFp.merchant_count,
      a_only: setDiff(aM, bM),
      b_only: setDiff(bM, aM),
    },
  };
}

async function main() {
  console.log("═══ RedPay env-shadow 런타임 실값 대조 (T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK) ═══\n");

  const poller = introspect("redpay_macstudio_poller.mjs", "poller");
  const watchdog = introspect("redpay_terminal_watchdog.mjs", "watchdog");
  const ef = WITH_EF ? introspectEf() : { ok: false, subject: "webhook-ef", error: "skip (--ef 미지정)" };

  for (const [name, fp] of [["poller", poller], ["watchdog", watchdog], ["webhook-ef", ef]]) {
    if (fp.ok) {
      console.log(`[${name}] source(merchant=${fp.merchant_source} tid=${fp.tid_source}) ` +
        `merchant(count=${fp.merchant_count} sha256=${fp.merchant_sha256.slice(0, 16)}) ` +
        `tid(count=${fp.tid_count} sha256=${fp.tid_sha256.slice(0, 16)})`);
    } else {
      console.log(`[${name}] ⚠ ${fp.error}`);
    }
  }
  console.log("");

  if (!poller.ok || !watchdog.ok) {
    console.error("✗ 핵심 쌍(poller/watchdog) 지문 확보 실패 — 대조 불가. 위 오류 확인.");
    const evidence = { generated_at: new Date().toISOString(), poller, watchdog, ef, verdict: "INCONCLUSIVE" };
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(evidence, null, 2));
    process.exit(2);
  }

  // ── AC-2 핵심 쌍: poller(env∪registry) vs watchdog(registry membership) ───────────
  const cmp = compare(poller, watchdog);
  const tidMatch = cmp.tid.match, merMatch = cmp.merchant.match;

  // 방향 해석: watchdog(registry)에만 있고 poller 에 없는 TID = poller 가 구 env stale → silent-drop 위험(위험 방향).
  //           poller 에만 있고 watchdog 에 없는 TID = env-only 잔여(union 상 admit 유지 = 안전 방향, superset).
  const registryTidMissingFromPoller = cmp.tid.b_only;  // watchdog(B) - poller(A)
  const envOnlyExtraInPoller = cmp.tid.a_only;          // poller(A) - watchdog(B)
  const registryMerchantMissingFromPoller = cmp.merchant.b_only;
  const envOverrideMerchantExtra = cmp.merchant.a_only;

  console.log("── AC-2 대조 (poller ↔ watchdog) ──");
  console.log(`  TID       : ${tidMatch ? "일치 ✅" : "불일치 ❌"}  (poller=${cmp.tid.a_count} watchdog=${cmp.tid.b_count})`);
  console.log(`  merchant  : ${merMatch ? "일치 ✅" : "불일치 ❌"}  (poller=${cmp.merchant.a_count} watchdog=${cmp.merchant.b_count})`);
  if (registryTidMissingFromPoller.length)
    console.log(`  ❌ [위험방향] registry(watchdog)에 있으나 poller 가 로드 못한 TID(=구 env stale·silent-drop 위험): ${registryTidMissingFromPoller.join(", ")}`);
  if (envOnlyExtraInPoller.length)
    console.log(`  ⓘ [안전방향] poller 에만(env-only 잔여, union 상 admit 유지): ${envOnlyExtraInPoller.join(", ")}`);
  if (registryMerchantMissingFromPoller.length)
    console.log(`  ❌ [위험방향] registry merchant 인데 poller 미로드: ${registryMerchantMissingFromPoller.join(", ")}`);
  if (envOverrideMerchantExtra.length)
    console.log(`  ⓘ poller merchant env-override 잔여: ${envOverrideMerchantExtra.join(", ")}`);

  // env-shadow 판정
  let envShadowVerdict, staleSide = null, revenueRisk = false;
  if (tidMatch && merMatch) {
    envShadowVerdict = "NO_ENV_SHADOW";  // 실값 완전 일치 = env-shadow 없음 직접 증거
  } else {
    envShadowVerdict = "ENV_SHADOW_DETECTED";
    // 위험 방향(registry TID/merchant 가 poller 에 없음) = poller 가 stale = 매출 silent-drop 위험
    if (registryTidMissingFromPoller.length || registryMerchantMissingFromPoller.length) {
      staleSide = "poller(env stale — registry 항목 미로드 = silent-drop 위험)";
      revenueRisk = true;
    } else {
      // poller superset(env-only 잔여만) = union 으로 admit 유지, silent-drop 아님(위생상 divergence).
      staleSide = "poller(env-only 잔여 superset — union admit 유지, silent-drop 아님)";
      revenueRisk = false;
    }
  }

  console.log(`\n  ▶ env-shadow 판정: ${envShadowVerdict}${staleSide ? ` / stale: ${staleSide}` : ""}`);
  console.log(`  ▶ 매출 silent-drop 위험: ${revenueRisk ? "★있음 (즉시 P0 승격 대상)" : "없음"}`);

  // ── AC-3 REGUNION-FIX 실효 검증: poller ⊇ watchdog(registry) 이면 수렴(silent-drop 봉인) ──
  const convergent = registryTidMissingFromPoller.length === 0 && registryMerchantMissingFromPoller.length === 0;
  console.log("\n── AC-3 REGUNION-FIX(env∪DB union) 실효 검증 ──");
  console.log(`  registry(watchdog) ⊆ poller 로드값 : ${convergent ? "성립 ✅ (수렴 = fix 실효 — registry 항목 전건 admit)" : "미성립 ❌ (registry 항목 누락 = 회귀/다른 locus 잔존)"}`);

  // ── 웹훅 EF (Subject C) 부가 대조: static merchant set vs registry merchant ─────────
  if (ef.ok) {
    const efCmp = compare(ef, watchdog);
    console.log("\n── (부가) 웹훅 EF static merchant ↔ registry merchant ──");
    console.log(`  merchant : ${efCmp.merchant.match ? "일치 ✅" : "불일치 ❌ (code-deploy-shadow 의심)"} (ef=${ef.merchant_count} registry=${watchdog.merchant_count})`);
    if (efCmp.merchant.a_only.length) console.log(`  EF 에만: ${efCmp.merchant.a_only.join(", ")}`);
    if (efCmp.merchant.b_only.length) console.log(`  registry 에만(EF 미반영): ${efCmp.merchant.b_only.join(", ")}`);
  }

  const evidence = {
    generated_at: new Date().toISOString(),
    ticket: "T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK",
    fingerprints: { poller, watchdog, ef },
    ac2: {
      tid_match: tidMatch, merchant_match: merMatch,
      registry_tid_missing_from_poller: registryTidMissingFromPoller,
      env_only_extra_in_poller: envOnlyExtraInPoller,
      registry_merchant_missing_from_poller: registryMerchantMissingFromPoller,
      env_override_merchant_extra: envOverrideMerchantExtra,
      env_shadow_verdict: envShadowVerdict,
      stale_side: staleSide,
      revenue_silent_drop_risk: revenueRisk,
    },
    ac3_regunion_fix_convergent: convergent,
  };
  if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(evidence, null, 2)); console.log(`\n📄 evidence → ${JSON_OUT}`); }

  console.log(`\n═══ 종합: ${envShadowVerdict}${revenueRisk ? " · ★매출위험 P0" : ""} · REGUNION-FIX ${convergent ? "실효(수렴)" : "미수렴"} ═══`);
  // exit code: 0=env-shadow없음+수렴 / 3=env-shadow(안전방향) / 4=env-shadow(매출위험)
  if (revenueRisk) process.exit(4);
  if (envShadowVerdict === "ENV_SHADOW_DETECTED") process.exit(3);
  process.exit(0);
}

main().catch((e) => { console.error(`치명 오류: ${e instanceof Error ? e.stack : String(e)}`); process.exit(1); });
