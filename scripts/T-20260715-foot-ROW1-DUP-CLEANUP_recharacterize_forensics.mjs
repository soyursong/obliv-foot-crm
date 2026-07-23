#!/usr/bin/env node
/**
 * T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION — 재특성화 READ-ONLY forensics.
 *
 * 목적(planner NEW-TASK MSG-20260724-061905-r3xi, 3항):
 *   ① ROW1(0356b229).phone drift(07-18 11:12, tail 9089→5773, len 42, unmasked) 원인 규명
 *   ② 동일인 duplicate 지문 재확정 근거 수집(phone축 붕괴 → name_hash 단독 가능성)
 *   ③ 마이그 freeze 값(v_ptail 등) 현 prod 실측 재판정 근거
 *
 * 불변식: READ-ONLY (SELECT only, mutation 0). 평문 name/phone/RRN 절대 미출력 —
 *   구조 지문(length·char-class·md5·tail4)만. tail4(5773/9089)는 supervisor 티켓에 이미 공개된 값.
 */
import { q } from './dryrun_lib.mjs';

const ROW1 = '0356b229-e8c7-4655-aa6e-651b15370c1f';
const RAW  = 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b';

const out = {};

// ── 0. customers 컬럼 census (writepath 매핑용) ──────────────────────────
out.customers_columns = await q(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
  ORDER BY ordinal_position;`);

// ── 1. ROW1 & RAW 현 상태 (구조 지문만, 평문 0) ──────────────────────────
out.row_fingerprints = await q(`
  SELECT
    CASE id::text WHEN '${ROW1}' THEN 'ROW1' WHEN '${RAW}' THEN 'RAW' END AS label,
    md5(coalesce(name,''))  AS name_hash,
    md5(coalesce(phone,'')) AS phone_md5,
    length(phone)                                                       AS phone_len,
    length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))          AS phone_digits,
    right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4)         AS phone_tail4,
    (phone ~ '\\*')                                                     AS phone_has_star,
    (phone ~ '^[0-9+][0-9+ ()-]*$')                                     AS phone_plain_numeric,
    (phone ~ '^[A-Za-z0-9+/_=-]+$')                                     AS phone_b64_charset,
    (phone ~ '^\\\\x[0-9a-f]+$')                                        AS phone_hex_bytea,
    (length(coalesce(phone,'')) - length(regexp_replace(coalesce(phone,''),'[A-Za-z]','','g'))) AS phone_alpha_ct,
    (length(coalesce(phone,'')) - length(regexp_replace(coalesce(phone,''),'[^+/=_-]','','g'))) AS phone_special_ct,
    (rrn_enc IS NOT NULL)                                               AS has_rrn,
    created_at, updated_at, created_by
  FROM customers WHERE id IN ('${ROW1}','${RAW}');`);

// ── 2. 42-char 값이 다른 customers 행의 값과 일치? (오염 소스 지문) ────────
//    phone_md5 를 전 customers 와 대조 — 어떤 실환자 phone 이 ROW1 에 복사됐는지(hash 매칭).
out.phone_md5_collision = await q(`
  WITH r1 AS (SELECT md5(coalesce(phone,'')) AS h FROM customers WHERE id='${ROW1}')
  SELECT count(*) AS other_rows_same_phone_md5,
         array_agg(c.id) FILTER (WHERE c.id <> '${ROW1}') AS matching_ids
  FROM customers c, r1
  WHERE md5(coalesce(c.phone,'')) = r1.h;`);

// ── 3. tail4=5773 clinic내 분포 (drift 후 새 지문의 충돌 우주) ────────────
out.tail5773_universe = await q(`
  SELECT count(*) AS n_tail5773,
         count(*) FILTER (WHERE name !~ '\\*' AND length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))>=8) AS n_nonmasked_8plus
  FROM customers c
  WHERE c.clinic_id = (SELECT clinic_id FROM customers WHERE id='${ROW1}')
    AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),4)='5773';`);

// ── 4. tail4=9089 (freeze baseline) clinic내 분포 (특성화 근거축 현 상태) ──
out.tail9089_universe = await q(`
  SELECT count(*) AS n_tail9089,
         count(*) FILTER (WHERE name !~ '\\*' AND length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))>=8) AS n_nonmasked_8plus,
         array_agg(id) AS ids
  FROM customers c
  WHERE c.clinic_id = (SELECT clinic_id FROM customers WHERE id='${ROW1}')
    AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),4)='9089';`);

// ── 5. schema_migrations 적용 시각 (07-18 11:12 근처 마이그 있었나) ────────
out.schema_migrations_0718 = await q(`
  SELECT version, name
  FROM supabase_migrations.schema_migrations
  WHERE version LIKE '2026071%'
  ORDER BY version;`).catch(e => ({ error: String(e.message||e) }));

// ── 6. ROW1 하류 자식 지문 (재특성화 blast-radius 재측정) ─────────────────
out.row1_children = await q(`
  SELECT cl.relname AS child_table, att.attname AS child_col,
    (SELECT count(*) FROM pg_catalog.pg_class x WHERE x.oid=cl.oid) AS _t,
    format('SELECT count(*) FROM %I WHERE %I=%L', cl.relname, att.attname, '${ROW1}') AS _probe
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid=con.conrelid
  JOIN pg_class rf ON rf.oid=con.confrelid
  JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum,ord) ON true
  JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum
  WHERE con.contype='f' AND rf.relname='customers'
  ORDER BY cl.relname;`);

// ── 7. audit / history / log 테이블 존재 여부 (누가 변조했나 추적 소스) ────
out.audit_tables = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND (table_name ~* 'audit' OR table_name ~* 'history' OR table_name ~* '_log' OR table_name ~* 'change')
  ORDER BY table_name;`);

console.log(JSON.stringify(out, null, 2));
