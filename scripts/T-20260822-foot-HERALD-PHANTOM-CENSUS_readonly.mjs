/**
 * T-20260822-foot-HERALD-PHANTOM-CENSUS — READ-ONLY census (Phase A)
 *
 * 목적(AC-1/AC-3): 발톱센터 마감전령 08-09 팬텀 오보('수납 80,000원' · card=80000 · rev0)의
 *   진원(provenance)을 prod 실측으로 확정하고, 08-01~08-22 구간의 잔존 팬텀 시그니처를 전수 census.
 *
 * ── 팬텀 메커니즘(코드 확정, 본 스크립트가 prod 로 재확인) ─────────────────────────────
 *   1) daily_closings 에 status='closed' INSERT → AFTER 트리거 enqueue_closing_confirmed() 발화.
 *   2) closing_confirmed_outbox 에 (clinic_id, close_date, revision) 행 INSERT
 *      (ON CONFLICT (clinic_id,close_date,revision) DO NOTHING = 정당 멱등).
 *   3) CF-5-daily-closing.spec.ts 가 prod 로 write 하면 (single_card_total=80000·actual_card_total=80000,
 *      memo='CF-5 자동 마감 spec', status='closed') rev0 outbox 슬롯을 선점 → 실 EOD 마감(rev0)이
 *      ON CONFLICT DO NOTHING 으로 silent-drop → 팬텀 80k 이 리더 가시본으로 잔존.
 *   → scalp2 CF-5 phantom 시그니처(card=80000·rev0)와 동일. 진원 = 테스트(E2E)의 prod-write.
 *
 * ── 시그니처(census 술어) ─────────────────────────────────────────────────────────
 *   A) daily_closings: memo ILIKE '%CF-5%' OR memo ILIKE '%spec%' OR memo ILIKE '%자동 마감%'
 *                      OR (single_card_total=80000 AND actual_card_total=80000 AND status='closed')
 *   B) closing_confirmed_outbox: payload->'totals'->>'card'='80000' AND revision=0
 *                      OR payload->>'memo' ILIKE '%CF-5%' / '%spec%'
 *   C) 전후일 발산: 대상일 total_amount_krw << 전일·익일(30M+ 대비 소액=80k)
 *
 * GATE: READ-ONLY — SELECT only. prod write/DDL/정정 0건 (조사 티켓 · 산출물=조사결과).
 *   AC-4(정정 재발행)는 별도 supervisor 게이트 — 본 스크립트 범위 밖.
 * auth: Supabase Management API database/query = postgres 슈퍼유저(RLS 미적용).
 *   → silent 0-row read 회피 위해 인증컨텍스트 명시(Silent 0-Row Read 금지 표준).
 *   ★ E2E/테스트는 service_role(anon 아님)로 write → RLS 무관하게 outbox 오염 가능(진원 축).
 *
 * 실행: SUPABASE_ACCESS_TOKEN=<PAT> node scripts/T-20260822-foot-HERALD-PHANTOM-CENSUS_readonly.mjs
 */
const REF = 'rxlomoozakkjesdqjtvd'; // foot prod (SSOT: crm_supabase_ref_registry.yaml)
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음 (supervisor/DB-gate 컨텍스트에서 실행)'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) { console.error(`HTTP ${res.status}`, JSON.stringify(out)); process.exit(1); }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);

const WINDOW_FROM = '2026-08-01';
const WINDOW_TO = '2026-08-22';

console.log('=== auth-context 확인 (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user, session_user, current_setting('is_superuser') AS is_superuser`)));

console.log('\n=== [AC-1] 08-09 daily_closings 진원 census (전후일 08-08~08-10 포함) ===');
console.log(j(await q(`
  SELECT clinic_id, close_date, revision, status,
         single_card_total, single_cash_total, single_transfer_total,
         package_card_total, package_cash_total, package_transfer_total,
         actual_card_total, actual_cash_total, difference,
         confirmed_by, closed_at, unconfirmed_at, created_at, updated_at, memo
    FROM public.daily_closings
   WHERE close_date BETWEEN '2026-08-08' AND '2026-08-10'
   ORDER BY close_date, revision`)));

console.log('\n=== [AC-1] 08-09 closing_confirmed_outbox 진원 census (전후일 포함) ===');
console.log(j(await q(`
  SELECT id, clinic_slug, close_date, revision, superseded, status, dlq,
         payload->>'memo'                    AS payload_memo,
         payload->'totals'->>'card'          AS totals_card,
         payload->'totals'->>'cash'          AS totals_cash,
         payload->>'total_amount_krw'        AS total_amount_krw,
         payload->>'schema_version'          AS schema_version,
         created_at, sent_at, last_error
    FROM public.closing_confirmed_outbox
   WHERE close_date BETWEEN '2026-08-08' AND '2026-08-10'
   ORDER BY close_date, revision`)));

console.log('\n=== [AC-1] 팬텀 시그니처 직접 매칭 (card=80000·rev0 / memo CF-5·spec) ===');
console.log(j(await q(`
  SELECT close_date, revision, superseded, status,
         payload->>'memo' AS payload_memo, payload->'totals'->>'card' AS totals_card
    FROM public.closing_confirmed_outbox
   WHERE (payload->'totals'->>'card' = '80000' AND revision = 0)
      OR payload->>'memo' ILIKE '%CF-5%'
      OR payload->>'memo' ILIKE '%spec%'
      OR payload->>'memo' ILIKE '%자동 마감%'
   ORDER BY close_date, revision`)));

console.log('\n=== [AC-3] 08-01~08-22 daily_closings 팬텀 시그니처 전수 census ===');
console.log(j(await q(`
  SELECT close_date, revision, status, single_card_total, actual_card_total, difference,
         confirmed_by, memo, created_at
    FROM public.daily_closings
   WHERE close_date BETWEEN '${WINDOW_FROM}' AND '${WINDOW_TO}'
     AND ( memo ILIKE '%CF-5%' OR memo ILIKE '%spec%' OR memo ILIKE '%자동 마감%'
        OR (single_card_total = 80000 AND actual_card_total = 80000 AND status = 'closed'
            AND COALESCE(single_cash_total,0)=0 AND COALESCE(package_card_total,0)=0) )
   ORDER BY close_date, revision`)));

console.log('\n=== [AC-3] 08-01~08-22 전 마감 outbox 요약 (전후일 발산 판별용 리더-가시본) ===');
console.log(j(await q(`
  SELECT close_date, revision, superseded, status, dlq,
         payload->>'total_amount_krw' AS total_amount_krw,
         payload->'totals'->>'card'   AS totals_card,
         payload->>'memo'             AS payload_memo
    FROM public.closing_confirmed_outbox
   WHERE close_date BETWEEN '${WINDOW_FROM}' AND '${WINDOW_TO}'
     AND COALESCE(superseded,false) = false   -- 리더 가시본(read_closing_confirmed_events 술어)
   ORDER BY close_date, revision`)));

console.log('\n=== [AC-3] 리더-가시본 소액(<1,000,000) = 팬텀 의심 (30M+ 정상 대비 발산) ===');
console.log(j(await q(`
  SELECT close_date, revision, payload->>'total_amount_krw' AS total_amount_krw,
         payload->'totals'->>'card' AS totals_card, payload->>'memo' AS payload_memo, status
    FROM public.closing_confirmed_outbox
   WHERE close_date BETWEEN '${WINDOW_FROM}' AND '${WINDOW_TO}'
     AND COALESCE(superseded,false) = false
     AND COALESCE(NULLIF(payload->>'total_amount_krw','')::bigint, 0) < 1000000
   ORDER BY close_date, revision`)));

console.log('\n=== census 완료 (READ-ONLY · 정정 0건 · AC-4 재발행은 supervisor 게이트) ===');
