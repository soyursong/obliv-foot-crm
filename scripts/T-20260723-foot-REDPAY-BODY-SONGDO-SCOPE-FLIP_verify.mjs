#!/usr/bin/env node
// T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE-FLIP — 로드타임 불변식 검증 (오프라인, 무네트워크)
//   대상: scripts/redpay_macstudio_poller.mjs 의 business_no 멀티스코프 + DOHSU 506 whitelist.
//   방법: 실제 폴러 소스에서 main() 자동실행부만 잘라내고 내부 상수를 export 하여 import → 단정.
//   RedPay/Supabase 미접촉(top-level const 해석만). foot 무영향 + body 양쪽(457+506) + fail-closed 검증.
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "redpay_macstudio_poller.mjs");

async function buildSimModule() {
  const src = await readFile(SRC, "utf8");
  const idx = src.indexOf("\nmain().catch");
  if (idx < 0) throw new Error("main().catch 진입점을 찾지 못함 — 소스 구조 변경 의심");
  const body = src.slice(0, idx);
  const sim = body +
    "\nexport { REDPAY_DOMAIN, REDPAY_BUSINESS_NO_LIST, REDPAY_BUSINESS_NO, merchantList, tidList };\n";
  const out = join(tmpdir(), `redpay_poller_sim_${Date.now()}.mjs`);
  await writeFile(out, sim, "utf8");
  return out;
}

async function loadWith(simPath, env) {
  for (const k of Object.keys(process.env)) if (k.startsWith("REDPAY_")) delete process.env[k];
  Object.assign(process.env, env);
  return import(`file://${simPath}?` + Math.random().toString(36).slice(2));
}

const simPath = await buildSimModule();
const foot = await loadWith(simPath, { REDPAY_DOMAIN: "foot" });
const body = await loadWith(simPath, { REDPAY_DOMAIN: "body", REDPAY_BUSINESS_NO_BODY: "457-23-00938,506-60-03455" });
const bodyEmpty = await loadWith(simPath, { REDPAY_DOMAIN: "body" });

const CASES = [
  // ── foot 무영향(하위호환) ──
  ["foot 단일 스코프 유지(457 단독, Q2=No)", foot.REDPAY_BUSINESS_NO_LIST.length === 1 && foot.REDPAY_BUSINESS_NO_LIST[0] === "457-23-00938"],
  ["foot merchant에 DOHSU 종로band(1777274001) 무유입", !foot.merchantList.includes("1777274001")],
  ["foot merchant에 506 송도도수(1777540751) 무유입", !foot.merchantList.includes("1777540751")],
  // ── body 양쪽(457+506) pull ──
  ["body 양쪽 2스코프(457+506)", body.REDPAY_BUSINESS_NO_LIST.length === 2 && body.REDPAY_BUSINESS_NO_LIST.includes("457-23-00938") && body.REDPAY_BUSINESS_NO_LIST.includes("506-60-03455")],
  ["body 506 송도도수 merchant 포함(751+842)", body.merchantList.includes("1777540751") && body.merchantList.includes("1777540842")],
  ["body 종로 band 유지(274~276)", body.merchantList.includes("1777274001") && body.merchantList.includes("1777276005")],
  // ── 오수집 가드(§519) ──
  ["body 송도풋 collision(1779768019/020) 제외", !body.merchantList.includes("1779768019") && !body.merchantList.includes("1779768020")],
  ["body 롱래(1777540911)·송도풋(1777540215) 무유입", !body.merchantList.includes("1777540911") && !body.merchantList.includes("1777540215")],
  ["body tid merchant-only 스코핑(빈 tid)", body.tidList.length === 0],
  // ── fail-closed(457 조용한 상속 봉인) ──
  ["body 미설정 시 fail-closed(list 0 → main 가드 exit)", bodyEmpty.REDPAY_BUSINESS_NO_LIST.length === 0],
];

let ok = true;
for (const [name, pass] of CASES) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) ok = false;
}
console.log(ok
  ? "\n✅ ALL PASS — foot 무영향 + body 양쪽(457+506) pull + 오수집가드 + fail-closed"
  : "\n❌ FAIL");
process.exit(ok ? 0 : 1);
