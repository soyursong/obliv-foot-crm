/**
 * T-20260721-foot-TEST-DUMMY-CLEANUP — AC-2 §4-B DRY-RUN (No-Persistence) + fixpoint 전이-closure census
 *
 * SOP §2-0 정본 (census 러너 commit 192700eb 계승). 자식 FK 손열거 BAN — pg_constraint 기계열거만.
 * DA 4차 CONSULT-REPLY(MSG-20260721-163320-szw3): Q1·Q2·Q3 GO. net-loss SSOT = **30 확정**.
 *
 * Migration Dry-Run No-Persistence Protocol(§1) 준수:
 *   (0) canary   — BEGIN;<무해 가역>;ROLLBACK; → ROLLBACK 실효 선증명(autocommit sentinel-bypass 차단).
 *   (1) fixpoint — customers/check_ins seed 로 전이-closure walk(READ-ONLY) → edge별 confdeltype 분류
 *                  → 3항 증명 emit: (a)NEW row 자식 전량 CASCADE 且 total==30 (b)a/r NEW row==0 (c)n NEW row==0.
 *   (2) abort-if-grown — frozen 6 check_ins-only fixpoint 재census → CASCADE 서명 {7st,7aa,1crl}·손자0 확인.
 *   (3) trial    — plpgsql DO 안 ordered DELETE(자식 aa/crl/st → check_ins → customers) → GET DIAGNOSTICS
 *                  순소실 캡처 → net-loss==30 대조(양방 under/over) → sentinel RAISE(uncaught) 로 statement 롤백.
 *   (4) probe    — 사후 freeze 라이브 카운트 재측정 == 원래(무영속 확증).
 * 시크릿: SUPABASE_ACCESS_TOKEN(sbp_…, Management API) 또는 ~/.config/medibuilder-secrets/foot-supabase-pat.
 *
 * 사용:  node scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_dryrun_fullfk.mjs [--trial]
 *        (--trial 없으면 census + 3항증명 + abort-if-grown 만 = READ-ONLY. --trial 은 no-persistence trial-DELETE.)
 *
 * ⚠ 실 DELETE(--apply·COMMIT) 는 이 러너가 아니라 ac2_apply.mjs. 본 러너는 dry-run 무영속 evidence 전용.
 */
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FREEZE_CUSTOMERS, FREEZE_CHECKINS, EXPECT, CASCADE_CHILD_SIGNATURE, TICKET,
} from './T-20260721-foot-TEST-DUMMY-CLEANUP_freeze.mjs';
import {
  buildFixpointClosureSql, parseFixpoint, adjudicateFixpoint,
  buildAbortIfGrownSql, adjudicateAbortIfGrown, uuidArr,
} from './T-20260721-foot-TEST-DUMMY-CLEANUP_census_lib.mjs';

const REF = 'rxlomoozakkjesdqjtvd';
const CUST = FREEZE_CUSTOMERS;
const CI = FREEZE_CHECKINS;
const EXPECT_TOTAL = EXPECT.net_loss_total; // 30 (DA 4차 SSOT)
const CANARY = '__DRYRUN_CANARY_T20260721_TDC__';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
try { if (!TOKEN) TOKEN = fs.readFileSync(os.homedir() + '/.config/medibuilder-secrets/foot-supabase-pat', 'utf8').trim(); } catch {}
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ PAT 미제공 (SUPABASE_ACCESS_TOKEN / foot-supabase-pat)'); process.exit(3); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: r.ok, body: await r.text() };
}

const log = [];
const out = (s) => { console.log(s); log.push(s); };
const TRIAL = process.argv.includes('--trial');
out(`# ${TICKET} — AC-2 §4-B DRY-RUN fixpoint-closure · ${new Date().toISOString()} · trial=${TRIAL}`);
out(`# net-loss SSOT = ${EXPECT_TOTAL} (DA 4차 GO). READ-ONLY prep — 실 DELETE·COMMIT 없음.\n`);

let hardFail = false;

// (0) canary — ROLLBACK 실효 선증명
{
  await q(`BEGIN; COMMENT ON TABLE public.check_ins IS '${CANARY}'; ROLLBACK;`);
  const c = await q(`SELECT obj_description('public.check_ins'::regclass) AS c`);
  const persisted = JSON.parse(c.body)?.[0]?.c === CANARY;
  out(`── (0) canary ROLLBACK 실효: ${persisted ? '❌ 잔존(ABORT)' : '✅ 무영속'}`);
  if (persisted) { out('CANARY_PERSISTED — 중단'); writeEvidence('CANARY_PERSISTED'); process.exit(1); }
}

// (1) fixpoint 전이-closure census + 3항 증명
out('\n── (1) fixpoint 전이-closure census (SOP §2-0, 손열거 BAN)');
const fp = parseFixpoint((await q(buildFixpointClosureSql(CUST, CI))).body);
if (fp) {
  out(`     rounds=${fp.rounds} (fixpoint 종결) · closure total=${fp.total} · cascade_extra=${fp.cascade_extra}`);
  out(`     edge classification (confdeltype):${fp.edges}`);
}
const adj = adjudicateFixpoint(fp, EXPECT_TOTAL);
adj.reasons.forEach((r) => out(`     ${r}`));
out(`     ⇒ 3항 증명 ${adj.pass ? '✅ PASS' : '❌ FAIL'}`);
if (!adj.pass) hardFail = true;

// baseline freeze live (probe 기준)
const freezeCountSql = `SELECT
  (SELECT count(*) FROM public.customers WHERE id = ANY(${uuidArr(CUST)})) cust,
  (SELECT count(*) FROM public.check_ins WHERE id = ANY(${uuidArr(CI)})) ci,
  (SELECT count(*) FROM public.status_transitions WHERE check_in_id = ANY(${uuidArr(CI)})) st,
  (SELECT count(*) FROM public.assignment_actions WHERE check_in_id = ANY(${uuidArr(CI)})) aa,
  (SELECT count(*) FROM public.check_in_room_logs WHERE check_in_id = ANY(${uuidArr(CI)})) cirl`;
const base = JSON.parse((await q(freezeCountSql)).body)[0];
out(`\n── baseline freeze live: ${JSON.stringify(base)}`);

// (2) abort-if-grown (DA 4차 Q2) — frozen 6 check_ins-only fixpoint 재census
out('\n── (2) abort-if-grown 재census (frozen 6 check_ins-only, cron drift 감지)');
const grownFp = parseFixpoint((await q(buildAbortIfGrownSql(CI))).body);
const grown = adjudicateAbortIfGrown(grownFp, CASCADE_CHILD_SIGNATURE, EXPECT.check_ins);
out(`     ${grown.reason}`);
out(`     ⇒ abort-if-grown ${grown.pass ? '✅ (미성장)' : '❌ GROWN → ABORT·재adjudication'}`);
if (!grown.pass) hardFail = true;

if (hardFail) {
  out('\n⛔ HARD-FAIL: 3항증명/abort-if-grown 위반 → dry-run trial 진입 금지. 재adjudication 필요.');
  writeEvidence('HARD_FAIL');
  process.exit(2);
}

if (!TRIAL) {
  out('\n✅ census + 3항증명 + abort-if-grown 통과 (READ-ONLY). --trial 미지정: no-persistence trial-DELETE 생략.');
  writeEvidence('READONLY_PASS');
  process.exit(0);
}

// (3) no-persistence trial — uncaught sentinel → statement rollback (무영속)
out('\n── (3) no-persistence trial-DELETE (자식 → 부모 순, POSTCHECK net-loss==30 양방 catch)');
const trialSql = `DO $t$
DECLARE d_st int; d_aa int; d_cirl int; d_ci int; d_cust int; d_total int;
BEGIN
  DELETE FROM public.status_transitions WHERE check_in_id = ANY(${uuidArr(CI)}); GET DIAGNOSTICS d_st=ROW_COUNT;
  DELETE FROM public.assignment_actions WHERE check_in_id = ANY(${uuidArr(CI)}); GET DIAGNOSTICS d_aa=ROW_COUNT;
  DELETE FROM public.check_in_room_logs WHERE check_in_id = ANY(${uuidArr(CI)}); GET DIAGNOSTICS d_cirl=ROW_COUNT;
  DELETE FROM public.check_ins WHERE id = ANY(${uuidArr(CI)}); GET DIAGNOSTICS d_ci=ROW_COUNT;
  DELETE FROM public.customers WHERE id = ANY(${uuidArr(CUST)}); GET DIAGNOSTICS d_cust=ROW_COUNT;
  d_total := d_st + d_aa + d_cirl + d_ci + d_cust;
  IF d_cust<>${EXPECT.customers} OR d_ci<>${EXPECT.check_ins} OR d_st<>${EXPECT.status_transitions}
     OR d_aa<>${EXPECT.assignment_actions} OR d_cirl<>${EXPECT.check_in_room_logs} OR d_total<>${EXPECT_TOTAL} THEN
    RAISE EXCEPTION 'POSTCHECK_MISMATCH cust=% ci=% st=% aa=% cirl=% total=% (expect 30)', d_cust,d_ci,d_st,d_aa,d_cirl,d_total;
  END IF;
  RAISE EXCEPTION 'DRYRUN_OK_ABORT netloss cust=% ci=% st=% aa=% cirl=% total=%', d_cust,d_ci,d_st,d_aa,d_cirl,d_total;
END $t$;`;
const tr = await q(trialSql);
const okAbort = /DRYRUN_OK_ABORT/.test(tr.body);
out(`     ${okAbort ? '✅ ' + (tr.body.match(/DRYRUN_OK_ABORT[^"\\]*/) || [])[0] : '❌ ' + tr.body}`);

// (4) post-probe — 무영속 확증
const post = JSON.parse((await q(freezeCountSql)).body)[0];
const noPersist = JSON.stringify(post) === JSON.stringify(base);
out(`\n── (4) post-probe: ${JSON.stringify(post)} — 무영속=${noPersist ? '✅' : '❌ PERSISTED'}`);
out(`\n## VERDICT: ${okAbort && noPersist ? '✅ DRY-RUN PASS (무영속, net-loss 30 확증)' : '❌ FAIL'}`);
writeEvidence(okAbort && noPersist ? 'DRYRUN_PASS' : 'FAIL');
process.exit(okAbort && noPersist ? 0 : 1);

function writeEvidence(verdict) {
  try {
    const evDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db-gate/census-dummy-cleanup');
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(join(evDir, 'ac2_dryrun_fullfk_evidence.txt'),
      log.join('\n') + `\n\n# verdict=${verdict}\n`);
  } catch { /* evidence 기록 실패는 판정에 무영향 */ }
}
