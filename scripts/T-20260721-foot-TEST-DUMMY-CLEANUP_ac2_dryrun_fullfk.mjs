/**
 * T-20260721-foot-TEST-DUMMY-CLEANUP — AC-2 §4-B DRY-RUN (No-Persistence) + 동적 full-FK census
 *
 * 개선: 기존 preflight 의 7테이블 손열거 undercount 를 §2-0 pg_constraint 전 FK 기계열거로 대체.
 * Migration Dry-Run No-Persistence Protocol(§1) 준수:
 *   (0) canary  — BEGIN;<무해 가역>;ROLLBACK; → 이 엔드포인트 ROLLBACK 실효 선증명(autocommit sentinel-bypass 차단).
 *   (1) census  — customers/check_ins 참조 전 FK loop, freeze-scope 자식 카운트 전수(READ-ONLY).
 *   (2) trial   — plpgsql DO 안에서 ordered DELETE → GET DIAGNOSTICS 로 순소실 캡처 → 사전정의 EXPECT 와
 *                 대조 → sentinel RAISE(uncaught) 로 statement 롤백(무영속) + 카운트 반송.
 *   (3) probe   — 사후 freeze 라이브 카운트 재측정 == 원래(무영속 확증).
 * 시크릿: SUPABASE_ACCESS_TOKEN(sbp_…, Management API) 또는 ~/.config/medibuilder-secrets/foot-supabase-pat.
 *
 * ★ EXPECT 는 DA 재adjudication 대상. 2026-07-21 full-FK census 실측 = 30
 *   (9 cust + 6 ci + 7 status_transitions + 7 assignment_actions + 1 check_in_room_logs).
 *   DA 선언 net-loss(9/6/7=22)와 divergence → 본 러너는 확장 EXPECT(30) 확정 前 trial 을 skip(census 보고만).
 *
 * 사용:  node scripts/T-20260721-foot-TEST-DUMMY-CLEANUP_ac2_dryrun_fullfk.mjs [--trial]
 */
import fs from 'node:fs';
import os from 'node:os';

const REF = 'rxlomoozakkjesdqjtvd';
const CUST = [
  'd7be9306-524b-4d40-8e25-a455a632bbf8','44f4f14c-be85-4ef3-bc93-56a883447b67',
  'b23a2267-1aff-438a-bf7d-f87838a4e870','7c385221-0a48-41be-bd2e-dadb5eedec54',
  '47be6e07-25fc-476a-a561-acba2ee6e3c1','ac0748ea-8c2f-400f-98cd-9436d3f76e3e',
  '64b2f7f0-0140-4bb8-ba9c-918d87a0f538','a24f706c-c06e-4668-b259-d4d53c56d13f',
  '641637ff-a07e-4001-ae35-a5a3255f7319',
];
const CI = [
  'cc1842dc-0ebd-4a7b-9359-ea25f139f453','bf2b0e94-e855-4c32-bc2d-bf73d78eb676',
  'dfae725c-7a6b-4409-95c6-bcf4e81e5e41','0bbbd3b3-0c3d-45b2-afcb-1b5979f3275a',
  '39e297aa-8fc3-430f-9131-493a0098df4b','14c29c0c-c2fa-4d73-9a9a-e63551f67be9',
];
// DA 재adjudication 대상. full-FK census 실측(2026-07-21). DA 확정 前 trial skip.
const EXPECT = { customers: 9, check_ins: 6, status_transitions: 7, assignment_actions: 7, check_in_room_logs: 1 };
const EXPECT_TOTAL = Object.values(EXPECT).reduce((a, b) => a + b, 0); // 30
const DA_DECLARED_TOTAL = 9 + 6 + 7; // 22
const CANARY = '__DRYRUN_CANARY_T20260721_TDC__';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
try { if (!TOKEN) TOKEN = fs.readFileSync(os.homedir() + '/.config/medibuilder-secrets/foot-supabase-pat', 'utf8').trim(); } catch {}
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ PAT 미제공'); process.exit(1); }

const arr = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(',')}]::uuid[]`;
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  return { ok: r.ok, body: t };
}

const TRIAL = process.argv.includes('--trial');
console.log(`# AC-2 §4-B DRY-RUN full-FK · ${new Date().toISOString()} · trial=${TRIAL}\n`);

// (0) canary — ROLLBACK 실효 선증명
{
  await q(`BEGIN; COMMENT ON TABLE public.check_ins IS '${CANARY}'; ROLLBACK;`);
  const c = await q(`SELECT obj_description('public.check_ins'::regclass) AS c`);
  const persisted = JSON.parse(c.body)?.[0]?.c === CANARY;
  console.log(`── (0) canary ROLLBACK 실효: ${persisted ? '❌ 잔존(ABORT)' : '✅ 무영속'}`);
  if (persisted) { console.error('CANARY_PERSISTED — 중단'); process.exit(1); }
}

// (1) 동적 full-FK census (READ-ONLY, §2-0)
const censusSql = `DO $c$
DECLARE r RECORD; v bigint; o text:=''; ids uuid[];
  cu uuid[]:=${arr(CUST)}; ci uuid[]:=${arr(CI)};
BEGIN
  FOR r IN SELECT rel.relname ct, att.attname cc, pf.relname pt, c.confdeltype dt
    FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_class pf ON pf.oid=c.confrelid
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ord) ON true
    JOIN pg_attribute att ON att.attrelid=c.conrelid AND att.attnum=k.attnum
    WHERE c.contype='f' AND pf.relname IN ('customers','check_ins') AND rel.relnamespace='public'::regnamespace
  LOOP
    IF r.pt='customers' THEN ids:=cu; ELSE ids:=ci; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ANY($1)', r.ct, r.cc) INTO v USING ids;
    IF v<>0 THEN o:=o||format(' %s.%s=%s[%s]', r.ct, r.cc, v, r.dt); END IF;
  END LOOP;
  RAISE EXCEPTION 'CENSUS:%', o;
END $c$;`;
const cen = await q(censusSql);
const censusLine = (cen.body.match(/CENSUS:([^"\\]*)/) || [, cen.body])[1].trim();
console.log(`── (1) full-FK census (non-zero freeze-scope children):\n     ${censusLine}`);

// (3-pre baseline for probe)
const freezeCountSql = `SELECT
  (SELECT count(*) FROM public.customers WHERE id = ANY(${arr(CUST)})) cust,
  (SELECT count(*) FROM public.check_ins WHERE id = ANY(${arr(CI)})) ci,
  (SELECT count(*) FROM public.status_transitions WHERE check_in_id = ANY(${arr(CI)})) st,
  (SELECT count(*) FROM public.assignment_actions WHERE check_in_id = ANY(${arr(CI)})) aa,
  (SELECT count(*) FROM public.check_in_room_logs WHERE check_in_id = ANY(${arr(CI)})) cirl`;
const base = JSON.parse((await q(freezeCountSql)).body)[0];
console.log(`── baseline freeze live: ${JSON.stringify(base)}`);

if (EXPECT_TOTAL !== DA_DECLARED_TOTAL) {
  console.log(`\n⛔ ABORT: full-FK census net-loss(${EXPECT_TOTAL}) ≠ DA 선언(${DA_DECLARED_TOTAL}=9/6/7).`);
  console.log('   assignment_actions(7)+check_in_room_logs(1) CASCADE 자식이 DA net-loss·스냅샷 미포함.');
  console.log('   → DA 재adjudication(net-loss 확장 30) 전까지 trial DELETE skip. 재보고(FOLLOWUP).');
  console.log('   (off-git snapshot_cascade_collateral_2026-07-21.json 확보 완료 = 재-GO 준비됨)');
  process.exit(2);
}

if (!TRIAL) { console.log('\n(--trial 미지정: no-persistence trial DELETE 생략)'); process.exit(0); }

// (2) no-persistence trial — DA 확장 EXPECT 확정 후에만 도달 (uncaught sentinel → statement rollback)
const trialSql = `DO $t$
DECLARE d_st int; d_aa int; d_cirl int; d_ci int; d_cust int;
BEGIN
  DELETE FROM public.status_transitions WHERE check_in_id = ANY(${arr(CI)}); GET DIAGNOSTICS d_st=ROW_COUNT;
  DELETE FROM public.assignment_actions WHERE check_in_id = ANY(${arr(CI)}); GET DIAGNOSTICS d_aa=ROW_COUNT;
  DELETE FROM public.check_in_room_logs WHERE check_in_id = ANY(${arr(CI)}); GET DIAGNOSTICS d_cirl=ROW_COUNT;
  DELETE FROM public.check_ins WHERE id = ANY(${arr(CI)}); GET DIAGNOSTICS d_ci=ROW_COUNT;
  DELETE FROM public.customers WHERE id = ANY(${arr(CUST)}); GET DIAGNOSTICS d_cust=ROW_COUNT;
  IF d_cust<>${EXPECT.customers} OR d_ci<>${EXPECT.check_ins} OR d_st<>${EXPECT.status_transitions}
     OR d_aa<>${EXPECT.assignment_actions} OR d_cirl<>${EXPECT.check_in_room_logs} THEN
    RAISE EXCEPTION 'POSTCHECK_MISMATCH cust=% ci=% st=% aa=% cirl=%', d_cust,d_ci,d_st,d_aa,d_cirl;
  END IF;
  RAISE EXCEPTION 'DRYRUN_OK_ABORT netloss cust=% ci=% st=% aa=% cirl=% total=%',
    d_cust,d_ci,d_st,d_aa,d_cirl,(d_cust+d_ci+d_st+d_aa+d_cirl);
END $t$;`;
const tr = await q(trialSql);
const okAbort = /DRYRUN_OK_ABORT/.test(tr.body);
console.log(`── (2) trial: ${okAbort ? '✅ ' + (tr.body.match(/DRYRUN_OK_ABORT[^"\\]*/) || [])[0] : '❌ ' + tr.body}`);

// (3) post-probe — 무영속 확증
const post = JSON.parse((await q(freezeCountSql)).body)[0];
const noPersist = JSON.stringify(post) === JSON.stringify(base);
console.log(`── (3) post-probe: ${JSON.stringify(post)} — 무영속=${noPersist ? '✅' : '❌ PERSISTED'}`);
process.exit(okAbort && noPersist ? 0 : 1);
