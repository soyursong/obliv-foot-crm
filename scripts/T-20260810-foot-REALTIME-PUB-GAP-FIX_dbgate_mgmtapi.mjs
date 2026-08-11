/**
 * T-20260810-foot-REALTIME-PUB-GAP-FIX — supervisor DB-GATE
 *   (1) DDL-diff (prod introspection: publication membership + relreplident baseline)
 *   (2) Dry-Run No-Persistence (canary ROLLBACK 실효 선증명 → dryrun.sql sentinel → post-probe 무영속)
 *
 * Management API `/database/query` (ref rxlomoozakkjesdqjtvd), SUPABASE_ACCESS_TOKEN only. write 0.
 * 사용: node scripts/T-20260810-foot-REALTIME-PUB-GAP-FIX_dbgate_mgmtapi.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const CANARY = '__DRYRUN_CANARY_T20260810_REALTIME__';

// DA 확정 스코프
const M_GAP_ADD = ['payments','package_payments','closing_manual_payments','duty_roster','clinic_doctors',
  'redpay_raw_transactions','pending_payment','assignment_actions','staff_temp_off','rooms','check_in_room_logs'];
const FULL_FLIP = ['check_ins','reservations','room_assignments','closing_manual_payments','duty_roster'];
const ALL16 = ['check_ins','reservations','room_assignments','timer_records','waiting_board',
  ...M_GAP_ADD].filter((v,i,a)=>a.indexOf(v)===i);
const EXPECTED_BASE_MEMBERS = ['check_ins','reservations','room_assignments','timer_records','waiting_board'].sort();

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local','utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g,'');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method:'POST', headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  return { ok:r.ok, status:r.status, text };
}
async function qj(sql){ const r=await q(sql); if(!r.ok) throw new Error(`HTTP ${r.status}: ${r.text}`); return JSON.parse(r.text); }

const members = async () => (await qj(
  `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' ORDER BY tablename`
)).map(x=>x.tablename);
const replident = async () => (await qj(
  `SELECT c.relname, c.relreplident FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname = ANY(ARRAY[${ALL16.map(t=>`'${t}'`).join(',')}]) ORDER BY c.relname`
));

const evidence = { ticket:'T-20260810-foot-REALTIME-PUB-GAP-FIX', ref:REF, ts:new Date().toISOString(), steps:{} };
let ok = true;
try {
  console.log(`✅ Management API 연결(${REF}) — supervisor DB-GATE (write 0)\n`);

  // ── (1) DDL-diff: baseline 실측 ──
  const baseMembers = await members();
  const baseRI = await replident();
  const baseMembersSorted = [...baseMembers].sort();
  const memberBaselineOK = JSON.stringify(baseMembersSorted) === JSON.stringify(EXPECTED_BASE_MEMBERS);
  const riAllDefault = baseRI.every(r => r.relreplident === 'd');
  evidence.steps.ddl_diff = { baseline_members: baseMembers, expected_base_members: EXPECTED_BASE_MEMBERS,
    member_baseline_match: memberBaselineOK, replident_rows: baseRI, all_default: riAllDefault };
  console.log('── (1) DDL-diff baseline ──');
  console.log(`   membership(${baseMembers.length}): ${baseMembers.join(', ')}`);
  console.log(`   baseline 5멤버 일치: ${memberBaselineOK ? '✅' : '❌ '+JSON.stringify(baseMembersSorted)}`);
  console.log(`   relreplident 전건 DEFAULT('d'): ${riAllDefault ? '✅' : '❌ '+JSON.stringify(baseRI.filter(r=>r.relreplident!=='d'))}`);
  // 마이그가 ADD 할 11개가 현재 전부 비멤버인지
  const alreadyMember = M_GAP_ADD.filter(t => baseMembers.includes(t));
  const addNoop = alreadyMember.length === 0;
  evidence.steps.ddl_diff.add11_all_nonmember = addNoop;
  evidence.steps.ddl_diff.add11_already_member = alreadyMember;
  console.log(`   ADD 대상 11개 전부 비멤버: ${addNoop ? '✅' : '⚠ 이미멤버: '+alreadyMember.join(',')}`);
  // FULL flip 5개가 현재 전부 'd'(flip 필요)인지 + room_assignments 는 이미 멤버
  const flipTargetsD = FULL_FLIP.every(t => (baseRI.find(r=>r.relname===t)||{}).relreplident === 'd');
  console.log(`   FULL flip 5개 현재 DEFAULT(flip 유효): ${flipTargetsD ? '✅' : '❌'}`);
  console.log(`   room_assignments 이미 멤버(ADD 불요·flip only): ${baseMembers.includes('room_assignments') ? '✅' : '❌'}\n`);
  if (!memberBaselineOK || !riAllDefault) throw new Error('DDL-diff baseline ≠ DA dispositive prod 실측 — 스코프 재검 필요(fail-closed)');

  // ── (2) canary: ROLLBACK 실효 선증명 (무해 가역변경) ──
  await q(`BEGIN;\nCOMMENT ON TABLE public.check_ins IS '${CANARY}';\nROLLBACK;`);
  const afterCanary = await qj(`SELECT obj_description('public.check_ins'::regclass) AS c`);
  const canaryPersisted = (afterCanary[0]?.c || '') === CANARY;
  evidence.steps.canary = { persisted: canaryPersisted };
  console.log(`── (2) canary ROLLBACK 실효: ${canaryPersisted ? '❌ 잔존(autocommit — ABORT)' : '✅ 미잔존(ROLLBACK 실효)'}`);
  if (canaryPersisted) throw new Error('CANARY_PERSISTED — ROLLBACK 무영속 보장 실패');

  // ── (3) dryrun.sql sentinel (DO 블록 RAISE EXCEPTION 자체 abort = 무영속) ──
  const dryrun = fs.readFileSync('supabase/migrations/20260810240000_foot_realtime_pub_gap_fix.dryrun.sql','utf8');
  const dr = await q(dryrun);
  const sentinel = (dr.text.match(/DRYRUN_OK pub_added=(\d+) full_cnt=(\d+)/) || []);
  const pub_added = sentinel[1] ? parseInt(sentinel[1]) : null;
  const full_cnt  = sentinel[2] ? parseInt(sentinel[2]) : null;
  const sentinelOK = pub_added === 11 && full_cnt === 5;
  evidence.steps.dryrun = { raw: dr.text.slice(0,500), pub_added, full_cnt, expected:'11/5', match: sentinelOK };
  console.log(`── (3) dryrun sentinel: pub_added=${pub_added} full_cnt=${full_cnt} (expected 11/5) → ${sentinelOK?'✅':'❌'}`);
  if (!sentinelOK) throw new Error(`dryrun sentinel 불일치: pub_added=${pub_added} full_cnt=${full_cnt}`);

  // ── (4) post-probe: 무영속 확증 (baseline 원상 복귀) ──
  const postMembers = (await members()).sort();
  const postRI = await replident();
  const postMemberSame = JSON.stringify(postMembers) === JSON.stringify(baseMembersSorted);
  const postAllDefault = postRI.every(r => r.relreplident === 'd');
  evidence.steps.post_probe = { members: postMembers, member_unchanged: postMemberSame,
    all_default: postAllDefault };
  console.log(`── (4) post-probe 무영속:`);
  console.log(`   membership 원상(${postMembers.length}·baseline 동일): ${postMemberSame ? '✅' : '❌ '+postMembers.join(',')}`);
  console.log(`   relreplident 전건 DEFAULT 원상: ${postAllDefault ? '✅' : '❌ PERSISTED(사고)'}`);
  if (!postMemberSame || !postAllDefault) throw new Error('POST-PROBE PERSISTED — dryrun 이 prod 영속(사고)');

  evidence.verdict = 'PASS';
  console.log('\n✅ DDL-diff + Dry-Run No-Persistence PASS');
} catch (e) {
  ok = false; evidence.verdict = 'FAIL'; evidence.error = e.message;
  console.error('\n❌ DB-GATE 실패:', e.message);
} finally {
  const out = `../claude-sync/memory/_handoff/db-gate/T-20260810-foot-REALTIME-PUB-GAP-FIX_dbgate-evidence.json`;
  try { fs.writeFileSync(new URL(out, `file://${process.cwd()}/`), JSON.stringify(evidence,null,2)+'\n'); } catch(_){}
  fs.writeFileSync('/tmp/foot_realtime_dbgate_evidence.json', JSON.stringify(evidence,null,2)+'\n');
  console.log(`\nevidence → /tmp/foot_realtime_dbgate_evidence.json`);
  process.exit(ok ? 0 : 1);
}
