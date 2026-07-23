#!/usr/bin/env node
/** 재특성화 phase2 — drift 값 정체 규명 + 11:12 event 지문 (READ-ONLY, 평문 0). */
import { q } from './dryrun_lib.mjs';
const ROW1 = '0356b229-e8c7-4655-aa6e-651b15370c1f';
const RAW  = 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b';
const out = {};

// 1. ROW1.phone 정밀 charset (어떤 special 문자인지 — URL-safe token vs raw base64 판별)
out.phone_charset = await q(`
  SELECT
    (phone ~ '\\+') AS has_plus, (phone ~ '/') AS has_slash, (phone ~ '=') AS has_eq,
    (phone ~ '-') AS has_dash, (phone ~ '_') AS has_underscore,
    (phone ~ '^[A-Za-z0-9_-]+$') AS urlsafe_b64_exact,
    left(md5(phone),8) AS phone_md5_8
  FROM customers WHERE id='${ROW1}';`);

// 2. 스모킹건: ROW1.phone 의 md5 가 health_q_tokens.token 과 일치하는가?
out.phone_eq_health_q_token = await q(`
  SELECT count(*) AS n_token_match,
         array_agg(clinic_id) AS clinics,
         array_agg(form_type) AS form_types,
         array_agg(customer_id::text) AS token_customer_ids,
         array_agg(created_at::text) AS created_ats,
         array_agg(expires_at::text) AS expires_ats
  FROM health_q_tokens t
  WHERE md5(t.token) = (SELECT md5(phone) FROM customers WHERE id='${ROW1}');`);

// 3. ROW1.phone 이 다른 token/텍스트 컬럼과 일치? (form_submissions token, checklists 등)
out.phone_eq_other_tokens = await q(`
  SELECT 'form_submissions.access_token' AS src, count(*) AS n
  FROM form_submissions f
  WHERE to_jsonb(f) ? 'access_token'
    AND md5(coalesce((to_jsonb(f)->>'access_token'),'')) = (SELECT md5(phone) FROM customers WHERE id='${ROW1}')
  UNION ALL
  SELECT 'health_q_tokens.token(any customer)', count(*) FROM health_q_tokens t
  WHERE md5(t.token) = (SELECT md5(phone) FROM customers WHERE id='${ROW1}');`).catch(e=>({error:String(e.message||e)}));

// 4. ROW1 하류 자식 중 07-18 11:1x 근처(±30min) 이벤트 지문 (누가/무엇이 건드렸나)
out.events_near_1112 = await q(`
  WITH win AS (SELECT timestamptz '2026-07-18 10:42:00+00' AS lo, timestamptz '2026-07-18 11:42:00+00' AS hi)
  SELECT 'health_q_tokens' AS tbl, count(*) AS n FROM health_q_tokens t, win
    WHERE t.customer_id='${ROW1}' AND (t.created_at BETWEEN win.lo AND win.hi)
  UNION ALL SELECT 'health_q_results', count(*) FROM health_q_results t, win
    WHERE t.customer_id='${ROW1}' AND (t.created_at BETWEEN win.lo AND win.hi)
  UNION ALL SELECT 'check_ins(created)', count(*) FROM check_ins t, win
    WHERE t.customer_id='${ROW1}' AND (t.created_at BETWEEN win.lo AND win.hi)
  UNION ALL SELECT 'reservations(updated)', count(*) FROM reservations t, win
    WHERE t.customer_id='${ROW1}' AND (t.updated_at BETWEEN win.lo AND win.hi)
  UNION ALL SELECT 'form_submissions', count(*) FROM form_submissions t, win
    WHERE t.customer_id='${ROW1}' AND (t.created_at BETWEEN win.lo AND win.hi);`).catch(e=>({error:String(e.message||e)}));

// 5. health_q_tokens for ROW1 — token 컬럼 지문 (phone 이 token 처럼 생겼는지 대조)
out.row1_hqtokens = await q(`
  SELECT form_type, length(token) AS token_len, (token ~ '^[A-Za-z0-9_-]+$') AS token_urlsafe,
         created_at::text, expires_at::text,
         (md5(token) = (SELECT md5(phone) FROM customers WHERE id='${ROW1}')) AS token_eq_phone
  FROM health_q_tokens WHERE customer_id='${ROW1}' ORDER BY created_at;`);

// 6. name_hash / stem / rrn 지문 재확정 (동일인 축) — off-git 대조용
out.identity = await q(`
  SELECT
    CASE id::text WHEN '${ROW1}' THEN 'ROW1' ELSE 'RAW' END AS label,
    md5(coalesce(name,'')) AS name_hash,
    md5(regexp_replace(coalesce(name,''),'\\s','','g')) AS name_nospace_hash,
    length(name) AS name_len,
    (name ~ '\\*') AS name_masked,
    md5(coalesce(resident_id,'')) AS resident_hash,
    (rrn_enc IS NOT NULL) AS has_rrn,
    birth_date IS NOT NULL AS has_birth,
    md5(coalesce(birth_date,'')) AS birth_hash
  FROM customers WHERE id IN ('${ROW1}','${RAW}');`);

console.log(JSON.stringify(out,null,2));
