/**
 * T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE — false-positive 감사 (READ-ONLY, mutation 0)
 *   BEFORE INSERT OR UPDATE 트리거 착지 前 blast-radius 근거 수집 (DA CONSULT 1차게이트 판정항 1).
 *   기존 customers 중 _fn_is_masked_pii(name,phone)=true 인 행 = 트리거가 미래 UPDATE 를 막을 대상.
 *   0 이면 §3.1 false-positive 회귀0 실증(대표 게이트 면제 요건). >0 이면 정당/오염 분류 필요.
 * author: dev-foot / 2026-07-15.
 */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let T=process.env.SUPABASE_ACCESS_TOKEN; if(!T){try{T=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
if(!T){console.error('❌ SUPABASE_ACCESS_TOKEN 필요');process.exit(1);}
const q=async s=>{const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${T}`,'Content-Type':'application/json'},body:JSON.stringify({query:s})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`);return JSON.parse(t);};
const rows=x=>x.result??x;

async function main(){
  console.log('=== customers 전수 마스킹-지문 감사 (READ-ONLY) ===\n');

  // 전체 규모 + helper 플래그 대상 수
  const summary = rows(await q(`
    SELECT
      count(*)                                                        AS total,
      count(*) FILTER (WHERE public._fn_is_masked_pii(name, phone))   AS flagged,
      count(*) FILTER (WHERE position('*' in COALESCE(btrim(name),'')) > 0)                          AS name_star,
      count(*) FILTER (WHERE position('*' in COALESCE(phone,'')) > 0)                                AS phone_star,
      count(*) FILTER (WHERE length(regexp_replace(COALESCE(phone,''), '\\D','','g')) BETWEEN 1 AND 7) AS phone_short_1_7,
      count(*) FILTER (WHERE length(regexp_replace(COALESCE(phone,''), '\\D','','g')) = 0)             AS phone_zero_digit
    FROM public.customers;`));
  console.table(summary);

  // flagged 행 축별 상세 (PHI 마스킹 표시 — raw 미노출)
  const flagged = rows(await q(`
    SELECT
      CASE WHEN position('*' in COALESCE(btrim(name),''))>0 THEN 'name_star'
           WHEN position('*' in COALESCE(phone,''))>0       THEN 'phone_star'
           WHEN length(regexp_replace(COALESCE(phone,''),'\\D','','g')) BETWEEN 1 AND 7 THEN 'phone_short'
           ELSE 'other' END                          AS fp_axis,
      length(regexp_replace(COALESCE(phone,''),'\\D','','g')) AS phone_digits,
      count(*)                                        AS n,
      min(created_at)::date                           AS first_seen,
      max(created_at)::date                           AS last_seen
    FROM public.customers
    WHERE public._fn_is_masked_pii(name, phone)
    GROUP BY 1,2 ORDER BY n DESC;`));
  console.log('\nflagged 행 축별 분포 (raw PII 미노출):');
  console.table(flagged);

  // sentinel "미확인" 통과 확인 (판정항 1)
  const sentinel = rows(await q(`
    SELECT '미확인' AS name_sample,
           public._fn_is_masked_pii('미확인', '+821012345678') AS flagged_with_valid_phone,
           public._fn_is_masked_pii('미확인', NULL)            AS flagged_with_null_phone;`));
  console.log('\nsentinel "미확인" helper 판정 (name 무-* → 정상 phone 시 통과 기대):');
  console.table(sentinel);

  // e3216e83 write 경로 지문 (★선행). status_transitions 는 체크인 room-transition 원장(source 없음·
  //   customers write 미기록) → 부적합. customers.created_by 가 실제 write-path 지문.
  console.log('\n=== flagged 행 write 경로 지문 = customers.created_by (★선행, moot-by-trigger) ===');
  const forensic = rows(await q(`
    SELECT COALESCE(created_by,'(null)') AS created_by,
           CASE WHEN position('*' in btrim(name))>0 THEN 'name_star' ELSE 'phone_short' END AS axis,
           count(*) AS n, min(created_at)::date AS first_seen, max(created_at)::date AS last_seen
    FROM public.customers WHERE public._fn_is_masked_pii(name, phone)
    GROUP BY 1,2 ORDER BY n DESC;`));
  console.table(forensic);
  console.log('  해석: created_by=NULL = anon SECURITY DEFINER RPC 산(세션 유저 무). per-RPC 특정은 '
            + 'table-level trigger 로 moot — 어느 anon RPC 든 customers.name/phone 최종값에서 폐쇄.');

  const flaggedN = Number(summary[0]?.flagged ?? -1);
  console.log(`\n판정: flagged=${flaggedN} → ${flaggedN===0 ? '✅ false-positive 회귀0 실증 (§3.1 대표게이트 면제 요건 충족)' : '⚠ >0 — DA 정당/오염 분류 필요 (에스컬레이션 후보)'}`);
}
main().catch(e=>{console.error(e);process.exit(1);});
