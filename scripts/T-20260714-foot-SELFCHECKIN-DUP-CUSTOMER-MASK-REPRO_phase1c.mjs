/**
 * T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 1c
 *   증상1(대시보드 성함·연락처 마스킹 표시) 근본원인 (a)/(b) 이중가설 분기 확정
 *   (planner INFO MSG-20260714-094316-98kf — 3차 relay dedup fold, 진단각도 1개 추가)
 *
 * 두 갈래:
 *   (a) WRITE-path 오염 : 저장값 자체가 `총**트`/4자리 phone 등 마스킹값 (기존 Phase1 가설)
 *   (b) RLS fallback    : 저장값은 raw 인데 staff 세션 RLS 가 anon(셀프접수)-origin
 *                          customer row 를 SELECT 못 해 대시보드/통합시간표가 fallback 마스킹 표시
 *
 * 결정적 판정: Management API = service_role = **RLS 우회** 읽기.
 *   - service_role 읽기가 MASKED 값을 반환 → 물리 저장값이 마스킹 → (a) 확정, (b) 반증.
 *   - service_role 읽기가 RAW 값을 반환하는데 대시보드만 가림 → (b) 후보.
 *   + customers RLS 정책이 origin/created-by 기반 staff SELECT 필터를 갖는지 구조 확인
 *     (그런 필터가 없으면 (b) 기전 자체가 부재 → (b) 구조적 반증).
 *
 * ★★★ READ-ONLY. SELECT + catalog introspection 만. mutation 0. ★★★
 * PHI 위생(§4): 실명/전체번호 미기재 — `*` 존재여부·length·tail 4자리·per-char class 만.
 */
import { readFileSync } from 'node:fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN = (readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

async function main(){
  console.log('=== Phase 1c — 증상1 근본원인 (a)WRITE-path / (b)RLS-fallback 분기 ===\n');

  // ── 판정 1: service_role(RLS 우회) 읽기 = masked row 의 물리 저장값 ──
  //   `*` 포함 개수 + phone digit 수. RLS 우회에서도 마스킹이면 (a).
  console.log('── 판정1) masked customer b1b5f6f7 물리 저장값 (service_role=RLS우회) ──');
  const stored = await q(`
    SELECT left(id::text,8) AS id8,
      length(name)                                   AS name_len,
      (position('*' in name)>0)                      AS name_has_star,
      (length(regexp_replace(name,'[^*]','','g')))   AS name_star_count,
      length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))      AS phone_digits,
      right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4)     AS phone_tail,
      (position('*' in coalesce(phone,''))>0)        AS phone_has_star
    FROM customers WHERE left(id::text,8)='b1b5f6f7';`);
  console.table(stored);

  // 대조군: raw row e8ed0df6 (동일인, 정상 등록) — raw 는 `*` 없음·12자리여야
  console.log('── 대조) raw customer e8ed0df6 (동일인 정상 등록) ──');
  const raw = await q(`
    SELECT left(id::text,8) AS id8, length(name) AS name_len,
      (position('*' in name)>0) AS name_has_star,
      length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) AS phone_digits,
      right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4) AS phone_tail
    FROM customers WHERE left(id::text,8)='e8ed0df6';`);
  console.table(raw);

  // ── 판정 2: customers RLS 활성 + SELECT 정책이 origin/created-by 필터를 갖는가 ──
  //   (b) 기전 = staff SELECT 가 anon-origin row 를 필터. 그런 정책이 없으면 (b) 구조 부재.
  console.log('\n── 판정2) customers RLS 활성/강제 여부 ──');
  const rls = await q(`
    SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='customers';`);
  console.table(rls);

  console.log('── 판정2b) customers SELECT 정책 (roles·qual) ──');
  const pol = await q(`
    SELECT pol.polname,
      CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END AS cmd,
      pg_get_expr(pol.polqual, pol.polrelid) AS using_qual,
      ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) AS roles
    FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='customers'
      AND pol.polcmd IN ('r','*')
    ORDER BY pol.polname;`);
  console.table(pol);

  // ── 판정 3: 대시보드/통합시간표 read 경로에 마스킹 fallback 로직이 있는가 ──
  //   (b) 이려면 read 뷰/RPC 가 "RLS SELECT 실패 시 마스킹" 을 해야 함. 실제로는
  //   fn_selfcheckin_today_reservations(20260711120000) 처럼 서버측 능동 마스킹만 존재.
  //   denorm 값(check_ins/reservations)이 이미 마스킹이면 read 마스킹 아님 → (a).
  console.log('\n── 판정3) self_checkin denorm 값 마스킹 여부 (read fallback 아닌 저장 오염 확인) ──');
  const denorm = await q(`
    SELECT left(id::text,8) AS ci_id8, left(customer_id::text,8) AS cust8,
      (position('*' in coalesce(customer_name,''))>0)  AS ci_name_masked,
      length(regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g')) AS ci_phone_digits,
      referral_source
    FROM check_ins
    WHERE customer_id::text LIKE 'b1b5f6f7%'
    ORDER BY created_at;`);
  console.table(denorm);

  console.log('\n=== 판정 결론 ===');
  const s = stored[0] || {};
  const verdict = (s.name_has_star || s.phone_digits < 8)
    ? '(a) WRITE-path 오염 확정 — service_role(RLS우회) 읽기에서도 저장값이 마스킹(`*` 포함/phone 절단). (b) RLS-fallback 반증.'
    : '(b) 후보 — service_role 읽기는 raw. RLS staff 정책 재점검 필요.';
  console.log(verdict);
  console.log('\n=== Phase 1c 완료 (READ-ONLY, mutation 0) ===');
}
main().catch(e=>{console.error('\n[FATAL]',e.message);process.exit(1);});
