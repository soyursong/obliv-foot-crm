/**
 * T-20260714-foot-WRITEPATH-MASK-SOURCE-FORENSIC — Phase 1 포렌식 (READ-ONLY)
 *
 * 목적(planner NEW-TASK):
 *   1) customers/check_ins 에 name INSERT/UPDATE 하는 모든 write 경로 전수 열거(마스킹 통과 가능 표시).
 *   2) 가설 (i) apply 무영속 vs (ii) 두 번째 write 벡터 판별.
 *      - (i): prod 함수 WS-A 지문(unlinked_masking_hold/미확인 sentinel/WS-A) 재확인 +
 *             schema_migrations 20260713120000 ↔ 함수 실재 ↔ 파일선언 3자 대조.
 *      - (ii): 5건(14:01~18:04 KST) 정확한 write 경로 특정 — status_transitions.changed_by 마커 +
 *             reservation_id NULL + check_ins denorm 마스킹 시그니처.
 *   3) freeze tz 버그 재산출: timestamptz 정확비교로 오염 생성시각·건수 재산출.
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
const s8 = (x) => (x == null ? null : String(x).slice(0, 8));

async function main() {
  console.log('=== T-20260714-foot-WRITEPATH-MASK-SOURCE-FORENSIC Phase 1 (READ-ONLY) ===\n');

  // ─────────────────────────────────────────────────────────────
  // Q1. 모든 write 경로 전수 열거 (pg_proc 바디 스캔) — customers/check_ins name write
  // ─────────────────────────────────────────────────────────────
  console.log('── Q1) customers/check_ins name write 경로 (함수) ──');
  const fns = await q(`
    SELECT p.proname,
      pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+(public\\.)?customers' AS ins_cust,
      pg_get_functiondef(p.oid) ~* 'update[[:space:]]+(public\\.)?customers'                 AS upd_cust,
      pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+(public\\.)?check_ins'  AS ins_ci,
      pg_get_functiondef(p.oid) ~* 'update[[:space:]]+(public\\.)?check_ins'                  AS upd_ci,
      pg_get_functiondef(p.oid) ~* 'customer_name'                                            AS touches_ci_name,
      -- 마스킹 지문 감지/차단 로직 보유? (WS-A 가드 지문)
      (position('unlinked_masking_hold' in pg_get_functiondef(p.oid))>0
        OR pg_get_functiondef(p.oid) ~* 'v_masking_seen|v_name_masked')                       AS has_masking_guard,
      p.prosecdef AS sec_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN ('f','p')
      AND pg_get_functiondef(p.oid) ~* '(insert[[:space:]]+into[[:space:]]+(public\\.)?customers|update[[:space:]]+(public\\.)?customers|insert[[:space:]]+into[[:space:]]+(public\\.)?check_ins|update[[:space:]]+(public\\.)?check_ins)'
    ORDER BY p.proname;`);
  console.table(fns);

  // 어떤 role 이 EXECUTE 가능한가 (anon/authenticated) — 마스킹 통과 가능 경로 표시
  console.log('\n── Q1b) 위 함수들의 anon/authenticated EXECUTE 권한 ──');
  const acl = await q(`
    SELECT p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN ('f','p')
      AND pg_get_functiondef(p.oid) ~* '(insert[[:space:]]+into[[:space:]]+(public\\.)?customers|update[[:space:]]+(public\\.)?customers|insert[[:space:]]+into[[:space:]]+(public\\.)?check_ins)'
    ORDER BY p.proname;`);
  console.table(acl);

  // 트리거 (customers/check_ins) — denorm 동기화 등
  console.log('\n── Q1c) customers/check_ins 트리거 ──');
  const trg = await q(`
    SELECT c.relname AS tbl, t.tgname, p.proname AS fn, t.tgenabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN ('customers','check_ins')
    ORDER BY c.relname, t.tgname;`);
  console.table(trg);

  // ─────────────────────────────────────────────────────────────
  // Q2. 가설 (i): WS-A 지문 재확인 + 3자 대조
  // ─────────────────────────────────────────────────────────────
  console.log('\n── Q2a) self_checkin_with_reservation_link 현재 prod 지문 ──');
  const fp = await q(`
    SELECT
      position('unlinked_masking_hold' in def)>0 AS has_hold_signal,
      position('v_masking_seen'        in def)>0 AS has_masking_seen,
      position('미확인'                in def)>0 AS has_sentinel_michagin,
      position('WS-A'                  in def)>0 AS has_wsa_comment,
      position('20260617'              in def)>0 AS is_old_20260617,
      md5(def)                                   AS def_md5,
      length(def)                                AS def_len
    FROM (SELECT pg_get_functiondef(p.oid) AS def
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='self_checkin_with_reservation_link' LIMIT 1) x;`);
  console.table(fp);

  console.log('\n── Q2b) schema_migrations 20260713120000 원장 (컬럼 전체) ──');
  const cols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' ORDER BY ordinal_position;`);
  console.log('schema_migrations columns:', cols.map(c => c.column_name).join(', '));
  const led = await q(`
    SELECT version, name, created_by
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20260713120000','20260711120000','20260617000000')
    ORDER BY version;`);
  console.table(led);

  // 파일선언 대조 (로컬)
  const fileDef = readFileSync('supabase/migrations/20260713120000_selfcheckin_writepath_harden_masked_reject.sql', 'utf8');
  console.log('파일선언 20260713120000: unlinked_masking_hold 포함=', fileDef.includes('unlinked_masking_hold'),
    '/ 미확인 sentinel 포함=', fileDef.includes('미확인'));

  // ─────────────────────────────────────────────────────────────
  // Q3. freeze 재산출 — timestamptz 정확비교 (KST 윈도우)
  //   윈도우: 147b3417 서버측 마스킹 배포 2026-07-11 00:00 KST ~ WS-A 가드 2026-07-13 13:05 KST
  // ─────────────────────────────────────────────────────────────
  console.log('\n── Q3) customers 마스킹행 — timestamptz 정확비교 (KST) ──');
  const custs = await q(`
    SELECT
      left(id::text,8) AS id8,
      left(clinic_id::text,8) AS clinic8,
      (position('*' in name)>0) AS name_masked,
      length(name) AS name_len,
      right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),4) AS phone_tail,
      length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) AS phone_digits,
      (position('*' in coalesce(phone,''))>0
        OR (length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7)) AS phone_masked,
      to_char(created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS created_kst,
      to_char(updated_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS updated_kst,
      -- 정확 timestamptz 비교: 윈도우 내부/이후(가드 13:05 이후)/이전
      (created_at >= timestamptz '2026-07-11 00:00:00+09'
        AND created_at <= timestamptz '2026-07-13 13:05:00+09')                 AS in_window_tz,
      (created_at > timestamptz '2026-07-13 13:05:00+09')                       AS after_guard_tz,
      (created_at < timestamptz '2026-07-11 00:00:00+09')                       AS before_window_tz
    FROM customers
    WHERE (position('*' in name)>0)
       OR (position('*' in coalesce(phone,''))>0)
       OR (length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7)
    ORDER BY created_at;`);
  console.table(custs);
  const afterGuard = custs.filter(c => c.after_guard_tz);
  console.log(`\n  masked customers 총 ${custs.length}건 · 윈도우내(tz) ${custs.filter(c=>c.in_window_tz).length}건 · 가드(13:05)이후(tz) ${afterGuard.length}건 · 이전 ${custs.filter(c=>c.before_window_tz).length}건`);
  console.log('  가드 이후 생성(=수도꼭지 반증 핵심):', afterGuard.map(c => `${c.id8}(${c.created_kst})`).join(', ') || '없음');

  // ─────────────────────────────────────────────────────────────
  // Q4. 가설 (ii): 가드 이후 생성된 masked customers 의 write 경로 특정
  //   각 masked customer 를 참조하는 check_ins + 그 check_in 의 status_transitions.changed_by 마커.
  //   self_checkin RPC 는 changed_by='self_checkin' 삽입 (구/신 공통) → 경로 지문.
  // ─────────────────────────────────────────────────────────────
  console.log('\n── Q4) 가드 이후 masked customers → check_ins denorm + write 경로 마커 ──');
  const afterIds = afterGuard.map(c => c.id8);
  const ciForensic = await q(`
    SELECT
      left(ci.id::text,8) AS ci_id8,
      left(ci.customer_id::text,8) AS cust_id8,
      (position('*' in coalesce(ci.customer_name,''))>0) AS ci_name_masked,
      (ci.customer_name = '미확인') AS ci_name_sentinel,
      length(ci.customer_name) AS ci_name_len,
      (ci.reservation_id IS NULL) AS resv_null,
      to_char(ci.created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS ci_created_kst,
      st.changed_by AS st_changed_by,
      st.from_status, st.to_status
    FROM check_ins ci
    LEFT JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.customer_id IN (
      SELECT id FROM customers
      WHERE ((position('*' in name)>0)
         OR (position('*' in coalesce(phone,''))>0)
         OR (length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7))
        AND created_at > timestamptz '2026-07-13 13:05:00+09')
    ORDER BY ci.created_at;`);
  console.table(ciForensic);

  // status_transitions.changed_by 분포 (경로 지문 요약)
  console.log('\n── Q4b) 가드 이후 masked check_ins 의 changed_by 마커 분포 ──');
  const marker = await q(`
    SELECT st.changed_by, count(*) AS n
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.customer_id IN (
      SELECT id FROM customers
      WHERE ((position('*' in name)>0)
         OR (position('*' in coalesce(phone,''))>0)
         OR (length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7))
        AND created_at > timestamptz '2026-07-13 13:05:00+09')
    GROUP BY st.changed_by ORDER BY n DESC;`);
  console.table(marker);

  // ─────────────────────────────────────────────────────────────
  // Q5. 마지막 masked customer 생성시각 + 이후 신규 마스킹 유입 여부
  // ─────────────────────────────────────────────────────────────
  console.log('\n── Q5) 마지막 masked customer/check_in 생성시각 (소스 닫힘 하한) ──');
  const last = await q(`
    SELECT 'customers' AS src,
      to_char(max(created_at) AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS last_masked_kst
    FROM customers
    WHERE (position('*' in name)>0) OR (position('*' in coalesce(phone,''))>0)
       OR (length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7)
    UNION ALL
    SELECT 'check_ins',
      to_char(max(created_at) AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS')
    FROM check_ins
    WHERE (position('*' in coalesce(customer_name,''))>0);`);
  console.table(last);
  const nowKst = await q(`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS') AS now_kst`);
  console.log('현재(KST):', nowKst[0].now_kst);

  console.log('\n=== Phase 1 완료 (READ-ONLY, mutation 0) ===');
}
main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
