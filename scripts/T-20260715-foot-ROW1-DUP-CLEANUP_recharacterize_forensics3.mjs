#!/usr/bin/env node
/** 재특성화 phase3 — 변조 actor 추적 + drift 값 정체(인코딩된 타컬럼?) (READ-ONLY, 평문 0). */
import { q } from './dryrun_lib.mjs';
const ROW1 = '0356b229-e8c7-4655-aa6e-651b15370c1f';
const out = {};

// 1. drift 값이 ROW1 자신의 rrn_enc/resident 를 인코딩한 것? (self-column corruption 가설)
out.phone_vs_own_cols = await q(`
  SELECT
    (md5(phone) = md5(coalesce(encode(rrn_enc,'base64'),'')))                       AS phone_eq_rrn_b64,
    (md5(phone) = md5(translate(coalesce(encode(rrn_enc,'base64'),''),'+/=','-_')))  AS phone_eq_rrn_b64url,
    (md5(phone) = md5(coalesce(encode(rrn_enc,'hex'),'')))                           AS phone_eq_rrn_hex,
    (md5(phone) = md5(coalesce(rrn_vault_id::text,'')))                              AS phone_eq_vaultid,
    (md5(phone) = md5(coalesce(resident_id,'')))                                     AS phone_eq_resident,
    (md5(phone) = md5(coalesce(chart_number,'')))                                    AS phone_eq_chartno,
    octet_length(rrn_enc) AS rrn_enc_bytes
  FROM customers WHERE id='${ROW1}';`);

// 2. audit 로그: 07-18 (UTC) ROW1 접촉 흔적 — 각 audit 테이블 스키마 유연 조회
async function tblCols(t){ return (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}'`)).map(r=>r.column_name); }
const auditTables = ['phi_access_log','customer_export_audit','staff_auth_action_audit','medical_charts_audit_log','payment_audit_logs','nhis_idor_audit_logs','reservation_logs'];
out.audit_hits = {};
for (const t of auditTables){
  const cols = await tblCols(t).catch(()=>[]);
  const tsCol = cols.find(c=>/(created_at|logged_at|accessed_at|occurred_at|action_at|at$|timestamp)/i.test(c)) || 'created_at';
  const idCol = cols.find(c=>/(customer_id|patient_id|target_id|subject_id|record_id|entity_id)/i.test(c));
  const actorCol = cols.find(c=>/(actor|staff_id|user_id|created_by|performed_by|auth_uid)/i.test(c));
  try {
    if (idCol){
      out.audit_hits[t] = await q(`SELECT count(*) AS n_row1_0718,
        ${actorCol?`array_agg(distinct ${actorCol}::text)`:`'(no-actor-col)'`} AS actors
        FROM ${t} WHERE ${idCol}::text='${ROW1}' AND ${tsCol} >= '2026-07-18' AND ${tsCol} < '2026-07-19';`);
    } else {
      out.audit_hits[t] = {note:`no customer-id col; cols=${cols.join(',')}`};
    }
  } catch(e){ out.audit_hits[t] = {error:String(e.message||e), tsCol, idCol}; }
}

// 3. 넓은 시간창(07-18 전일) ROW1 관련 child 이벤트 — 무엇이 그날 있었나
out.row1_0718_activity = await q(`
  SELECT 'reservations' AS tbl, count(*) AS n, min(updated_at)::text AS min_ts, max(updated_at)::text AS max_ts
    FROM reservations WHERE customer_id='${ROW1}' AND updated_at::date='2026-07-18'
  UNION ALL SELECT 'check_ins', count(*), min(updated_at)::text, max(updated_at)::text
    FROM check_ins WHERE customer_id='${ROW1}' AND updated_at::date='2026-07-18'
  UNION ALL SELECT 'notification_logs', count(*), min(created_at)::text, max(created_at)::text
    FROM notification_logs WHERE customer_id='${ROW1}' AND created_at::date='2026-07-18'
  UNION ALL SELECT 'message_logs', count(*), min(created_at)::text, max(created_at)::text
    FROM message_logs WHERE customer_id='${ROW1}' AND created_at::date='2026-07-18';`).catch(e=>({error:String(e.message||e)}));

// 4. drift 값과 동일 지문(len 42 · urlsafe · dash-only)을 가진 다른 customers.phone 이 있나?
//    (동일 버그경로가 여러 행을 오염시켰는지 = blast radius)
out.similar_corrupt_phones = await q(`
  SELECT count(*) AS n_len42_urlsafe,
         count(*) FILTER (WHERE phone ~ '^[A-Za-z0-9_-]+$' AND phone !~ '^[0-9+][0-9+ ()-]*$') AS n_nonphone_tokenish,
         array_agg(id) FILTER (WHERE phone ~ '^[A-Za-z0-9_-]+$' AND phone !~ '^[0-9+][0-9+ ()-]*$' AND length(phone)>20) AS tokenish_ids
  FROM customers
  WHERE length(phone) BETWEEN 30 AND 60;`);

// 5. clinic 전체에서 "phone 이 실제 전화번호 형식이 아닌" 행 census (오염 규모)
out.clinic_nonphone_census = await q(`
  SELECT count(*) AS total, count(*) FILTER (WHERE phone !~ '^[0-9+][0-9+ ()-]*$' AND phone IS NOT NULL AND phone !~ '\\*') AS nonphone_unmasked,
         count(*) FILTER (WHERE length(phone) > 20) AS len_gt20
  FROM customers WHERE clinic_id=(SELECT clinic_id FROM customers WHERE id='${ROW1}');`);

console.log(JSON.stringify(out,null,2));
