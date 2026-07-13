/**
 * T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL — MUTATION dry-run (BEGIN..ROLLBACK, 무영속)
 *
 * DA carry-forward C6: dry-run PASS를 신뢰하지 말고 post-probe로 실영속을 독립 실측.
 *   migration_dryrun_no_persistence_standard §3 INV-3 / §6.
 *
 * 방식(sentinel-RAISE): forward 마이그(20260714020000)의 body를 그대로 실행하되
 *   - txn-control(BEGIN/COMMIT) strip
 *   - 최종 RAISE NOTICE → RAISE EXCEPTION 'DRYRUN_SENTINEL:{json}' 치환
 *   → 단일 API txn이 sentinel 예외로 전체 롤백(CREATE TABLE 3표 포함). 무영속.
 * post-probe: 5 targeted phantom 잔존 + row1(0356b229) held 잔존 + _backfill_* 3표 미생성 재확인
 *   → 실영속 0 독립실측. (재스코프 6→5: planner SPLIT MSG-20260714-020001-7xrp, row1 제외)
 *
 * ★ READ-EQUIVALENT (영속 0). 실 apply 아님. author: dev-foot / 2026-07-14
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN = (readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method:'POST', headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  return { ok: r.ok, text: t };
}

const mig = readFileSync('supabase/migrations/20260714020000_foot_customers_mask_contam_backfill.sql','utf8');

// txn-control strip + sentinel 치환
let body = mig
  .replace(/^\s*BEGIN;\s*$/m, '')
  .replace(/^\s*COMMIT;\s*$/m, '');
body = body.replace(
  /RAISE NOTICE 'BACKFILL_OK moved=% denorm_refreshed=% phantom_deleted=%',\s*\n\s*total_moved, denorm_ct, deleted_ct;/,
  `RAISE EXCEPTION 'DRYRUN_SENTINEL:{"moved":%,"denorm":%,"deleted":%}', total_moved, denorm_ct, deleted_ct;`
);
if (!body.includes('DRYRUN_SENTINEL')) { console.error('❌ sentinel 치환 실패 — 마이그 body 포맷 확인'); process.exit(1); }

console.log('── [1] MUTATION dry-run (sentinel-RAISE → 전체 롤백) ──');
const res = await q(body);
if (res.ok) {
  console.error('❌ 예상밖: sentinel 예외 없이 성공 — 영속 위험! 중단.');
  console.error(res.text.slice(0,500)); process.exit(1);
}
const m = res.text.match(/DRYRUN_SENTINEL:(\{.*?\})/);
if (m) {
  const summary = JSON.parse(m[1].replace(/\\"/g, '"'));
  console.log('  ✅ sentinel 롤백 확인. 시뮬 delta:', JSON.stringify(summary));
  console.log(`     FK 자식 이동(relink)=${summary.moved} · check_ins denorm refresh=${summary.denorm} · phantom 삭제=${summary.deleted}`);
} else {
  console.error('  ⚠ sentinel 미검출 — 실제 ABORT(불변식 위반) 가능. 에러 원문:');
  console.error(res.text.slice(0,800)); process.exit(1);
}

console.log('\n── [2] post-probe (실영속 독립 실측) ──');
// 재스코프 5건(targeted). sentinel 롤백이므로 실 apply 아니어도 모두 잔존해야(무영속).
const p1 = await q(`SELECT count(*) n FROM customers WHERE id IN (
  '512998d0-d51a-42c4-947e-b0cb2cc69da4',
  '67ea1793-05e5-4d4a-b5c1-1ec73486e317','bd307dfe-79f0-4fea-86a6-0957cea492cd',
  '44a6a076-ca66-458a-bdc5-e0a3a12c2e67','2dc21d1c-6e9f-4643-a733-dca92252d830');`);
const n1 = JSON.parse(p1.text)[0].n;
console.log(`  targeted 5건 잔존(무영속 기대=5): ${n1}  ${n1==5?'✅':'❌ 영속 발생!'}`);

// row1(0356b229) held-row: 본 배치가 절대 삭제 안 함 → 무조건 잔존해야
const p1b = await q(`SELECT count(*) n FROM customers WHERE id = '0356b229-e8c7-4655-aa6e-651b15370c1f';`);
const n1b = JSON.parse(p1b.text)[0].n;
console.log(`  row1(0356b229) held 잔존(기대=1, 절대 미삭제): ${n1b}  ${n1b==1?'✅':'❌ held-row 침범!'}`);

const p2 = await q(`SELECT count(*) n FROM information_schema.tables
  WHERE table_schema='public' AND table_name LIKE '_backfill_mask_contam_%';`);
const n2 = JSON.parse(p2.text)[0].n;
console.log(`  _backfill_mask_contam_* 표 생성(무영속 기대=0): ${n2}  ${n2==0?'✅':'❌ 영속 발생!'}`);

const ok = (n1==5 && n1b==1 && n2==0);
console.log('\nMUTATION_DRYRUN_RESULT:', JSON.stringify({
  scope: '5-row (row1 0356b229 held/excluded)',
  sentinel_rollback: !!m,
  persistence: ok ? 'NONE' : 'LEAKED',
  targeted_survive: n1, row1_held_survive: n1b, backfill_tables: n2,
}));
if (!ok) { console.error('❌ 영속/held침범 감지 — supervisor 통지 필요'); process.exit(1); }
console.log('✅ 무영속 확증 + row1 held 보전. mutation txn 리허설 PASS (실 apply=supervisor MIG-GATE).');
