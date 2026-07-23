#!/usr/bin/env node
/**
 * 재특성화 phase6 — ② duplicate 전제 재판정 결착: ROW1 ver=1(pre-drift) phone 복구.
 *
 * DA 재판정 SSOT(DA-20260724-...FREEZEDRIFT-READJUDICATE) Q3(b) path(a):
 *   "ROW1의 07-18 이전(ver=1) phone을 audit/ver-history/백업에서 복구 → tail 9089 매칭 재확인".
 * 본 phase 는 (1) 현 prod 상태 재확인(drift 불변·mutation 0) (2) DB-native pre-drift
 *   phone 백업 소스 실재 여부 (3) ver=1 identity 축 재확정을 SELECT-only 로 수집.
 *   ver=1 phone 실복구 근거 = off-git 07-15 특성화 스냅샷(pre-drift 백업, ROW1.ptail=9089).
 * 불변식: READ-ONLY (SELECT only, mutation 0). 평문 name/phone/RRN 미출력 — 지문·tail4(공개값)만.
 */
import { q } from './dryrun_lib.mjs';
const ROW1='0356b229-e8c7-4655-aa6e-651b15370c1f', RAW='c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b';
const out={};

// 1. 현 prod 상태 재확인 (drift 불변? mutation 0 실증 — ROW1 여전히 DUMMY, RAW 여전히 9089)
out.current_state = await q(`
  SELECT CASE id::text WHEN '${ROW1}' THEN 'ROW1' ELSE 'RAW' END AS label,
    (phone LIKE 'DUMMY-%') AS is_dummy, length(phone) AS plen,
    right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4) AS tail4,
    md5(coalesce(name,'')) AS name_hash, (rrn_enc IS NOT NULL) AS has_rrn,
    rrn_encryption_version AS rrn_ver, updated_at::text AS updated_at
  FROM customers WHERE id IN ('${ROW1}','${RAW}') ORDER BY 1;`);

// 2. DB-native pre-drift phone 백업 소스 실재? (OOB dummy-normalize corrective 가 old phone 을 어디 저장했나)
out.native_backup_sources = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND (table_name ~* 'phone.*bak' OR table_name ~* 'bak.*phone' OR table_name ~* 'dummy'
         OR table_name ~* 'placeholder' OR table_name ~* 'norm.*bak' OR table_name ~* 'customers.*bak'
         OR table_name ~* 'phone.*hist' OR table_name ~* 'customers.*hist')
  ORDER BY 1;`);

// 3. audit 로그에 ROW1 phone old-value 가 남았나 (phi_access_log / trigger audit 등에 payload 보존?)
async function cols(t){ return (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}'`).catch(()=>[])).map(r=>r.column_name); }
out.audit_oldvalue_capability = {};
for (const t of ['phi_access_log','customers_audit','customer_change_log','audit_log']) {
  const c = await cols(t);
  out.audit_oldvalue_capability[t] = c.length ? {exists:true, has_oldvalue_col: c.some(x=>/old|before|prev|payload|diff|snapshot/i.test(x)), cols:c.slice(0,20)} : {exists:false};
}

// 4. ver=1 identity 축 재확정 (drift 후에도 name/stem/rrn 불변 — off-git 07-15 스냅샷과 대조)
out.identity_axes_now = await q(`
  SELECT CASE id::text WHEN '${ROW1}' THEN 'ROW1' ELSE 'RAW' END AS label,
    md5(coalesce(name,'')) AS name_hash,
    md5(regexp_replace(coalesce(name,''),'\\s','','g')) AS stem_hash_full,
    md5(coalesce(encode(rrn_enc,'hex'),'')) AS rrn_enc_md5, (rrn_enc IS NOT NULL) AS has_rrn
  FROM customers WHERE id IN ('${ROW1}','${RAW}') ORDER BY 1;`);

// 5. ver=1 tail 9089 우주 재현: RAW 는 live 9089 보유(1건). ROW1 은 drift 로 이탈. 07-15 = 2건({ROW1,RAW}).
out.tail9089_now = await q(`
  SELECT count(*) AS n_tail9089_live,
         count(*) FILTER (WHERE length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))>=8 AND phone !~ '\\*') AS n_real_8plus,
         array_agg(CASE id::text WHEN '${ROW1}' THEN 'ROW1' WHEN '${RAW}' THEN 'RAW' ELSE left(id::text,8) END) AS members
  FROM customers c
  WHERE c.clinic_id=(SELECT clinic_id FROM customers WHERE id='${ROW1}')
    AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),4)='9089';`);

// 6. mutation 0 재확인: cleanup archive 표 부재 + 170000 마이그 미적용
out.mutation_zero = await q(`
  SELECT to_regclass('public._cleanup_row1_customers_bak') IS NULL AS row1_bak_absent,
         to_regclass('public._cleanup_row1_fkmoves') IS NULL AS fkmoves_absent,
         NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260715170000') AS mig170000_unapplied;`).catch(e=>({error:String(e.message||e)}));

console.log(JSON.stringify(out,null,2));
