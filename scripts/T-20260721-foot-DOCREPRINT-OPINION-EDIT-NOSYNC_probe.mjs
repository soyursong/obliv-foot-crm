/**
 * T-20260721-foot-DOCREPRINT-OPINION-EDIT-NOSYNC — PROD 증거기반 probe (READ-ONLY)
 * diagnose-first: F-4808 김문재 2번차트 소견서 재출력 미반영 RC 규명.
 * ⚠ PHI 보호: 소견 본문(final_text)은 절대 로그하지 않음 — 길이/해시/타임스탬프 메타만.
 * 판별: (A) 발행본 1건뿐(정정 재발행 안 함)=append-only 정책 → tension-GATE
 *       (B) 발행본 2건+(정정 발행됨)인데 재출력이 옛것=진짜 버그(cache/scoping)
 * checklist: #1 수정 저장여부 / #2 재출력 소싱 / #4 회귀타이밍(4FIX deploy 07-21T06:59)
 * author: dev-foot / 2026-07-21
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF='rxlomoozakkjesdqjtvd';
if(!tok){console.error('no token');process.exit(1);}
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
const out={};
// 0) F-4808 고객 해석 (chart_number 기준). 이름/RRN 등 PII 미출력 — id만.
out.customer = await q(`
  SELECT c.id, c.chart_number
  FROM customers c
  WHERE c.chart_number ILIKE '%4808%'
  LIMIT 5;`);

// 1) opinion_doc 템플릿 id
out.tpl = await q(`
  SELECT id, clinic_id, form_key, active
  FROM form_templates
  WHERE form_key='opinion_doc' AND active=true;`);

// 2) 해당 고객의 opinion_doc form_submissions 이력 (PHI 본문 제외: 길이/타임스탬프/상태/doc_type만)
out.submissions = await q(`
  SELECT fs.id,
         fs.status,
         fs.created_at,
         (fs.field_data->>'doc_type')          AS doc_type,
         length(fs.field_data->>'final_text')  AS final_text_len,
         md5(fs.field_data->>'final_text')      AS final_text_md5,
         (fs.field_data->>'doctor_name')        AS doctor_name,
         (fs.field_data->>'published_at')       AS published_at
  FROM form_submissions fs
  JOIN form_templates ft ON ft.id = fs.template_id
  WHERE ft.form_key='opinion_doc'
    AND fs.customer_id IN (SELECT id FROM customers WHERE chart_number ILIKE '%4808%')
  ORDER BY fs.created_at ASC;`);

// 3) published 트리거로 UPDATE 차단되는지 (append-only 실증) — 트리거 정의 확인
out.triggers = await q(`
  SELECT tgname, pg_get_triggerdef(oid) AS def
  FROM pg_trigger
  WHERE tgrelid='public.form_submissions'::regclass
    AND NOT tgisinternal;`);

console.log(JSON.stringify(out,null,2));
