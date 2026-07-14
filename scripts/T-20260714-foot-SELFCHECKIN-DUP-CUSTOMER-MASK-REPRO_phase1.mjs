/**
 * T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 1 재현·포렌식 (READ-ONLY)
 *
 * 현장 재보고(김주연 총괄, 2026-07-14 09:32): 셀프접수 시 (1) 대시보드 성함/연락처 여전히
 * 가려짐 + (2) 차트 2개 생성 → 통합시간표 동일고객 중복. 예약생성 경로는 정상.
 *
 * 이 재보고는 WRITEPATH-MASK-SOURCE-FORENSIC(done)의 "소스 닫힘·07-14 01:15 기준 8h+ clean"
 * 전제와 정면 충돌. Phase 1 목표(READ-ONLY):
 *   1) 07-14 01:15 이후(=FORENSIC clean 선언 이후) 생성된 masked customers / masked check_ins 유무.
 *      → 있으면 소스 미차단 확증 → WRITEPATH-FORENSIC REOPEN 판단을 planner FOLLOWUP.
 *   2) 동일 phone(또는 동일인) customer row 2건+ 여부 → 중복 생성 벡터 특정.
 *   3) 셀프접수 경로(self_checkin_with_reservation_link) 현재 prod 지문 = WS-A 가드 live 여부.
 *   4) 가드 발화 결과(미확인 sentinel + customer_id NULL) check_in 이 통합시간표 중복으로 보이는지.
 *
 * ★★★ READ-ONLY. UPDATE/DELETE/INSERT 절대 없음. SELECT + pg_get_functiondef 만. ★★★
 * PHI 위생(§4): 실명/전체번호 미출력. 이름=마스킹형/길이, phone=tail 4자리, id=8자.
 * author: dev-foot / 2026-07-14 · Management API read-only (SUPABASE_ACCESS_TOKEN)
 */
import { readFileSync } from 'node:fs';

const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  try { TOKEN = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, ''); } catch {}
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

async function main() {
  console.log('=== T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO Phase 1 (READ-ONLY) ===\n');
  const nowKst = await q(`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS now_kst`);
  console.log('현재(KST):', nowKst[0].now_kst, '\n');

  // ── Q1) 07-14 01:15 이후 생성된 masked customers (=FORENSIC clean 선언 이후 신규 유입?) ──
  console.log('── Q1) masked customers — created_at 기준 전수 + 01:15 이후 신규유입 여부 ──');
  const custs = await q(`
    SELECT
      left(id::text,8) AS id8,
      (position('*' in name)>0) AS name_masked,
      length(name) AS name_len,
      (name='미확인') AS name_sentinel,
      right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4) AS phone_tail,
      length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) AS phone_digits,
      (position('*' in coalesce(phone,''))>0
        OR (length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7)) AS phone_masked,
      to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS created_kst,
      (created_at > timestamptz '2026-07-14 01:15:00+09') AS after_forensic_clean
    FROM customers
    WHERE (position('*' in name)>0)
       OR (name='미확인')
       OR (position('*' in coalesce(phone,''))>0)
       OR (length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7)
    ORDER BY created_at;`);
  console.table(custs);
  const afterClean = custs.filter(c => c.after_forensic_clean);
  console.log(`\n  masked/sentinel customers 총 ${custs.length}건 · 07-14 01:15 이후 신규 ${afterClean.length}건`);
  console.log('  ★ 01:15 이후 신규(=소스 미차단 확증 후보):', afterClean.map(c=>`${c.id8}(${c.created_kst})`).join(', ') || '없음');

  // ── Q1b) 07-14 01:15 이후 생성된 masked/sentinel check_ins ──
  console.log('\n── Q1b) masked/sentinel check_ins — 01:15 이후 신규유입 여부 ──');
  const cis = await q(`
    SELECT
      left(id::text,8) AS ci_id8,
      left(customer_id::text,8) AS cust_id8,
      (customer_id IS NULL) AS cust_null,
      (position('*' in coalesce(customer_name,''))>0) AS ci_name_masked,
      (customer_name='미확인') AS ci_name_sentinel,
      length(customer_name) AS ci_name_len,
      (reservation_id IS NULL) AS resv_null,
      status,
      to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS created_kst,
      (created_at > timestamptz '2026-07-14 01:15:00+09') AS after_forensic_clean
    FROM check_ins
    WHERE (position('*' in coalesce(customer_name,''))>0)
       OR (customer_name='미확인')
    ORDER BY created_at;`);
  console.table(cis);
  const ciAfter = cis.filter(c => c.after_forensic_clean);
  console.log(`\n  masked/sentinel check_ins 총 ${cis.length}건 · 07-14 01:15 이후 ${ciAfter.length}건`);

  // ── Q2) 동일 phone canonical 로 customer row 2건+ (중복 생성 벡터) ──
  console.log('\n── Q2) 동일 phone(canonical) customer row 2건+ (중복 생성 벡터) ──');
  const dups = await q(`
    WITH canon AS (
      SELECT id, name, phone, created_at,
        CASE
          WHEN regexp_replace(coalesce(phone,''),'[^0-9]','','g') LIKE '0%'
            THEN '82'||substring(regexp_replace(coalesce(phone,''),'[^0-9]','','g') FROM 2)
          ELSE regexp_replace(coalesce(phone,''),'[^0-9]','','g')
        END AS pc
      FROM customers
    )
    SELECT
      right(pc,4) AS phone_tail, length(pc) AS pc_len,
      count(*) AS n_rows,
      string_agg(left(id::text,8),',' ORDER BY created_at) AS ids8,
      string_agg((position('*' in name)>0)::text,',' ORDER BY created_at) AS name_masked_flags,
      string_agg(to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI'),',' ORDER BY created_at) AS created_kst
    FROM canon
    WHERE pc <> '' AND length(pc) >= 8
    GROUP BY pc
    HAVING count(*) >= 2
    ORDER BY count(*) DESC, max(created_at) DESC
    LIMIT 40;`);
  console.table(dups);
  console.log(`  동일 phone 2건+ 그룹: ${dups.length}건`);

  // ── Q3) self_checkin_with_reservation_link 현재 prod 지문 (WS-A 가드 live?) ──
  console.log('\n── Q3) self_checkin_with_reservation_link 현재 prod 함수 지문 ──');
  const fp = await q(`
    SELECT
      position('unlinked_masking_hold' in def)>0 AS has_hold_signal,
      position('v_masking_seen'        in def)>0 AS has_masking_seen,
      position('미확인'                in def)>0 AS has_sentinel,
      position('WS-A'                  in def)>0 AS has_wsa_comment,
      position('20260617'              in def)>0 AS is_old_20260617,
      md5(def) AS def_md5, length(def) AS def_len
    FROM (SELECT pg_get_functiondef(p.oid) AS def
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='self_checkin_with_reservation_link' LIMIT 1) x;`);
  console.table(fp);

  // ── Q3b) 최근 self_checkin 경로 check_ins (오늘 KST) — 중복/미연결/마스킹 실태 ──
  console.log('\n── Q3b) 오늘(KST) self_checkin 경로 check_ins 실태 ──');
  const today = await q(`
    SELECT
      left(ci.id::text,8) AS ci_id8,
      left(ci.customer_id::text,8) AS cust_id8,
      (ci.customer_id IS NULL) AS cust_null,
      (ci.reservation_id IS NULL) AS resv_null,
      (position('*' in coalesce(ci.customer_name,''))>0) AS name_masked,
      (ci.customer_name='미확인') AS name_sentinel,
      right(regexp_replace(coalesce(ci.customer_phone,''),'[^0-9]','','g'),4) AS phone_tail,
      length(regexp_replace(coalesce(ci.customer_phone,''),'[^0-9]','','g')) AS phone_digits,
      ci.status,
      to_char(ci.created_at AT TIME ZONE 'Asia/Seoul','HH24:MI:SS') AS created_kst,
      st.changed_by
    FROM check_ins ci
    LEFT JOIN status_transitions st ON st.check_in_id=ci.id AND st.from_status='registered'
    WHERE (ci.created_at AT TIME ZONE 'Asia/Seoul')::date >= (now() AT TIME ZONE 'Asia/Seoul')::date - 1
    ORDER BY ci.created_at DESC
    LIMIT 40;`);
  console.table(today);

  console.log('\n=== Phase 1 완료 (READ-ONLY, mutation 0) ===');
}
main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
