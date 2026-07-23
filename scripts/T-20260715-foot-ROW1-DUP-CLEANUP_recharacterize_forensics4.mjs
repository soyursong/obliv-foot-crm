#!/usr/bin/env node
/** 재특성화 phase4 — 42-char token-phone 코호트 지문/타이밍 (READ-ONLY, 평문 0). */
import { q } from './dryrun_lib.mjs';
const CLINIC_SUB = `(SELECT clinic_id FROM customers WHERE id='0356b229-e8c7-4655-aa6e-651b15370c1f')`;
const out = {};

// 1. 15개 token-phone 코호트 지문 (구조만)
out.cohort = await q(`
  SELECT id::text AS id,
    length(phone) AS plen, (phone ~ '^[A-Za-z0-9_-]+$') AS urlsafe, (phone ~ '_') AS has_underscore,
    (name ~ '\\*') AS name_masked, length(name) AS name_len,
    (rrn_enc IS NOT NULL) AS has_rrn, is_simulation, is_foreign,
    created_by, lead_source,
    created_at::text AS created_at, updated_at::text AS updated_at,
    (updated_at::date) AS upd_date
  FROM customers
  WHERE clinic_id=${CLINIC_SUB}
    AND phone ~ '^[A-Za-z0-9_-]+$' AND phone !~ '^[0-9+][0-9+ ()-]*$' AND length(phone) BETWEEN 30 AND 60
  ORDER BY updated_at;`);

// 2. updated_at 히스토그램 (배치성인지)
out.upd_histogram = await q(`
  SELECT date_trunc('hour', updated_at)::text AS hour_bucket, count(*) AS n
  FROM customers
  WHERE clinic_id=${CLINIC_SUB}
    AND phone ~ '^[A-Za-z0-9_-]+$' AND phone !~ '^[0-9+][0-9+ ()-]*$' AND length(phone) BETWEEN 30 AND 60
  GROUP BY 1 ORDER BY 1;`);

// 3. 동일 token-phone 길이 분포 (전부 42? 아니면 32/44 혼재?)
out.len_dist = await q(`
  SELECT length(phone) AS plen, count(*) AS n
  FROM customers WHERE clinic_id=${CLINIC_SUB}
    AND phone ~ '^[A-Za-z0-9_-]+$' AND phone !~ '^[0-9+][0-9+ ()-]*$' AND length(phone) BETWEEN 20 AND 60
  GROUP BY 1 ORDER BY 1;`);

// 4. 이 코호트가 마스킹 오염 백필의 phantom/raw 와 겹치나? (연속성)
out.overlap_maskbackfill = await q(`
  SELECT id::text FROM customers WHERE id = ANY(ARRAY[
    '512998d0-d51a-42c4-947e-b0cb2cc69da4','67ea1793-05e5-4d4a-b5c1-1ec73486e317',
    'bd307dfe-79f0-4fea-86a6-0957cea492cd','44a6a076-ca66-458a-bdc5-e0a3a12c2e67',
    '2dc21d1c-6e9f-4643-a733-dca92252d830','8fa12f4c-abfe-405e-8736-c2ca8e4aef8a',
    '7ad9e9a4-5e52-418c-acdb-300ee7d30e0b','d916d27b-e1a4-42ea-893e-db9a4fd3a461',
    'd2ba1e9a-74d2-4866-a7b8-d2282fccc2eb','38e1a858-71fc-4b74-9032-7a95298bb00b']::uuid[])
    AND phone ~ '^[A-Za-z0-9_-]+$' AND phone !~ '^[0-9+][0-9+ ()-]*$';`);

// 5. backfill archive/ledger 테이블 실재 여부 (mask-contam 백필이 apply 됐나)
out.backfill_applied = await q(`
  SELECT to_regclass('public._backfill_mask_contam_customers_bak') IS NOT NULL AS bak_exists,
         to_regclass('public._backfill_mask_contam_fkmoves')       IS NOT NULL AS fkmoves_exists,
         to_regclass('public._cleanup_row1_customers_bak')          IS NOT NULL AS row1_bak_exists;`);

console.log(JSON.stringify(out,null,2));
