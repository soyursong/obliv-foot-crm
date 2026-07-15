/**
 * T-20260715-foot-RCPT-SPURIOUS-DELETE — READ-ONLY 증거기반 probe (gate step 1)
 * 요청: 김주연 총괄. 7/14 21:11:18~30 외부 자동등록 의심 4건 archive-first 삭제 착수 전 조사.
 * SOP: Orphan-Row Archive-First Cleanup + FK Integrity Guard (foot KJY 선례 DA-20260713 템플릿).
 * 안전규율: RCPT_ID(=전화 last4 합성라벨)∩전화 교집합 식별 · id VALUES freeze · freeze10 격리 재검증 · FK 카탈로그 기계열거 · 원장(payments/medical_charts)접점.
 * READ-ONLY: SELECT/카탈로그 조회만. 파괴적 실행 0.
 * author: dev-foot / 2026-07-15
 */
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url),'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no SUPABASE_ACCESS_TOKEN');process.exit(1);}
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})
  });
  const t = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// 합성 RCPT_ID → 전화 E.164 (last4 지문 대조 포함)
const TARGETS = [
  {rcpt:'RCPT_8142', raw:'01027518142', e164:'+821027518142', ts:'21:11:18'},
  {rcpt:'RCPT_9095', raw:'01017969095', e164:'+821017969095', ts:'21:11:19'},
  {rcpt:'RCPT_6086', raw:'01067746086', e164:'+821067746086', ts:'21:11:30'},
  {rcpt:'RCPT_1116', raw:'01094091116', e164:'+821094091116', ts:'21:11:30'},
];
// 유지 10건 freeze (실고객) — 이름 last4(하이픈 앞뒤 8자리) → 010-XXXX-XXXX → E.164
const FREEZE = [
  {name:'이백항', d:'3990-7291'}, {name:'이백향', d:'3999-7291'}, {name:'강영주', d:'8181-3147'},
  {name:'신도경', d:'8376-0421'}, {name:'조선미', d:'8301-4660'}, {name:'김수린', d:'8780-8083'},
  {name:'이성수', d:'8191-6245'}, {name:'김연희', d:'9554-3858'}, {name:'박정애', d:'8609-3881'},
  {name:'김민경', d:'4316-0981'},
].map(f=>({...f, e164:'+82'+('10'+f.d.replace('-',''))}));

const tgtPhones = TARGETS.map(t=>`'${t.e164}'`).join(',');
const frzPhones = FREEZE.map(f=>`'${f.e164}'`).join(',');
const out={};

// A) 4 타깃 실재 + 지문 (id/name/phone/visit_type/created_by/created_at/clinic_id)
out.A_targets = await q(`
  SELECT id, name, phone, visit_type, created_by, created_at, clinic_id
  FROM customers WHERE phone IN (${tgtPhones}) ORDER BY created_at;`);

// A2) created_at 시각창(7-14 21:11:00~21:12:00 KST=UTC+9 → UTC 12:11) 내 전체행 — 과포함/추가행 탐지 (삭제엔 안씀, 조사용)
out.A2_timewindow = await q(`
  SELECT id, name, phone, visit_type, created_by, created_at
  FROM customers
  WHERE created_at >= '2026-07-14 21:11:00+09' AND created_at < '2026-07-14 21:12:30+09'
  ORDER BY created_at;`);

// B) freeze 10 실재 + 타깃셋과 교집합(있으면 ABORT 신호)
out.B_freeze = await q(`
  SELECT id, name, phone, created_at FROM customers WHERE phone IN (${frzPhones}) ORDER BY name;`);
out.B_intersection_ABORT_IF_NONZERO = await q(`
  SELECT id, name, phone FROM customers WHERE phone IN (${frzPhones}) AND phone IN (${tgtPhones});`);

// C) FK 카탈로그 기계열거 — public.customers 를 참조하는 전 FK (자식테이블/컬럼/on-delete)
out.C_fk_referencing_customers = await q(`
  SELECT c.conname, (n.nspname||'.'||t.relname) AS child_table, a.attname AS child_col,
         c.confdeltype AS on_delete   -- a=NO ACTION, r=RESTRICT, n=SET NULL, c=CASCADE, d=SET DEFAULT
  FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
  WHERE c.contype='f' AND c.confrelid='public.customers'::regclass
  ORDER BY child_table, child_col;`);

// C2) 전화기반(비FK) 연결 표면 — customer_phone 류 컬럼을 가진 테이블 열거
out.C2_phone_columns = await q(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND column_name ILIKE '%phone%'
  ORDER BY table_name, column_name;`);

// C3) customer_id 컬럼을 가진 테이블(FK 미선언 포함) 열거 — dangling 위험 표면
out.C3_customerid_columns = await q(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND column_name IN ('customer_id','customer_uuid')
  ORDER BY table_name;`);

// D) 원장 접점 사전 스캔 — payments / medical_charts 테이블 실재 + 참조컬럼
out.D_ledger_tables = await q(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('payments','medical_charts')
  ORDER BY table_name;`);

console.log(JSON.stringify(out,null,2));
