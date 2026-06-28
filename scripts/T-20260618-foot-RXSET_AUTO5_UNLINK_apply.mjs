/**
 * T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — AC-6c AUTO5 UNLINK APPLY (무손실 롤백)
 *
 * 판정 근거(3key_재검증 report): 5쌍 모두 CODE_ONE_SIDE.
 *   service.service_code(실 품목/약가코드 존재) ↔ pc.claim_code=LEGACY-*(custom 플레이스홀더, 실코드 부재)
 *   → 3-key (상품명,성분명,코드) 코드 동일 미확증. 06-18 연결은 name-only(NORM-EXACT)였음.
 *   → 대표원장 확정 규칙(코드 다르면 별도 row, auto-merge 금지) 적용 → service_id NULL 롤백.
 *
 * 무손실: 실행 전 현재 service_id 를 *_UNLINK_capture.json 에 캡처(재연결 1:1 복원 가능).
 * 실행: node ..._AUTO5_UNLINK_apply.mjs --confirm-unlink   (플래그 없으면 dry-run)
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
const doUnlink = process.argv.slice(2).includes('--confirm-unlink');
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const c = conn(); await c.connect();
console.log(`✅ DB 연결 (AUTO5 UNLINK ${doUnlink ? 'APPLY' : 'DRY-RUN'})`, new Date().toISOString(), '\n');

// 현재 연결 상태 캡처(무손실 복원용)
const before = (await c.query(
  `SELECT pc.id pc_id, pc.name_ko, pc.service_id, s.name svc_name, s.service_code
   FROM prescription_codes pc JOIN services s ON s.id=pc.service_id
   WHERE pc.service_id IS NOT NULL ORDER BY s.name`)).rows;

console.log(`── 대상(현재 연결): ${before.length}쌍 ──`);
for (const r of before) console.log(`  pc[${r.pc_id.slice(0,8)}] "${r.name_ko}" → svc "${r.svc_name}" (service_code=${r.service_code})`);

if (!doUnlink) {
  console.log('\nℹ️  DRY-RUN. 데이터 무변경. 본실행: --confirm-unlink');
  await c.end(); process.exit(0);
}

// 캡처 저장
const capPath = 'scripts/T-20260618-foot-RXSET_AUTO5_UNLINK_capture.json';
fs.writeFileSync(capPath, JSON.stringify({ captured: new Date().toISOString(),
  restore_hint: '복원: 각 pc_id 에 service_id 를 다시 set (UPDATE prescription_codes SET service_id=<svc> WHERE id=<pc>)',
  rows: before.map(r => ({ pc_id: r.pc_id, name_ko: r.name_ko, prior_service_id: r.service_id, svc_name: r.svc_name })) }, null, 2));
console.log(`\n📄 무손실 캡처 저장: ${capPath}`);

// UNLINK 실행 (정확히 캡처된 pc_id 만)
let n = 0;
for (const r of before) {
  const res = await c.query(
    `UPDATE prescription_codes SET service_id=NULL WHERE id=$1 AND service_id=$2`, [r.pc_id, r.service_id]);
  n += res.rowCount;
  console.log(`  ✂️  UNLINK pc "${r.name_ko}" (rows=${res.rowCount})`);
}

const after = (await c.query(`SELECT count(*)::int n FROM prescription_codes WHERE service_id IS NOT NULL`)).rows[0].n;
console.log(`\n── 결과: UNLINK ${n}건 / 잔여 연결 ${after}건 ──`);
console.log(after === 0 ? '✅ AUTO5 전부 해제 완료(무손실, 캡처로 복원가능)' : `⚠️ 잔여 ${after}건 — 확인 필요`);
await c.end();
