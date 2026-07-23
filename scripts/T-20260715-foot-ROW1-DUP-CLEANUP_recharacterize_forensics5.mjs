#!/usr/bin/env node
/** 재특성화 phase5 — DUMMY placeholder 확정 + 발생기(trigger/cron) 규명 (READ-ONLY, 평문 0). */
import { q } from './dryrun_lib.mjs';
const ROW1='0356b229-e8c7-4655-aa6e-651b15370c1f', RAW='c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b';
const out={};

// 1. ROW1/RAW phone = 'DUMMY-<uuid>' 확정 (평문 대신 prefix/uuid-shape 만)
out.dummy_confirm = await q(`
  SELECT CASE id::text WHEN '${ROW1}' THEN 'ROW1' ELSE 'RAW' END AS label,
    (phone LIKE 'DUMMY-%') AS is_dummy_prefix,
    (substring(phone from 7) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') AS tail_is_uuid,
    (SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='phone_dummy') AS has_dummy_col
  FROM customers WHERE id IN ('${ROW1}','${RAW}');`);

// phone_dummy 파생 플래그 (컬럼 있으면)
out.phone_dummy_flag = await q(`
  SELECT CASE id::text WHEN '${ROW1}' THEN 'ROW1' ELSE 'RAW' END AS label, phone_dummy
  FROM customers WHERE id IN ('${ROW1}','${RAW}');`).catch(e=>({error:String(e.message||e)}));

// 2. DUMMY 발생 트리거/함수 존재 여부
out.dummy_generators = await q(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND (p.proname ~* 'dummy' OR pg_get_functiondef(p.oid) ~* 'DUMMY-' )
  ORDER BY 1;`);
out.dummy_triggers = await q(`
  SELECT t.tgname, c.relname AS tbl, pr.proname AS fn
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_proc pr ON pr.oid=t.tgfoid
  WHERE NOT t.tgisinternal AND c.relname='customers' ORDER BY 1;`);

// 3. pg_cron 잡 (반복 dummy/scrub 스케줄?)
out.cron_jobs = await q(`SELECT jobid, schedule, jobname, left(command,120) AS command FROM cron.job ORDER BY jobid;`).catch(e=>({error:String(e.message||e)}));

// 4. 07-18 batch 3행 & 07-22 batch 8행이 dummy 직전 무슨 phone 이었나 → rollback/backfill 아티팩트 실재?
out.dummy_backup_tables = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND (table_name ~* 'dummy' OR table_name ~* 'placeholder' OR table_name ~* 'phone_norm')
  ORDER BY 1;`);

// 5. 07-18/07-22 코호트 = 마스킹서명 보유 행이었나 (name masked 또는 rrn 보유 실환자?)
out.batch_cohort_profile = await q(`
  SELECT updated_at::date AS batch, count(*) AS n,
    count(*) FILTER (WHERE rrn_enc IS NOT NULL) AS with_rrn,
    count(*) FILTER (WHERE name ~ '\\*') AS name_masked,
    count(*) FILTER (WHERE is_simulation) AS sim,
    count(*) FILTER (WHERE is_foreign) AS foreign_
  FROM customers
  WHERE clinic_id=(SELECT clinic_id FROM customers WHERE id='${ROW1}')
    AND phone LIKE 'DUMMY-%'
  GROUP BY 1 ORDER BY 1;`);

// 6. 동일인 축 재확정: ROW1 vs RAW name_hash/stem/rrn_hash (off-git 대조)
out.identity_axes = await q(`
  SELECT CASE id::text WHEN '${ROW1}' THEN 'ROW1' ELSE 'RAW' END AS label,
    md5(coalesce(name,'')) AS name_hash,
    md5(coalesce(encode(rrn_enc,'hex'),'')) AS rrn_enc_md5,
    (rrn_enc IS NOT NULL) AS has_rrn,
    rrn_encryption_version, (rrn_re_encrypted_at IS NOT NULL) AS re_encd, resident_id IS NOT NULL AS has_resident
  FROM customers WHERE id IN ('${ROW1}','${RAW}');`).catch(e=>({error:String(e.message||e)}));

console.log(JSON.stringify(out,null,2));
