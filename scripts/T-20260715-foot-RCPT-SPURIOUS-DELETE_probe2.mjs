/**
 * T-20260715-foot-RCPT-SPURIOUS-DELETE — READ-ONLY probe phase 2 (blast radius + freeze isolation)
 * Phase1 발견: 전화 raw(010..) 저장 · name='RCPT_xxxx' · created_by=null (외부 자동등록 지문).
 * 이번: (1) freeze10 raw/E164 양포맷 재조회+격리 (2) 전 자식표면(FK+비FK+전화기반) 대상4 id 카운트 (3) 원장(payments/medical_charts) 상세.
 * READ-ONLY.
 * author: dev-foot / 2026-07-15
 */
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url),'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})});
  const t = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}

const TGT_IDS = [
  'a939ec01-859e-462a-8a47-eb8db90b16bf', // RCPT_8142
  '2db50bad-e200-4d13-ac2e-2356f8bb136a', // RCPT_9095
  'a22437a5-6602-4d43-a2f6-5e26b8aac727', // RCPT_6086
  '7fe8dbdd-702d-4f48-abc2-3dfc0cf97fda', // RCPT_1116
];
const TGT_PHONES = ['01027518142','01017969095','01067746086','01094091116'];
const idList = TGT_IDS.map(i=>`'${i}'`).join(',');
const phList = TGT_PHONES.map(p=>`'${p}'`).join(',');

// id-기반 자식표면 (FK-선언 + 비FK dangling 전부) — (table, col)
const ID_SURFACES = [
  ['chart_treatment_requests','customer_id','FK:CASCADE'],
  ['check_ins','customer_id','FK:NOACTION'],
  ['checklists','customer_id','FK:NOACTION'],
  ['clinical_images','customer_id','FK:CASCADE'],
  ['consent_forms','customer_id','FK:NOACTION'],
  ['customer_consult_memos','customer_id','FK:CASCADE'],
  ['customer_reservation_memos','customer_id','FK:CASCADE'],
  ['customer_special_notes','customer_id','FK:CASCADE'],
  ['customer_treatment_memos','customer_id','FK:CASCADE'],
  ['customers','referrer_id','FK:SETNULL(self)'],
  ['form_submissions','customer_id','FK:NOACTION'],
  ['health_q_results','customer_id','FK:CASCADE'],
  ['health_q_tokens','customer_id','FK:CASCADE'],
  ['insurance_claims','customer_id','FK:CASCADE'],
  ['insurance_documents','customer_id','FK:NOACTION'],
  ['insurance_receipts','customer_id','FK:NOACTION'],
  ['message_logs','customer_id','FK:CASCADE'],
  ['notification_logs','customer_id','FK:SETNULL'],
  ['notification_opt_outs','customer_id','FK:CASCADE'],
  ['package_payments','customer_id','FK:NOACTION(원장인접)'],
  ['packages','customer_id','FK:NOACTION'],
  ['packages','transferred_to','FK:NOACTION'],
  ['patient_file_records','customer_id','FK:CASCADE'],
  ['patient_past_history','customer_id','FK:CASCADE'],
  ['patient_room_daily_log','patient_id','FK:CASCADE'],
  ['payment_code_claims','customer_id','FK:NOACTION(원장인접)'],
  ['payments','customer_id','FK:NOACTION(★원장)'],
  ['prescriptions','customer_id','FK:NOACTION'],
  ['reservation_memo_history','customer_id','FK:CASCADE'],
  ['reservations','customer_id','FK:NOACTION'],
  ['service_charges','customer_id','FK:NOACTION(원장인접)'],
  ['treatment_photos','customer_id','FK:CASCADE'],
  // 비FK dangling 위험 표면 (DELETE 시 cascade도 block도 안됨 → orphan 잔존)
  ['aicc_crm_phone_match','customer_id','NOFK-dangling'],
  ['chart_doctor_memos','customer_id','NOFK-dangling(★원장/의사메모)'],
  ['consultation_notes','customer_id','NOFK-dangling(상담)'],
  ['leads','customer_id','NOFK-dangling'],
  ['medical_charts','customer_id','NOFK-dangling(★원장/의무기록)'],
  ['nhis_idor_audit_logs','customer_id','NOFK-dangling(audit)'],
  ['phi_access_log','customer_id','NOFK-dangling(audit)'],
  ['rrn_decrypt_fallback_log','customer_id','NOFK-dangling(audit)'],
  ['tm_call_logs','customer_id','NOFK-dangling'],
];
// 전화기반 자식표면
const PHONE_SURFACES = [
  ['check_ins','customer_phone'],
  ['reservations','customer_phone'],
  ['notification_logs','recipient_phone'],
  ['notification_opt_outs','phone'],
  ['aicc_crm_phone_match','phone'],
  ['leads','phone'],
];

const out={};

// 1) freeze10 재조회 — raw(010..) + E164 양포맷 + 타깃 교집합 ABORT 체크
const FRZ = [
  ['이백항','3990-7291'],['이백향','3999-7291'],['강영주','8181-3147'],['신도경','8376-0421'],
  ['조선미','8301-4660'],['김수린','8780-8083'],['이성수','8191-6245'],['김연희','9554-3858'],
  ['박정애','8609-3881'],['김민경','4316-0981'],
];
const frzRaw = FRZ.map(([n,d])=>`'010${d.replace('-','')}'`).join(',');
const frzE164 = FRZ.map(([n,d])=>`'+8210${d.replace('-','')}'`).join(',');
out.freeze_rows = await q(`
  SELECT id, name, phone, created_at, visit_type, created_by
  FROM customers WHERE phone IN (${frzRaw},${frzE164}) ORDER BY name;`);
out.freeze_intersect_target_ABORT_IF_NONZERO = await q(`
  SELECT id, name, phone FROM customers
  WHERE id IN (${idList}) AND phone IN (${frzRaw},${frzE164});`);

// 2) 전 id-기반 표면 카운트 (UNION ALL)
const idCounts = ID_SURFACES.map(([t,c,tag])=>
  `SELECT '${t}' tbl,'${c}' col,'${tag}' tag, count(*) n FROM ${t} WHERE ${c} IN (${idList})`).join('\nUNION ALL\n');
out.id_child_counts = (await q(idCounts+';')).filter(r=>r.n>0);
out.id_child_counts_all = await q(idCounts+' ORDER BY n DESC, tbl;');

// 3) 전화기반 표면 카운트
const phCounts = PHONE_SURFACES.map(([t,c])=>
  `SELECT '${t}' tbl,'${c}' col, count(*) n FROM ${t} WHERE ${c} IN (${phList})`).join('\nUNION ALL\n');
out.phone_child_counts_nonzero = (await q(phCounts+';')).filter(r=>r.n>0);

// 4) 원장 접점 상세 — payments / medical_charts 대상4 id 실행
out.payments_rows = await q(`SELECT * FROM payments WHERE customer_id IN (${idList});`);
out.medical_charts_rows = await q(`SELECT * FROM medical_charts WHERE customer_id IN (${idList});`);

console.log(JSON.stringify(out,null,2));
