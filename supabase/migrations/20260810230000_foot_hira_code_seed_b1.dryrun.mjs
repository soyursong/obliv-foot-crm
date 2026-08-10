/**
 * T-20260810-foot-INS-HIRACODE-SEED (B-1) — DRY-RUN (No-Persistence Protocol)
 * 급여 수가코드 시드 마이그를 트랜잭션 안에서 적용 → BEFORE/AFTER 검증 → 강제 ROLLBACK (영속 변경 0).
 * 실제 prod 적용은 supervisor DB-GATE GO-token 이후에만 (apply_before_go 클래스 — GO-token 前 prod 선집행 금지).
 *
 * 실행: SUPABASE_DB_PASSWORD 환경변수 필요 (supervisor DB-GATE 보유).
 *   SUPABASE_DB_PASSWORD=... node supabase/migrations/20260810230000_foot_hira_code_seed_b1.dryrun.mjs
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 없음 (supervisor DB-GATE 에서 실행).'); process.exit(2); }

const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ DB 연결  ${new Date().toISOString()}  (DRY-RUN — 끝에서 ROLLBACK)\n`);

const TARGETS = [
  { id: 'de611ed5-154a-475d-9eb3-19d6d3bad881', code: 'AA154', name: '초진진찰료-의원' },
  { id: '117befad-e8f8-48c6-b496-89c37a68a441', code: 'AA254', name: '재진진찰료-의원' },
  { id: '1a82c70a-07fe-4321-be44-8a206e3d1aa0', code: 'AA222', name: '재진-물리치료,주사 등' },
  { id: '03189fa2-0536-4676-bc5d-ad5283a48a0c', code: 'M0111', name: '단순처치 [1일]' },
];
const BLOCK = { id: '8e401f7f-6746-4807-9366-4e1d9cfb1e7d', code: 'D620300HZ', name: '일반진균검사-KOH도말-조갑조직' };
const ids = [...TARGETS.map(t => t.id), BLOCK.id];

const dump = async (label) => {
  const r = await client.query(
    `SELECT id, name, service_code, hira_code, hira_score FROM public.services WHERE id = ANY($1::uuid[]) ORDER BY service_code`, [ids]);
  console.log(`── ${label} ──`);
  for (const s of r.rows) console.log(`  ${s.service_code}  hira_code=${JSON.stringify(s.hira_code)}  score=${s.hira_score}  | ${s.name}`);
  return r.rows;
};

const before = await dump('BEFORE');
const migPath = 'supabase/migrations/20260810230000_foot_hira_code_seed_b1.sql';
const sql = fs.readFileSync(migPath, 'utf8').split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

let ok = true;
try {
  await client.query('BEGIN');
  await client.query(sql);
  console.log('');
  const after = await dump('AFTER ');
  const byId = Object.fromEntries(after.map(r => [r.id, r]));

  // 검증 1: 4종 grounded 는 hira_code == service_code == 기대코드
  for (const t of TARGETS) {
    const row = byId[t.id];
    const pass = row && row.hira_code === t.code && row.service_code === t.code;
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${t.name}: hira_code=${row?.hira_code} (기대 ${t.code})`);
    if (!pass) ok = false;
  }
  // 검증 2: BLOCK(KOH) 은 여전히 NULL (미시드)
  const blk = byId[BLOCK.id];
  const blkPass = blk && blk.hira_code === null;
  console.log(`  [${blkPass ? 'PASS' : 'FAIL'}] BLOCK ${BLOCK.name}: hira_code=${JSON.stringify(blk?.hira_code)} (기대 null — 미접지 제외)`);
  if (!blkPass) ok = false;

  // 검증 3: 영향 행 수 == 4 (before 에 이미 non-null 이었던 것 제외)
  const changed = TARGETS.filter(t => before.find(b => b.id === t.id)?.hira_code === null).length;
  console.log(`  대상 UPDATE 예상행수 = ${changed} (BEFORE NULL 기준)`);
} catch (e) {
  ok = false; console.error('❌ 예외:', e.message);
} finally {
  await client.query('ROLLBACK');
  console.log('\n↩️  ROLLBACK 완료 — prod 영속 변경 0');
  await client.end();
}
console.log(`\n${ok ? '✅ DRY-RUN PASS' : '❌ DRY-RUN FAIL'}`);
process.exit(ok ? 0 : 1);
