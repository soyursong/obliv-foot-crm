/**
 * T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE — Phase 2 RECONCILE DRY-RUN (READ-ONLY)
 * ─────────────────────────────────────────────────────────────────────────────
 * 목적: 배포될 2A 로직(resolveVisitTypesByCheckIn: per-checkin recency + owner-forced pin)을
 *   Phase1 freeze 229행 전량에 **라이브 재적용**해 before→after 초진/재진 + per-consultant 델타 산출.
 *   = planner 요청 "record_id 델타·freeze 재계산 후 dry-run 제시" + AC4(직원별누적 before/after) 근거.
 *
 * 판정 = 배포 코드와 동일 산식:
 *   재진 = 자기 checked_in_at 이전(strict <)의 done 방문이 있고 diff<=365일. 없으면 초진.
 *   owner-forced override (visitTypeOverrides.ts 4건) 최종 pin.
 * UPDATE/DDL 0건. 순수 SELECT.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const WINDOW = 365;

// owner-forced override (visitTypeOverrides.ts 미러)
const OWNER_FORCED = {
  '1c2117de-b091-4227-b8a5-a167c1d865b7': 'new',        // 정명희#4270 owner-forced 초진
  '9b701267-3681-4380-a2c9-7dcf9dbec6a2': 'returning',  // ③ #7137 owner KEEP 재진
  'ebea2e1f-a589-47ad-b3e8-c71a0340f513': 'returning',  // ⑥ #1242 owner KEEP 재진
  '01baf9ea-23e4-4e3f-9ec2-288638eece4b': 'returning',  // ⑦ #2601 owner KEEP 재진
};

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const dayISO = (ts) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD KST
const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const full = JSON.parse(readFileSync(join(here, '..', 'evidence', 'T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS_phase1_full.json'), 'utf8'));
console.log(`=== RECONCILE DRY-RUN — Phase1 freeze ${full.length}행 라이브 재적용 (READ-ONLY) ===\n`);

// 1) 229 record 의 checked_in_at + status
const ids = full.map((r) => r.record_id);
const recRows = await q(`
  SELECT id, customer_id, to_char(checked_in_at,'YYYY-MM-DD"T"HH24:MI:SS+00') AS at_utc, checked_in_at, status
  FROM public.check_ins WHERE id IN (${ids.map((x) => `'${x}'`).join(',')});`);
const recById = new Map(recRows.map((r) => [r.id, r]));

// 2) 대상 고객 전체 done 방문(오름차순)
const custIds = [...new Set(recRows.map((r) => r.customer_id).filter(Boolean))];
const doneRows = await q(`
  SELECT customer_id, checked_in_at FROM public.check_ins
  WHERE customer_id IN (${custIds.map((x) => `'${x}'`).join(',')})
    AND status='done' AND deleted_at IS NULL AND clinic_id='${JONGNO}'
  ORDER BY checked_in_at ASC;`);
const doneByCust = new Map();
for (const d of doneRows) { const a = doneByCust.get(d.customer_id) ?? []; a.push(d.checked_in_at); doneByCust.set(d.customer_id, a); }

// 3) 판정 (배포 로직 미러)
function classify(rec) {
  if (OWNER_FORCED[rec.id]) return { vt: OWNER_FORCED[rec.id], forced: true };
  const dones = doneByCust.get(rec.customer_id) ?? [];
  let lastPrior = null;
  for (const d of dones) { if (d < rec.checked_in_at) lastPrior = d; else break; }
  if (!lastPrior) return { vt: 'new', forced: false };
  const diff = diffDays(dayISO(lastPrior), dayISO(rec.checked_in_at));
  return { vt: diff <= WINDOW ? 'returning' : 'new', forced: false };
}

const perConsultant = new Map(); // consultant → {beforeRet, afterRet, toNew, forcedNew, forcedRet}
let afterRet = 0, afterNew = 0, forcedCount = 0, missing = 0;
for (const row of full) {
  const rec = recById.get(row.record_id);
  const c = row.consultant || '(미상)';
  const p = perConsultant.get(c) ?? { beforeRet: 0, afterRet: 0, forced: 0 };
  p.beforeRet++; // Phase1 시점 전부 '재진'으로 집계됐던 행
  if (!rec) { missing++; perConsultant.set(c, p); continue; }
  const { vt, forced } = classify(rec);
  if (forced) { forcedCount++; p.forced++; }
  if (vt === 'returning') { afterRet++; p.afterRet++; } else afterNew++;
  perConsultant.set(c, p);
}

console.log('── before→after 초진/재진 (전체) ──');
console.table([{ metric: '재진(returning)', before: full.length, after: afterRet, delta: afterRet - full.length },
               { metric: '초진(new)', before: 0, after: afterNew, delta: afterNew }]);
console.log(`   owner-forced pin 적용 = ${forcedCount}건 / 대상행 미조회 = ${missing}건`);

console.log('\n── per-consultant 재진 카운트 before→after (AC4 근거) ──');
console.table([...perConsultant.entries()].map(([c, p]) => ({
  consultant: c, before_재진: p.beforeRet, after_재진: p.afterRet, 초진이관: p.beforeRet - p.afterRet, forced: p.forced,
})).sort((a, b) => b.before_재진 - a.before_재진));

// 4) freeze 델타 요약
console.log('\n── freeze 델타 (Phase1 freeze=221 RECLASS / 8 KEEP 기준) ──');
console.log(`   최종 초진(new) 총계 = ${afterNew}  /  최종 재진(returning) 총계 = ${afterRet}  (합 ${afterNew + afterRet})`);
console.log(`   확정 decision: RECLASS(초진이관)=218 · KEEP(재진유지)=11 (planner AUTHORIZE)`);
console.log(`   display 그레인: 정명희(1c2117de) = KEEP set 내 owner-forced 초진 → 초진표시(+1) / 재진표시(-1)`);

console.log('\n✅ RECONCILE 완료 — UPDATE 0건.');
