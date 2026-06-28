/**
 * T-20260530-supv-RRN-STAGE2-DUAL-KEY-FUNCS — STEP 5 사후검증 (foot)
 * supervisor MQ MSG-20260629-031030-ulu0 지정 (a)(b)(c).
 *
 * 데이터 보존 정책:
 *   - customers row 변경 0건 (모든 write 검증은 BEGIN..ROLLBACK).
 *   - (a) fallback_log 적재도 ROLLBACK → Stage5.1 "fallback_log 무발생 window" 게이트 오염 0.
 *     (적재 동작은 tx 내부에서 관측 후 폐기 — 메커니즘 입증만, 영속 audit row 미생성)
 *   - PHI 게이트 통과: request.jwt.claims sub=대상 clinic admin (SET LOCAL, tx 한정).
 *   - 평문 RRN 콘솔 미출력 (decrypt_ok boolean / 일치 boolean 만 보고).
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
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const c = conn(); await c.connect();
console.log('✅ DB 연결 (STEP 5 사후검증) [rxlomoozakkjesdqjtvd]', new Date().toISOString());

// 대상 동적 발굴: rrn_enc 보유 고객 3건 + 같은 clinic admin sub
const cust = (await c.query(`SELECT id, clinic_id FROM public.customers
  WHERE rrn_enc IS NOT NULL ORDER BY created_at LIMIT 3`)).rows;
const clinic = cust[0].clinic_id;
const admin = (await c.query(`SELECT id FROM public.user_profiles
  WHERE clinic_id=$1 AND role IN ('admin','manager','director') AND COALESCE(active,true)=true LIMIT 1`, [clinic])).rows[0];
const claims = JSON.stringify({ sub: admin.id, role: 'authenticated' });
console.log(`대상 고객 ${cust.length}건 / clinic ${clinic} / gate admin ${admin.id}`);

// ─── (a) 기존 구키 row 3건 decrypt → decrypt_ok + fallback_log 적재 (tx 내 관측 후 ROLLBACK) ───
let aRows = [], aFallbackCount = 0;
await c.query('BEGIN');
await c.query(`SELECT set_config('request.jwt.claims',$1,true)`, [claims]);
for (const r of cust) {
  const d = await c.query(`SELECT (public.rrn_decrypt($1) IS NOT NULL) AS decrypt_ok`, [r.id]);
  aRows.push({ id: r.id, decrypt_ok: d.rows[0].decrypt_ok });
}
aFallbackCount = (await c.query(`SELECT COUNT(*)::int AS n FROM public.rrn_decrypt_fallback_log`)).rows[0].n;
await c.query('ROLLBACK');   // fallback_log 적재 폐기 (무발생 window 보존)
console.log('\n[a] 구키 row dual-key fallback decrypt:');
console.table(aRows);
console.log(`    fallback_log 적재(tx 내 관측, ROLLBACK 폐기): ${aFallbackCount} row`);
const aOk = aRows.every(x => x.decrypt_ok) && aFallbackCount === cust.length;

// ─── (b) 신규 round-trip: encrypt(신키) → decrypt 일치, fallback 없음 (BEGIN..ROLLBACK) ───
const target = cust[0].id;
const SYN = '901101-1234567';
await c.query('BEGIN');
await c.query(`SELECT set_config('request.jwt.claims',$1,true)`, [claims]);
await c.query(`SELECT public.rrn_encrypt($1,$2)`, [target, SYN]);
const back = (await c.query(`SELECT (public.rrn_decrypt($1) = $2) AS roundtrip_ok`, [target, SYN])).rows[0].roundtrip_ok;
const ver = (await c.query(`SELECT rrn_encryption_version AS v FROM public.customers WHERE id=$1`, [target])).rows[0].v;
const resid = (await c.query(`SELECT resident_id FROM public.customers WHERE id=$1`, [target])).rows[0].resident_id;
const fbAfter = (await c.query(`SELECT COUNT(*)::int AS n FROM public.rrn_decrypt_fallback_log`)).rows[0].n;
await c.query('ROLLBACK');   // customers write 폐기 (row 변경 0건)
console.log('\n[b] 신규 round-trip (BEGIN..ROLLBACK, customers 변경 0건):');
console.log(`    rrn_encrypt→rrn_decrypt 일치: ${back} | version=${ver} (기대 2) | resident_id NULL: ${resid===null} | 신키직접복호 fallback_log 추가: ${fbAfter} (기대 0)`);
const bOk = back === true && ver === 2 && resid === null && fbAfter === 0;

// ─── (c) version 분포 (배포 직후 — 전건 1, 백필 STAGE 별도) ───
const dist = (await c.query(`SELECT rrn_encryption_version AS version, COUNT(*)::int AS n
  FROM public.customers WHERE rrn_enc IS NOT NULL GROUP BY 1 ORDER BY 1`)).rows;
console.log('\n[c] rrn_encryption_version 분포 (영속 상태):');
console.table(dist);
const cOk = dist.length === 1 && dist[0].version === 1;

// 영속 audit 무오염 재확인
const fbPersist = (await c.query(`SELECT COUNT(*)::int AS n FROM public.rrn_decrypt_fallback_log`)).rows[0].n;
console.log(`\nfallback_log 영속 row(검증 후, 기대 0): ${fbPersist}`);

await c.end();
const allOk = aOk && bOk && cOk && fbPersist === 0;
console.log('\n── STEP 5 결과 ──');
console.log(`(a) 구키 fallback decrypt: ${aOk ? 'PASS' : 'FAIL'}`);
console.log(`(b) 신규 round-trip:      ${bOk ? 'PASS' : 'FAIL'}`);
console.log(`(c) version 분포 전건 1:   ${cOk ? 'PASS' : 'FAIL'}`);
console.log(allOk ? '\n✅ STEP 5 전건 PASS (customers row 변경 0건, audit 무오염)' : '\n❌ STEP 5 일부 FAIL');
process.exit(allOk ? 0 : 2);
