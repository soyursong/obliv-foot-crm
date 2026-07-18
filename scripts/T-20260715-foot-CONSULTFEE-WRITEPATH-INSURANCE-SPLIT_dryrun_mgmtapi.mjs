/**
 * T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT — 마이그레이션 DRY-RUN (Management API 경로)
 *   (원격 pooler DB_PASSWORD 부재 환경용 무영속 실행체 — T-20260713-foot-UNAUTH-WSA 패턴 재사용)
 *
 * 목적: prod 실제 스키마에 마이그레이션 구문을 무영속(no-persistence)으로 적용 확증.
 *   - 시크릿: SUPABASE_ACCESS_TOKEN(sbp_…, Management API) 만 사용. pooler DB 비밀번호 불요.
 *   - 무영속 다중 안전 (Migration Dry-Run No-Persistence Protocol):
 *       (0) baseline    : 신규 오브젝트(컬럼 2·RPC 1) 무존재 확인.
 *       (1) canary      : BEGIN; COMMENT …='__CANARY__'; ROLLBACK; → ROLLBACK 실효 선증명(autocommit 차단).
 *       (2) apply+verify: BEGIN; <txn-control strip 마이그>; SELECT <형상검증>; ROLLBACK; (마지막 SELECT 결과 회수).
 *       (3) idempotent  : BEGIN; <마이그 x2>; SELECT 1; ROLLBACK; → 재적용 무오류(IF NOT EXISTS/DROP+CREATE).
 *       (4) post-probe  : 신규 오브젝트 재확인 → 무존재여야 무영속 확증(sentinel-bypass 차단).
 * 사용: SUPABASE_ACCESS_TOKEN=… node scripts/T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT_dryrun_mgmtapi.mjs
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const CANARY = '__DRYRUN_CANARY_T20260715_CONSULTFEE__';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

// txn-control strip — 내장 BEGIN;/COMMIT; 만 제거(plpgsql 블록 BEGIN 은 세미콜론 없어 보존).
const rawMig = fs.readFileSync(
  'supabase/migrations/20260715160000_foot_consultfee_writepath_insurance.sql', 'utf8');
const mig = rawMig.split('\n').filter((l) => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

const PRESENCE = `SELECT
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='service_charge_id') AS pay_col,
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='service_charges' AND column_name='hira_unit_value_year') AS sc_col,
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='record_insurance_consult_payment') AS rpc`;

const VERIFY = `SELECT
  (SELECT count(*)::int FROM information_schema.columns WHERE table_name='payments' AND column_name='service_charge_id')=1 AS pay_col,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='payments' AND column_name='service_charge_id')='YES' AS pay_col_nullable,
  (SELECT column_default FROM information_schema.columns WHERE table_name='payments' AND column_name='service_charge_id') IS NULL AS pay_col_nodefault,
  (SELECT count(*)::int FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name WHERE tc.table_name='payments' AND tc.constraint_type='FOREIGN KEY' AND ccu.table_name='service_charges')>=1 AS fk_dir,
  (SELECT count(*)::int FROM information_schema.columns WHERE table_name='service_charges' AND column_name='hira_unit_value_year')=1 AS sc_col,
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='record_insurance_consult_payment')=1 AS rpc,
  (SELECT count(*)::int FROM information_schema.role_routine_grants WHERE routine_name='record_insurance_consult_payment' AND grantee='authenticated' AND privilege_type='EXECUTE')>=1 AS rpc_grant`;

let ok = true;
const chk = (cond, label) => { console.log(`  ${cond ? '✅' : '❌'} ${label}`); if (!cond) ok = false; };

try {
  console.log(`✅ Management API 연결(${REF}) — DRY-RUN, 무영속\n`);

  // (0) baseline
  const b = (await q(PRESENCE))[0];
  console.log(`── (0) baseline: pay_col=${b.pay_col} sc_col=${b.sc_col} rpc=${b.rpc} (전부 0 기대)`);
  chk(b.pay_col === 0 && b.sc_col === 0 && b.rpc === 0, 'baseline 신규 오브젝트 무존재');

  // (1) canary — ROLLBACK 실효 선증명
  await q(`BEGIN;\nCOMMENT ON TABLE public.payments IS '${CANARY}';\nROLLBACK;`);
  const cRow = (await q(`SELECT obj_description('public.payments'::regclass) AS c`))[0];
  chk((cRow?.c || '') !== CANARY, 'canary 미잔존 (ROLLBACK 실효 — autocommit 아님)');
  if ((cRow?.c || '') === CANARY) throw new Error('CANARY_PERSISTED — 무영속 보장 실패, 실 DDL 미실행 중단');

  // (2) apply + verify (마지막 SELECT 결과 회수, 트랜잭션 내 형상검증 후 ROLLBACK)
  console.log('\n── (2) apply + 형상검증 (BEGIN; mig; VERIFY; ROLLBACK) ──');
  const v = (await q(`BEGIN;\n${mig}\n;${VERIFY};\nROLLBACK;`))[0];
  chk(v.pay_col, 'payments.service_charge_id 컬럼 생성');
  chk(v.pay_col_nullable, 'service_charge_id nullable (ADDITIVE)');
  chk(v.pay_col_nodefault, 'service_charge_id no-default (ADDITIVE)');
  chk(v.fk_dir, 'payments.service_charge_id → service_charges FK 방향');
  chk(v.sc_col, 'service_charges.hira_unit_value_year 컬럼 생성');
  chk(v.rpc, 'record_insurance_consult_payment RPC 생성');
  chk(v.rpc_grant, 'RPC authenticated EXECUTE grant');

  // (3) idempotent 재적용
  console.log('\n── (3) idempotent 재적용 ──');
  await q(`BEGIN;\n${mig}\n;${mig}\n;SELECT 1;\nROLLBACK;`);
  chk(true, '재적용 무오류 (IF NOT EXISTS / DROP+CREATE)');
} catch (e) {
  ok = false;
  console.error('❌ DRY-RUN 실패:', e.message);
} finally {
  // (4) post-probe — 무영속 확증
  const p = (await q(PRESENCE))[0];
  console.log(`\n── (4) post-probe: pay_col=${p.pay_col} sc_col=${p.sc_col} rpc=${p.rpc} (전부 0 기대) ──`);
  const noPersist = p.pay_col === 0 && p.sc_col === 0 && p.rpc === 0;
  chk(noPersist, '무영속 확증 (신규 오브젝트 prod 미잔존)');
  console.log(`\n${ok && noPersist ? '✅ DRY-RUN PASS — ADDITIVE 형상 검증 + 무영속 확증' : '❌ DRY-RUN FAIL'}`);
  process.exit(ok && noPersist ? 0 : 1);
}
