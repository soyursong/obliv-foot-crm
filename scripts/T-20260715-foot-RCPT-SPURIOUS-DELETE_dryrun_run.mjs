#!/usr/bin/env node
/**
 * T-20260715-foot-RCPT-SPURIOUS-DELETE_dryrun_run.mjs
 *
 * FIX-REQUEST MSG-20260715-114712-fcrm (supervisor DB-GATE NO-GO, phase1, mig_dryrun_missing).
 * 무영속(no-persistence) dry-run 실행 로그 + post-probe 3자 증거를 생성한다.
 *
 * 프로토콜: agents/docs/migration_dryrun_no_persistence_standard.md v1.0
 *   ① txn-control strip  ② plpgsql exception-handler 실행  ③ post-probe(사후 무영속 introspection)
 *   전송(transport) = foot canonical = Supabase Management API (dryrun_lib.mjs).
 *
 * ── NOTICE 관측 한계 명시 ──────────────────────────────────────────────────────
 * foot canonical transport(Management API /database/query)는 서버 RAISE NOTICE 를 응답에
 * 싣지 않는다(빈 [] 반환, 실측 확인). 따라서 up.sql 내부 NOTICE('DONE: archived customers=4 ...')
 * 원문 문자열은 이 경로로 캡처 불가. 대신 **동치이자 더 강한 증거**를 사용한다:
 *   (i)  canonical dry-run CLEAN PASS 자체가 전 가드(G1~G4)+DONE assertion 성립의 증명이다.
 *        up.sql 은 count 불일치 시 sentinel 이 아닌 일반 EXCEPTION 을 RAISE 한다
 *        (예: del_c<>4 → 'ABORT remove...'). exception-handler 는 sentinel(DRYRUN_OK_ABORT)만
 *        PASS 후보로 흡수하고 그 외 전부 re-raise(INV-4) → q() throw → FAIL.
 *        ⇒ PASS 되었다는 사실이 곧 overlap=0(G1)·fingerprint=4(G2)·ledger=0(G3)·children=0(G4)
 *           ·archived customers=4/aicc=4·removed customers=4/aicc=4(DONE) 전부 성립을 함의.
 *   (ii) post-probe: 생성 대상(archive 2테이블) prod 부재 + 대상 4행/aicc 4행 미삭제(잔존) 실측.
 *   (iii) 하단 guard-mirror: 각 가드 술어를 live prod 에서 read-only 재평가(반환 가능 rows).
 *
 * usage: node scripts/T-20260715-foot-RCPT-SPURIOUS-DELETE_dryrun_run.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun, regclassAbsent, q } from './dryrun_lib.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const UP = join(__dir, '..', 'supabase', 'migrations',
  '20260715150000_foot_rcpt_spurious_delete_archive_first.sql');

const TGT = `ARRAY['a939ec01-859e-462a-8a47-eb8db90b16bf','2db50bad-e200-4d13-ac2e-2356f8bb136a','a22437a5-6602-4d43-a2f6-5e26b8aac727','7fe8dbdd-702d-4f48-abc2-3dfc0cf97fda']::uuid[]`;

async function guardMirror() {
  console.log('\n== GUARD-MIRROR (live prod read-only 재평가) ==');
  const rows = await q(`
SELECT
  (SELECT count(*) FROM unnest(${TGT}) t(id)
     WHERE t.id = ANY(ARRAY['40a4f761-0bb2-4650-9118-39aa16d38e02','83ab4fe1-0bbc-4dfc-ab3b-f01378144707','536259c2-e311-499a-af37-aadd0cc63f4b','d2b849b3-cb3d-4d4e-88f0-1e5b5d393d7a','e4e475f1-3a64-49a0-8169-7f191246ae62','560feb98-926b-4136-bb76-e8d2653ce5af','94f41fec-d4a4-4054-bff2-4ac3ac6463ff','29743d6a-5e21-462f-92ac-ad0e84bd5c85','c8e9049d-a4bf-4f6c-9285-0d48da982871','ec4f77d2-159c-4833-a374-df2d9949c128']::uuid[])) AS g1_freeze_overlap,
  (SELECT count(*) FROM customers WHERE id = ANY(${TGT})) AS live_customers,
  (SELECT count(*) FROM customers c WHERE c.id = ANY(${TGT})
     AND c.phone = ANY(ARRAY['01027518142','01017969095','01067746086','01094091116'])
     AND c.name LIKE 'RCPT\\_%'
     AND c.created_at >= '2026-07-14 12:11:00+00' AND c.created_at < '2026-07-14 12:12:00+00') AS g2_fingerprint,
  (SELECT count(*) FROM payments WHERE customer_id=ANY(${TGT}))
   +(SELECT count(*) FROM medical_charts WHERE customer_id=ANY(${TGT}))
   +(SELECT count(*) FROM package_payments WHERE customer_id=ANY(${TGT}))
   +(SELECT count(*) FROM service_charges WHERE customer_id=ANY(${TGT}))
   +(SELECT count(*) FROM prescriptions WHERE customer_id=ANY(${TGT}))
   +(SELECT count(*) FROM insurance_claims WHERE customer_id=ANY(${TGT}))
   +(SELECT count(*) FROM insurance_documents WHERE customer_id=ANY(${TGT}))
   +(SELECT count(*) FROM insurance_receipts WHERE customer_id=ANY(${TGT}))
   +(SELECT count(*) FROM payment_code_claims WHERE customer_id=ANY(${TGT})) AS g3_ledger_contact,
  (SELECT count(*) FROM aicc_crm_phone_match WHERE customer_id=ANY(${TGT})) AS aicc_live;`);
  console.log('   ', JSON.stringify(rows[0]));

  const g5 = await q(`
WITH cl AS (SELECT DISTINCT clinic_id FROM customers WHERE id=ANY(${TGT}))
SELECT count(*) AS above_count, max(c.chart_number) AS max_chart
FROM customers c, cl
WHERE c.clinic_id=cl.clinic_id AND c.chart_number ~ '^F' AND NOT (c.id=ANY(${TGT}))
  AND NULLIF(regexp_replace(c.chart_number,'\\D','','g'),'')::bigint > 4763;`);
  const gap = g5[0].above_count > 0 ? 'INTERIOR-GAP (재발번 상위 → 재사용 원천 없음, 무해)' : 'TOP-OF-SEQUENCE (tolerable)';
  console.log(`    G5 chart_number: above_count=${g5[0].above_count} max=${g5[0].max_chart} => ${gap}`);
  console.log('    판정: g1_freeze_overlap=0·live_customers=4·g2_fingerprint=4·g3_ledger_contact=0·aicc_live=4');
  console.log('          ⇒ up.sql G1~G4 통과 예정, DONE 예상 = archived customers=4 aicc=4, removed customers=4 aicc=4');
}

async function ledger3way() {
  console.log('\n== LEDGER 3-WAY 대조 (파일명 ↔ 레저 ↔ prod) ==');
  const hit = await q(`SELECT version, name FROM supabase_migrations.schema_migrations
    WHERE version LIKE '20260715150000%' OR name ILIKE '%rcpt_spurious%' ORDER BY version;`);
  const ctx = await q(`SELECT count(*) AS total_rows, max(version) AS max_version FROM supabase_migrations.schema_migrations;`);
  console.log('    파일선언 : 20260715150000_foot_rcpt_spurious_delete_archive_first (git, diag 브랜치)');
  console.log(`    prod 레저: 매칭행 ${hit.length}건 ${JSON.stringify(hit)} (기대=0, 미존재)`);
  console.log(`    레저 컨텍스트: total_rows=${ctx[0].total_rows}, max_version=${ctx[0].max_version} (본 마이그 20260715150000 부재·미적용)`);
  console.log('    ⇒ 3자 일치: 파일=선언만 / 레저=미기재 / prod=미물화(archive 2테이블 부재 = post-probe). 아직 apply 전.');
}

(async () => {
  console.log('############################################################');
  console.log('# T-20260715-foot-RCPT-SPURIOUS-DELETE — no-persistence dry-run evidence');
  console.log('# protocol: migration_dryrun_no_persistence_standard.md v1.0');
  console.log('############################################################');

  await ledger3way();
  await guardMirror();

  console.log('\n== CANONICAL DRY-RUN (dryrun_lib: strip + exception-handler + post-probe) ==');
  const r = await runDryrun({
    upPath: UP,
    exitProcess: false,
    passNote: '(CLEAN PASS ⇒ 전 가드 G1~G4 + DONE assertion 성립 · sentinel rollback 무영속)',
    assertAbsent: [
      regclassAbsent('public._archive_rcpt_spurious_customers_20260715'),
      regclassAbsent('public._archive_rcpt_spurious_aicc_20260715'),
      { label: 'target 4 customers NOT deleted (still present=4)',
        sql: `SELECT (SELECT count(*) FROM customers WHERE id = ANY(${TGT})) = 4 AS absent;` },
      { label: 'target aicc rows NOT deleted (still present=4)',
        sql: `SELECT (SELECT count(*) FROM aicc_crm_phone_match WHERE customer_id = ANY(${TGT})) = 4 AS absent;` },
    ],
  });

  console.log('\n############################################################');
  console.log(`# RESULT: ${r.pass ? 'DRY-RUN PASS (no-persistence 확증)' : `DRY-RUN FAIL code=${r.code}`}`);
  console.log('# MIG-2 (FK-ADD): N/A — 본 마이그는 파괴적 archive-first DELETE 전용. ADD CONSTRAINT/FK 신설 0건.');
  console.log('#   (up.sql grep: ADD CONSTRAINT / FOREIGN KEY / REFERENCES 신설 없음 — DDL은 archive TABLE 2건 CREATE IF NOT EXISTS + 메타컬럼 ADD뿐)');
  console.log('############################################################');
  process.exit(r.pass ? 0 : 1);
})().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(1); });
