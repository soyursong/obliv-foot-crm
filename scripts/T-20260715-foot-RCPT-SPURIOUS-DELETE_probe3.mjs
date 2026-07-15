/** T-20260715-foot-RCPT-SPURIOUS-DELETE — READ-ONLY probe phase 3
 * freeze10 실존 확정(이름+last8 지문) · phone 저장포맷 census · aicc_crm_phone_match 4행 상세 · 대상4 전체컬럼 덤프.
 * READ-ONLY. author: dev-foot / 2026-07-15 */
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url),'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

const TGT_IDS=['a939ec01-859e-462a-8a47-eb8db90b16bf','2db50bad-e200-4d13-ac2e-2356f8bb136a','a22437a5-6602-4d43-a2f6-5e26b8aac727','7fe8dbdd-702d-4f48-abc2-3dfc0cf97fda'];
const idList=TGT_IDS.map(i=>`'${i}'`).join(',');
const FRZ=[['이백항','3990-7291'],['이백향','3999-7291'],['강영주','8181-3147'],['신도경','8376-0421'],['조선미','8301-4660'],['김수린','8780-8083'],['이성수','8191-6245'],['김연희','9554-3858'],['박정애','8609-3881'],['김민경','4316-0981']];
const frzNames=[...new Set(FRZ.map(([n])=>n))].map(n=>`'${n}'`).join(',');
const frzLast8=FRZ.map(([n,d])=>d.replace('-','')); // 39907291 ...
const out={};

// 1) phone 저장 포맷 census (E164 vs raw010 vs 기타)
out.phone_format_census = await q(`
  SELECT CASE WHEN phone LIKE '+82%' THEN 'E164(+82)' WHEN phone LIKE '010%' THEN 'raw010' ELSE 'other' END fmt,
         count(*) n FROM customers GROUP BY 1 ORDER BY n DESC;`);

// 2) freeze10 — 이름 매칭 (phone 포맷 무관)
out.freeze_by_name = await q(`
  SELECT id, name, phone, created_at, visit_type, created_by FROM customers
  WHERE name IN (${frzNames}) ORDER BY name, created_at;`);

// 3) freeze10 — last8 지문 매칭 (prefix 무관), 타깃과 교집합 여부 표기
const like8 = frzLast8.map(d=>`phone LIKE '%${d}'`).join(' OR ');
out.freeze_by_last8 = await q(`
  SELECT id, name, phone, created_at,
         (id IN (${idList})) AS is_target_ABORT_IF_TRUE
  FROM customers WHERE ${like8} ORDER BY name;`);

// 4) 대상4 전체 컬럼 덤프 (판정근거 스냅샷 원본)
out.target_full = await q(`SELECT * FROM customers WHERE id IN (${idList}) ORDER BY created_at;`);

// 5) aicc_crm_phone_match — 4행 상세 + 스키마
out.aicc_rows = await q(`SELECT * FROM aicc_crm_phone_match WHERE customer_id IN (${idList});`);
out.aicc_cols = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='aicc_crm_phone_match' ORDER BY ordinal_position;`);

// 6) 같은 시각창 인접 정상등록과 대비 — 7/14 전체 신규 등록의 created_by/포맷 분포 (write-path 대비)
out.jul14_new_census = await q(`
  SELECT CASE WHEN phone LIKE '+82%' THEN 'E164' WHEN phone LIKE '010%' THEN 'raw010' ELSE 'other' END fmt,
         (created_by IS NULL) created_by_null, count(*) n
  FROM customers WHERE created_at >= '2026-07-14 00:00:00+09' AND created_at < '2026-07-15 00:00:00+09'
  GROUP BY 1,2 ORDER BY n DESC;`);

console.log(JSON.stringify(out,null,2));
