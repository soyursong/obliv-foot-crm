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
//   실행: node scripts/redpay_envshadow_valuecheck.mjs [--json out.json] [--ef]
//     --ef: 웹훅 EF(C) + 대사 EF(D) introspection 포함 → 4주체(A poller·B watchdog·C webhook-EF·D reconcile-EF)
//           런타임 실 로드값 SHA256 fold 대조(T-20260729-foot-REDPAY-RECONCILE-EF-ENVSHADOW-4TH-LOCUS ②DETECT).

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json") ? ARGS[ARGS.indexOf("--json") + 1] : null;
const WITH_EF = ARGS.includes("--ef");
// T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN Axis A — union fix 適用 前/後 divergence 증명(결정적·무prod).
const UNION_PROOF = ARGS.includes("--union-convergence-proof");

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

// ── 대사(reconcile) EF introspection (선택) — authed GET ?introspect=whitelist ─────
//   T-20260729-foot-REDPAY-RECONCILE-EF-ENVSHADOW-4TH-LOCUS ②DETECT: 판독지점 D 를 4번째 peer 로 편입.
//   webhook EF(C) 와 동일 auth 계약(Bearer SERVICE_ROLE_KEY). D 는 TID(registry∪env)+merchant 둘 다 노출.
function introspectReconcileEf() {
  const base = process.env.REDPAY_RECONCILE_URL
    || (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/redpay-reconcile` : null);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !key) return { ok: false, subject: "reconcile-ef", error: "REDPAY_RECONCILE_URL/SUPABASE_URL 또는 SERVICE_ROLE_KEY 미설정 — reconcile EF introspection skip" };
  const r = spawnSync("curl", ["-sS", "-m", "20", "-H", `Authorization: Bearer ${key}`, `${base}?introspect=whitelist`], { encoding: "utf8", env: process.env });
  try {
    const o = JSON.parse(r.stdout ?? "");
    if (o?.ok && o.fingerprint?.subject) return { ok: true, ...o.fingerprint };
    return { ok: false, subject: "reconcile-ef", error: `EF 응답 비정상: ${(r.stdout ?? "").slice(0, 200)}` };
  } catch {
    return { ok: false, subject: "reconcile-ef", error: `EF 미배포/응답파싱 실패: ${(r.stdout ?? r.stderr ?? "").slice(0, 200)}` };
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

// ── 4-way VALUECHECK fold (T-20260729-foot-REDPAY-RECONCILE-EF-ENVSHADOW-4TH-LOCUS ②DETECT) ──────
//   허용목록을 런타임에 읽는 4주체(poller A · watchdog B · webhook-EF C · reconcile-EF D)의 실 로드값
//   지문을 SHA256 으로 합의(consensus) 대조한다. peer 의 소스가 값을 갖는 축만 fold 대상:
//     · TID  fold: TID 를 실제 로드하는 주체(poller · watchdog · reconcile-EF)만. (webhook-EF 는 TID 없음 → 제외)
//     · merchant fold: merchant 를 로드하는 전 주체(A·B·C·D).
//   합의 = 대상 peer 들의 sha256 이 전부 동일. outlier = 다수 합의에서 벗어난 peer(=env-shadow/deploy-shadow 의심).
function foldValuecheck(peers, axis) {
  // peers: [{name, fp}] — fp 는 introspect 결과(ok 인 것만). axis: 'tid' | 'merchant'.
  const shaKey = axis === "tid" ? "tid_sha256" : "merchant_sha256";
  const cntKey = axis === "tid" ? "tid_count" : "merchant_count";
  const srcKey = axis === "tid" ? "tid_source" : "merchant_source";
  // TID fold 는 실제 TID 를 로드하는 주체만(count>0 또는 source!=n/a). webhook-EF(tid n/a·count0)는 제외.
  const participating = peers.filter(({ fp }) =>
    fp.ok && (axis === "merchant" ? true : (fp[srcKey] && fp[srcKey] !== "n/a"))
  );
  if (participating.length === 0) return { axis, participants: [], consensus: null, unanimous: false, groups: {} };
  const groups = {};
  for (const { name, fp } of participating) {
    const sha = fp[shaKey];
    (groups[sha] ??= { sha, count: fp[cntKey], peers: [] }).peers.push(name);
  }
  const shaEntries = Object.values(groups).sort((a, b) => b.peers.length - a.peers.length);
  const consensus = shaEntries[0];
  const unanimous = shaEntries.length === 1;
  const outliers = shaEntries.slice(1).flatMap((g) => g.peers);
  return {
    axis,
    participants: participating.map((p) => p.name),
    consensus_sha256: consensus.sha,
    consensus_peers: consensus.peers,
    outlier_peers: outliers,
    unanimous,
    groups: Object.fromEntries(shaEntries.map((g) => [g.sha.slice(0, 16), { count: g.count, peers: g.peers }])),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN Axis A — REGUNION-FIX 前/後 divergence 증명
//   총괄(최필경) req: "union fix 적용 前/後 각각 런타임 덤프 → union이 divergence 0으로 만들었는지 증명".
//   ★ prod fix 는 이미 적용됨 → 진짜 '前' 런타임 덤프는 revert 없이 불가. 대신 poller resolveWhitelistSources()
//     의 (구)shadow-early-return semantic 과 (신)env∪registry-union semantic 을 **동일 fixture** 에 태워
//     divergence 를 결정적으로 재현한다. no-prod-touch·no-DDL·순수함수 = self-test 등급 evidence.
//   divergence 정의 = registry(SSOT) 에 있으나 poller 가 로드 못한 TID 집합 크기 = env-shadow silent-drop 표면.
//     · 구 semantic (envMerchant && envTid → early-return, registry 미조회) → env stale 이면 divergence>0.
//     · 신 semantic (tid = env ∪ registry)                                    → divergence=0 (수렴 증명).
// ── poller semantic 충실 재현 (scripts/redpay_macstudio_poller.mjs 대조) ──────────────
//   구: resolveWhitelists() 안 `if (envMerchant && envTid) { ...; return; }`  = registry shadow.
function resolveOLD_shadow({ envMerchant, envTid, baseMerchantList, baseTidList, reg }) {
  // 구 로직: env 양쪽 설정 → registry 완전 shadow (env 값만 사용).
  if (envMerchant && envTid) return { merchantList: baseMerchantList.slice(), tidList: baseTidList.slice(), source: "env(shadow)" };
  if (!reg) return { merchantList: baseMerchantList.slice(), tidList: baseTidList.slice(), source: "default" };
  const merchantList = envMerchant ? baseMerchantList.slice() : reg.merchants.slice();
  const tidList = envTid ? baseTidList.slice() : reg.tids.slice();
  return { merchantList, tidList, source: "registry/env" };
}
//   신: resolveWhitelistSources() — merchant=env override 우선(union 미적용), tid = env ∪ registry.
function resolveNEW_union({ envMerchant, envTid, baseMerchantList, baseTidList, reg }) {
  if (!reg) return { merchantList: baseMerchantList.slice(), tidList: baseTidList.slice(), source: "default" };
  const merchantList = envMerchant ? baseMerchantList.slice() : reg.merchants.slice();
  const tidList = envTid ? [...new Set([...reg.tids, ...baseTidList])] : reg.tids.slice();
  return { merchantList, tidList, source: "registry" };
}
function divergenceCount(resolved, reg) {
  // registry(SSOT) TID 중 poller 로드값(resolved.tidList)에 없는 것 = silent-drop 표면.
  if (!reg) return { missing: [], count: 0 };
  const loaded = new Set(resolved.tidList);
  const missing = reg.tids.filter((t) => !loaded.has(t));
  return { missing, count: missing.length };
}
function unionConvergenceProof() {
  console.log("═══ REGUNION-FIX 前/後 divergence 증명 (T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN Axis A) ═══\n");
  console.log("성격: 결정적 semantic 재현(no-prod·no-DDL·순수). '前'=구 shadow-early-return, '後'=env∪registry union.\n");

  // ── fixture: stale env(538-band 신 TID 누락) + registry(538-band 포함) — 236-FALSENEG RC 재현 ──
  const cases = [
    {
      name: "236-FALSENEG RC (stale env + registry 신TID)",
      envMerchant: true, envTid: true,
      baseMerchantList: ["1777289001", "1777289002"],
      baseTidList: ["1047479255", "1047479254"], // 구 479-band 만(stale)
      reg: {
        merchants: ["1777289001", "1777289002"],
        tids: ["1047479255", "1047479254", "1047538231", "1047538236", "1047538245"], // registry=SSOT(신 538 포함)
      },
    },
    {
      name: "env 완전(누락 없음) — divergence 애초 0",
      envMerchant: true, envTid: true,
      baseMerchantList: ["1777289001"],
      baseTidList: ["1047479255", "1047538231"],
      reg: { merchants: ["1777289001"], tids: ["1047479255", "1047538231"] },
    },
    {
      name: "reg=null (DB 미가용 fail-safe)",
      envMerchant: true, envTid: true,
      baseMerchantList: ["1777289001"], baseTidList: ["1047479255"], reg: null,
    },
  ];

  let allPass = true;
  const rows = [];
  for (const c of cases) {
    const oldR = resolveOLD_shadow(c);
    const newR = resolveNEW_union(c);
    const oldD = divergenceCount(oldR, c.reg);
    const newD = divergenceCount(newR, c.reg);
    // RC 케이스: 구>0 && 신=0 이어야 fix 실효. env-완전/reg-null 케이스: 구=신(=0 or fail-safe) 회귀 없음.
    const isRcCase = c.name.startsWith("236");
    const pass = isRcCase ? (oldD.count > 0 && newD.count === 0) : (newD.count === oldD.count);
    allPass = allPass && pass;
    rows.push({ case: c.name, before_divergence: oldD.count, before_missing: oldD.missing, after_divergence: newD.count, after_missing: newD.missing, verdict: pass ? "PASS" : "FAIL" });
    console.log(`■ ${c.name}`);
    console.log(`   前(구 shadow)  divergence=${oldD.count}${oldD.count ? ` missing=[${oldD.missing.join(", ")}]` : ""}`);
    console.log(`   後(union)      divergence=${newD.count}${newD.count ? ` missing=[${newD.missing.join(", ")}]` : ""}`);
    console.log(`   → ${pass ? "✅ PASS" : "❌ FAIL"}${isRcCase ? "  (union 이 divergence 를 0 으로 봉인)" : "  (회귀 없음)"}\n`);
  }

  const evidence = {
    generated_at: new Date().toISOString(),
    ticket: "T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN",
    axis: "A — REGUNION-FIX before/after divergence proof",
    method: "deterministic semantic reproduction (resolveOLD_shadow vs resolveNEW_union on shared fixture)",
    parent: "T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX",
    divergence_definition: "registry(SSOT) TID not loaded by poller = env-shadow silent-drop surface",
    cases: rows,
    verdict: allPass ? "UNION_CONVERGENCE_PROVEN" : "PROOF_FAILED",
  };
  if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(evidence, null, 2)); console.log(`📄 evidence → ${JSON_OUT}`); }
  console.log(`═══ 종합: ${evidence.verdict} — 구 semantic 은 stale env 에서 divergence>0(silent-drop), union 은 divergence=0(봉인) ═══`);
  process.exit(allPass ? 0 : 5);
}

async function main() {
  if (UNION_PROOF) return unionConvergenceProof();
  console.log("═══ RedPay env-shadow 런타임 실값 대조 (T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK) ═══\n");

  const poller = introspect("redpay_macstudio_poller.mjs", "poller");
  const watchdog = introspect("redpay_terminal_watchdog.mjs", "watchdog");
  const ef = WITH_EF ? introspectEf() : { ok: false, subject: "webhook-ef", error: "skip (--ef 미지정)" };
  // ②DETECT 4번째 peer: reconcile EF(D). --ef 지정 시 함께 조회.
  const reconcileEf = WITH_EF ? introspectReconcileEf() : { ok: false, subject: "reconcile-ef", error: "skip (--ef 미지정)" };

  for (const [name, fp] of [["poller", poller], ["watchdog", watchdog], ["webhook-ef", ef], ["reconcile-ef", reconcileEf]]) {
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

  // ── 4-way VALUECHECK fold (T-20260729-foot-...-4TH-LOCUS ②DETECT) ─────────────────
  //   ⚠ A11(feed↔registry coverage)과 별개 축 — 여기 집은 VALUECHECK(런타임 실 로드값 SHA256 합의).
  const peers4 = [
    { name: "poller", fp: poller },
    { name: "watchdog", fp: watchdog },
    { name: "webhook-ef", fp: ef },
    { name: "reconcile-ef", fp: reconcileEf },
  ];
  const tidFold = foldValuecheck(peers4, "tid");
  const merchantFold = foldValuecheck(peers4, "merchant");
  console.log("\n── 4-way VALUECHECK fold (poller ↔ watchdog ↔ webhook-EF ↔ reconcile-EF) ──");
  console.log(`  TID      fold : ${tidFold.unanimous ? "합의 ✅" : "불합의 ❌"} ` +
    `참여=[${tidFold.participants.join(", ")}]${tidFold.unanimous ? "" : ` outlier=[${tidFold.outlier_peers.join(", ")}]`}`);
  if (!tidFold.unanimous) console.log(`     TID sha 그룹: ${JSON.stringify(tidFold.groups)}`);
  console.log(`  merchant fold : ${merchantFold.unanimous ? "합의 ✅" : "불합의 ❌"} ` +
    `참여=[${merchantFold.participants.join(", ")}]${merchantFold.unanimous ? "" : ` outlier=[${merchantFold.outlier_peers.join(", ")}]`}`);
  if (!merchantFold.unanimous) console.log(`     merchant sha 그룹: ${JSON.stringify(merchantFold.groups)}`);
  const reconcileEfInFold = reconcileEf.ok;
  console.log(`  reconcile-EF(D) 편입: ${reconcileEfInFold ? "✅ 4주체 대조 성립" : "⚠ D 지문 미확보(EF 미배포/미인증) — 3주체로 축소"}`);

  const evidence = {
    generated_at: new Date().toISOString(),
    ticket: "T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK",
    fingerprints: { poller, watchdog, ef, reconcile_ef: reconcileEf },
    fourway_fold: {
      note: "T-20260729-foot-REDPAY-RECONCILE-EF-ENVSHADOW-4TH-LOCUS ②DETECT — VALUECHECK 축(A11 coverage 축과 별개)",
      tid: tidFold,
      merchant: merchantFold,
      reconcile_ef_included: reconcileEfInFold,
    },
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

  // ②DETECT 센서: reconcile-EF(D)가 fold 에 참여했는데 TID 합의에서 벗어나면 = D env-shadow 직접 신호.
  const dTidOutlier = reconcileEfInFold && tidFold.outlier_peers.includes("reconcile-ef");
  const dMerchantOutlier = reconcileEfInFold && merchantFold.outlier_peers.includes("reconcile-ef");
  if (dTidOutlier || dMerchantOutlier) {
    console.log(`  ▶ ★reconcile-EF(D) env-shadow 감지: ${[dTidOutlier ? "TID" : null, dMerchantOutlier ? "merchant" : null].filter(Boolean).join("+")} 축 fold 이탈`);
  }

  console.log(`\n═══ 종합: ${envShadowVerdict}${revenueRisk ? " · ★매출위험 P0" : ""} · REGUNION-FIX ${convergent ? "실효(수렴)" : "미수렴"}` +
    `${reconcileEfInFold ? ` · 4-way TID fold ${tidFold.unanimous ? "합의" : "불합의"}` : ""} ═══`);
  // exit code: 0=env-shadow없음+수렴+4way합의 / 3=env-shadow(안전방향) / 4=env-shadow(매출위험) / 5=reconcile-EF(D) fold 이탈
  if (revenueRisk) process.exit(4);
  if (envShadowVerdict === "ENV_SHADOW_DETECTED") process.exit(3);
  if (dTidOutlier || dMerchantOutlier) process.exit(5);
  process.exit(0);
}

// 직접 실행 시에만 main() 진입. import(self-test) 시엔 foldValuecheck 등 순수함수만 재사용.
export { foldValuecheck, compare };
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`치명 오류: ${e instanceof Error ? e.stack : String(e)}`); process.exit(1); });
}
