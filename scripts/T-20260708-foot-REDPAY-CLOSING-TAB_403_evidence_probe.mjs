/**
 * T-20260708-foot-REDPAY-CLOSING-TAB — RedPay 403 벤더 공유용 증거 probe (READ-ONLY)
 * NEW-TASK MSG-20260710-194731-eezz (planner): 403 원자료를 벤더 공유용 마스킹 패킷으로 산출.
 * 목적: net._http_response id 92398/92400/92451의 실제 HTTP status/body/headers + created 시각 조회.
 *       + net._http_request_queue 대응 요청 url/headers(키 마스킹 전) 확인.
 * ⚠ READ-ONLY. 산출 후 API 키는 코드에서 마스킹 처리(패킷 문서에는 전체값 미기재).
 * author: dev-foot / 2026-07-10
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
// 0) net._http_response 컬럼 스키마 확인
out.resp_cols = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='net' AND table_name='_http_response' ORDER BY ordinal_position;`);
// 1) 403 응답 원본 (id 92398/92400/92451)
out.responses = await q(`
  SELECT id, status_code, created,
         (content)::text AS body,
         content_type,
         (headers)::text AS headers,
         error_msg
  FROM net._http_response
  WHERE id IN (92398,92400,92451)
  ORDER BY id;`);
// 3) redpay 관련 최근 403 응답 전체 — 시각 확인용
out.recent_403 = await q(`
  SELECT id, status_code, created, LEFT((content)::text,400) AS body_head, error_msg
  FROM net._http_response
  WHERE status_code=403
  ORDER BY created DESC
  LIMIT 15;`);
// 4) raw/poller 현황 재확인 (PHI 무포함 확인 근거 — raw 0건)
out.raw_count = await q(`SELECT count(*) n FROM redpay_raw_transactions;`);
console.log(JSON.stringify(out,null,2));
