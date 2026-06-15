/**
 * T-20260615-foot-PHI-ANON-GRANT-REVOKE-HARDENING — PROD APPLY + 검증
 * policy: "dev-foot DB 마이그레이션 직접 실행"(대시보드 수동 금지).
 * 흐름: PRE introspect(READ-ONLY) → 마이그 apply(파일 자체 BEGIN/COMMIT) →
 *       POST introspect + ground-truth 검증(anon SELECT 차단 / authenticated 유지 / 공개폼 회귀0).
 * 증빙: evidence/..._preapply_<ts>.txt / ..._postapply_<ts>.txt
 */
import pg from 'pg';
import fs from 'fs';
const ROOT = process.env.HOME + '/Documents/GitHub/obliv-foot-crm';
let P = process.env.SUPABASE_DB_PASSWORD;
for (const l of fs.readFileSync(ROOT + '/.env', 'utf8').split('\n')) {
  const m = l.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) P = m[1].trim();
}
const TABLES = ['insurance_claims','claim_items','insurance_claim_diagnoses','edi_submissions'];
// 공개폼(anon) 정상동작 회귀 가드용 — anon 경로가 실제 의존하는 대표 테이블
const PUBLIC_FORM_TABLES = ['reservations','customers'];
const TS = new Date().toISOString().replace(/[:.]/g,'').slice(0,15) + 'Z';

const c = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432,
  database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:P, ssl:{rejectUnauthorized:false} });

async function grants(client) {
  const gr = await client.query(
    `SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
       FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name = ANY($1)
        AND grantee IN ('anon','authenticated')
      GROUP BY table_name, grantee ORDER BY table_name, grantee`, [TABLES]);
  return gr.rows;
}
function fmt(rows, label) {
  let out = `=== ${label}  ${new Date().toISOString()} ===\n[grants anon/authenticated]\n`;
  for (const r of rows) out += `  ${r.table_name.padEnd(28)} ${r.grantee.padEnd(14)} ${r.privs}\n`;
  return out;
}

await c.connect();
console.log(`✅ PROD 연결 ${new Date().toISOString()}\n`);

// ── PRE ──────────────────────────────────────────────────────────────────────
const preRows = await grants(c);
const preOut = fmt(preRows, 'PRE-APPLY (READ-ONLY)');
fs.writeFileSync(`${ROOT}/evidence/T-20260615-foot-PHI-ANON-REVOKE_preapply_${TS}.txt`, preOut);
console.log(preOut);

// ── APPLY ────────────────────────────────────────────────────────────────────
const sql = fs.readFileSync(`${ROOT}/supabase/migrations/20260616010000_phi_anon_grant_revoke_hardening.sql`,'utf8');
console.log('▶ 마이그 적용… (per-table REVOKE ALL FROM anon, authenticated 유지)');
try { await c.query(sql); console.log('✅ COMMIT 완료\n'); }
catch(e){ console.error('❌ 적용 실패:', e.message); await c.end(); process.exit(1); }

// ── POST ─────────────────────────────────────────────────────────────────────
const postRows = await grants(c);
const postOut = fmt(postRows, 'POST-APPLY');
fs.writeFileSync(`${ROOT}/evidence/T-20260615-foot-PHI-ANON-REVOKE_postapply_${TS}.txt`, postOut);
console.log(postOut);

// ── ground-truth 검증 ──────────────────────────────────────────────────────────
// (1) anon: 4테이블 권한 0건 (모든 privilege REVOKE)
const anonPost = postRows.filter(r => r.grantee==='anon');
const anonZero = anonPost.length === 0;
// (2) authenticated: 4테이블 권한 유지 (RLS 게이트 보존)
const authPost = postRows.filter(r => r.grantee==='authenticated');
const authKept = authPost.length === TABLES.length && authPost.every(r => /SELECT/.test(r.privs));
// (3) anon SELECT 실제 차단 — has_table_privilege 직접 검증
let anonSelBlocked = true; const blkDetail = [];
for (const t of TABLES) {
  const q = await c.query(`SELECT has_table_privilege('anon', $1, 'SELECT') AS can`, [t]);
  const can = q.rows[0].can; if (can) anonSelBlocked = false;
  blkDetail.push(`${t}=${can?'CAN(❌)':'BLOCKED'}`);
}
// (4) 공개폼 회귀 0 — anon 경로 의존 테이블의 anon 권한이 본 마이그로 영향받지 않음(불변)
let publicFormOk = true; const pfDetail = [];
for (const t of PUBLIC_FORM_TABLES) {
  const sel = await c.query(`SELECT has_table_privilege('anon', $1, 'SELECT') AS s,
                                    has_table_privilege('anon', $1, 'INSERT') AS i`, [t]);
  pfDetail.push(`${t}: anon SELECT=${sel.rows[0].s} INSERT=${sel.rows[0].i}`);
}
// reservations anon INSERT(공개 예약폼 핵심 경로) 보존 확인
const resvInsert = await c.query(`SELECT has_table_privilege('anon','reservations','INSERT') AS i`);
publicFormOk = resvInsert.rows[0].i === true;

const checks = [
  ['AC1 anon 4테이블 table-level 권한 0건', anonZero],
  ['AC2 authenticated 4테이블 권한 유지(RLS 게이트 보존)', authKept],
  [`AC3 anon SELECT 실차단 [${blkDetail.join(' ')}]`, anonSelBlocked],
  [`AC4 공개폼 회귀0(reservations anon INSERT 보존)`, publicFormOk],
];
console.log('═══ ground-truth 검증 ═══');
let allPass = true;
for (const [n,ok] of checks){ console.log(`  ${ok?'✅':'❌'} ${n}`); if(!ok) allPass=false; }
console.log('\n[공개폼 anon 경로 현황]'); for (const d of pfDetail) console.log(`  ${d}`);
console.log(`\n${allPass?'🟢 ALL PASS':'🔴 FAIL 존재'}`);

await c.end();
process.exit(allPass ? 0 : 2);
