/**
 * T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY (consolidates PKG-REFUND-CREATEDBY-CAPTURE)
 *   supervisor MIG-GATE runner — DDL-ATOMIC v1.7 evidence.
 *   ① dryrun  : up.sql 본문 전체를 BEGIN…ROLLBACK(COMMIT→ROLLBACK) 무영속 실행 + pre/post-probe 컬럼 부재 재확인.
 *   ② apply   : up.sql 원본(BEGIN…COMMIT) 영속 적용.
 *   ③ postcheck: created_by(uuid)/FK(package_payments_created_by_fkey, SET NULL)/partial idx/RPC(created_by+auth.uid()+INSERT INTO package_payments) 실재 evidence.
 *
 * mode: node ...apply.mjs [dryrun|apply|postcheck]  (기본 dryrun)
 * prod=rxlomoozakkjesdqjtvd. DA CONSULT-REPLY GO(ADDITIVE) MSG-20260727-163332-xb8v. autonomy §3.1.
 */
import { readFileSync } from 'node:fs';
const DIR = '/Users/domas/GitHub/obliv-foot-crm';
const env = Object.fromEntries(readFileSync(`${DIR}/.env.local`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const UP = `${DIR}/supabase/migrations/20260727210000_foot_package_payments_created_by.sql`;

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}

async function probe() {
  const col = (await q(`SELECT count(*)::int n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='package_payments' AND column_name='created_by'`))[0].n;
  const idx = (await q(`SELECT count(*)::int n FROM pg_indexes
    WHERE schemaname='public' AND tablename='package_payments' AND indexname='idx_package_payments_created_by'`))[0].n;
  return { col, idx };
}

const mode = process.argv[2] || 'dryrun';
const up = readFileSync(UP, 'utf8');

if (mode === 'dryrun') {
  console.log('════ ① DRY-RUN (No-Persistence: COMMIT→ROLLBACK) ════');
  const pre = await probe();
  console.log('[pre] created_by col =', pre.col, '/ idx =', pre.idx, '(기대 0/0 = 미적용)');
  const body = up.replace(/\bCOMMIT\s*;/i, 'ROLLBACK;');
  await q(body); // 실패 시 throw = 파싱/의존성 오류 노출
  const post = await probe();
  console.log('[post-probe] ROLLBACK 후 col =', post.col, '/ idx =', post.idx, '(기대', pre.col, '/', pre.idx, '= 무영속)');
  if (post.col !== pre.col || post.idx !== pre.idx) throw new Error(`무영속 위반: pre=${JSON.stringify(pre)} post=${JSON.stringify(post)}`);
  console.log('DRY-RUN PASS — 전체 DDL 실행 성공 + 무영속.');
} else if (mode === 'apply') {
  console.log('════ ② APPLY (영속, BEGIN…COMMIT 원본) ════');
  await q(up);
  const p = await probe();
  console.log('적용 후 col =', p.col, '/ idx =', p.idx, '(기대 1/1)');
  if (p.col !== 1 || p.idx !== 1) throw new Error(`APPLY 검증 실패: ${JSON.stringify(p)}`);
  console.log('APPLY OK.');
} else if (mode === 'postcheck') {
  console.log('════ ③ POSTCHECK (evidence) ════');
  const col = await q(`SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='package_payments' AND column_name='created_by'`);
  const fk = await q(`SELECT tc.constraint_name, rc.delete_rule FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name
    WHERE tc.table_name='package_payments' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='created_by'`);
  const idx = await q(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename='package_payments' AND indexname='idx_package_payments_created_by'`);
  const rpc = await q(`SELECT count(*)::int n FROM pg_proc WHERE proname='refund_package_payment'
    AND prosrc LIKE '%created_by%' AND prosrc LIKE '%auth.uid()%' AND prosrc LIKE '%INSERT INTO package_payments%'`);
  console.log('col:', JSON.stringify(col));
  console.log('fk :', JSON.stringify(fk));
  console.log('idx:', JSON.stringify(idx));
  console.log('rpc created_by+auth.uid()+INSERT INTO package_payments 반영 =', rpc[0].n, '(기대 ≥1)');
  const ok = col[0]?.data_type === 'uuid'
    && fk[0]?.constraint_name === 'package_payments_created_by_fkey' && fk[0]?.delete_rule === 'SET NULL'
    && idx[0]?.indexname === 'idx_package_payments_created_by' && rpc[0].n >= 1;
  if (!ok) throw new Error('POSTCHECK FAIL');
  console.log('POSTCHECK PASS — col(uuid)/FK(SET NULL)/idx/RPC 전부 실재.');
}
