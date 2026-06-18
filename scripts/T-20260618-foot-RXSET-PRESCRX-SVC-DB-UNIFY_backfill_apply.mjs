/**
 * T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — BACKFILL APPLY (GATED)
 *
 * ⚠️ 사람확인(planner/supervisor) 게이트 통과 전 실행 금지 (티켓 AC-1 모호건 사람확인 원칙).
 *    실행하려면 명시 플래그 필요:
 *      node ..._backfill_apply.mjs --confirm-auto          # AUTO(정규화 정확 1:1) 5건만 set
 *      node ..._backfill_apply.mjs --confirm-auto --confirm-review   # AUTO + REVIEW(퍼지 6건) 함께 set
 *    플래그 없이 실행 시 = dry-run 재출력만(데이터 무변경).
 *
 * 매핑 출처: scripts/T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY_backfill_mapping.json
 *   (= _backfill_dryrun.mjs 산출. AUTO=5, REVIEW=6, NONE=10).
 * set 방향: prescription_codes.service_id = 대응 services.id (FK→services).
 * 멱등: service_id 가 이미 동일값이면 skip. 다른값이면 경고(수동검토).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
const args = process.argv.slice(2);
const doAuto = args.includes('--confirm-auto');
const doReview = args.includes('--confirm-review');

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const map = JSON.parse(fs.readFileSync('scripts/T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY_backfill_mapping.json', 'utf8'));

if (!doAuto && !doReview) {
  console.log('ℹ️  DRY-RUN (플래그 없음). 데이터 무변경.');
  console.log(`   AUTO ${map.auto.length}건 / REVIEW ${map.review.length}건 / NONE ${map.none.length}건`);
  console.log('   본적용: --confirm-auto [--confirm-review]');
  process.exit(0);
}

// 적용 대상 조립: AUTO 는 1:1, REVIEW 는 후보 1건짜리(용량표기 차이)만 자동 채택 — 다중후보는 수동.
const targets = [];
if (doAuto) for (const a of map.auto) targets.push({ svc: a.svc, pcId: a.pc.id, pcName: a.pc.name_ko, src: 'AUTO' });
if (doReview) for (const r of map.review) {
  if (r.candidates.length === 1) targets.push({ svc: r.svc, pcId: r.candidates[0].id, pcName: r.candidates[0].name_ko, src: 'REVIEW' });
  else console.log(`⏭  REVIEW 다중후보 수동필요 — svc "${r.svc.name}" (${r.candidates.length}건)`);
}

const c = conn(); await c.connect();
console.log('✅ DB 연결 (BACKFILL APPLY)', new Date().toISOString(), '\n');
let set=0, skip=0, conflict=0;
for (const t of targets) {
  const cur = await c.query(`SELECT service_id FROM prescription_codes WHERE id=$1`, [t.pcId]);
  const existing = cur.rows[0]?.service_id;
  if (existing === t.svc.id) { skip++; console.log(`⏭  SKIP (이미 연결) pc "${t.pcName}"`); continue; }
  if (existing && existing !== t.svc.id) { conflict++; console.log(`⚠️  CONFLICT pc "${t.pcName}" 이미 다른 service_id=${existing} — 수동검토`); continue; }
  await c.query(`UPDATE prescription_codes SET service_id=$1 WHERE id=$2`, [t.svc.id, t.pcId]);
  set++; console.log(`✅ SET [${t.src}] pc "${t.pcName}" → svc "${t.svc.name}"`);
}
console.log(`\n── 결과: SET ${set} / SKIP ${skip} / CONFLICT ${conflict} ──`);

const v = await c.query(`SELECT count(*)::int n FROM v_foot_drug_master WHERE has_hira_link`);
console.log(`v_foot_drug_master has_hira_link=true: ${v.rows[0].n}`);
await c.end();
