/**
 * T-20260724-foot-PKGSESSION-B1-LEAKY-MAPPING-REVIEW — R1 per-row 검토 probe (READ-ONLY)
 * ══════════════════════════════════════════════════════════════════════════
 * 부모: T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY (G-A sub-gate)
 * DA 정본: consult_reply_foot_pkgsession_backfill_efficacy_20260724.md (G-A 분해쿼리)
 *
 * 목적 (R1, SOP §2-F):
 *   ① 4-type 한정 gap-decomposition 재현 → gap 39 = A2(23)+B1_LEAKY(16)+X(0) 정합 확증.
 *      (doc의 원 분해쿼리는 ps CTE에 session_type 필터가 없어 trial(74+17)·reborn spill →
 *       gap 132 버그. ps 를 4-type(heated/unheated/podologue/iv)로 한정해야 gap 39 정합.)
 *   ② B1_LEAKY used-session id 집합 freeze(박제) — 검토 시점 대상셋 고정. 이탈 시 abort.
 *   ③ per-row: B1_LEAKY 각 check_in 의 CASE→NULL(session_type=NULL) CIS 라인
 *      (service_code / name / category / price)을 덤프 → "진짜 회차소비 vs 진료/약제/검사 라인" 판별 근거.
 *
 * 판정 규칙 (자동 widen 금지 — SOP §2-F):
 *   - CASE 7분기(레이저2·포돌로게·수액)에 안 잡히나 실질이 회차소비인 서비스만 진성 누락(widen 후보).
 *   - 초진진찰료·검사(KOH도말)·외용액(바르토벤/주블리아)·단순처치 등 진료/약제/검사 라인은
 *     애초 패키지 회차가 아님 = 설계정상 잔차(widen 대상 아님).
 *   - 진성 회차소비 0건 결론 시 → '39는 설계정상 out-of-scope' 스냅샷 박제 후 정상 종결.
 *
 * 스코프: mutation 0. SELECT only(read-only). write/DDL 없음. 42 count-exact APPLY-set 무접촉.
 * 인증컨텍스트: Management API service-role SQL (RLS bypass) — 진단 인증컨텍스트 표준(0-row≠wipe).
 * PHI 위생: 산출물엔 service 메타(코드/명/분류/price)·session_type·count·절단 check_in id(8자)만.
 *   customer_id/이름/주민번호 등 환자 식별정보 제외.
 * tz: KST(UTC+9) 인지 — created_at 은 UTC 저장값 그대로 사용.
 * 실행: node scripts/T-20260724-foot-PKGSESSION-B1-LEAKY-MAPPING-REVIEW_R1_probe.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 * author: dev-foot / 2026-07-24
 * ══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!TOK) { console.error('missing SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// ── 공통 CTE (4-type 한정 gap-decomposition, DA G-A 분해쿼리 정본 + ps 4-type 필터) ──
//   cis_map 은 판별 근거 위해 service_code/name/category/price 를 carry 하도록 확장.
const CTE = `
WITH ps AS (
  SELECT p.id AS session_id, p.check_in_id, p.session_type,
         row_number() OVER (PARTITION BY p.check_in_id, p.session_type
                            ORDER BY p.session_number, p.created_at) AS rn
  FROM public.package_sessions p
  WHERE p.status='used' AND p.check_in_id IS NOT NULL
    AND p.session_type IN ('heated_laser','unheated_laser','iv','podologue')  -- ★4-type 한정(gap132 방지)
),
cis_map AS (
  SELECT c.id AS cis_id, c.check_in_id, c.created_at,
         c.package_session_id, c.price,
         s.service_code, s.name AS service_name, s.category, s.category_label,
         (s.name LIKE '%체험%') AS is_trial,
         CASE
           WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
           WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
           WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
           WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
           ELSE NULL
         END AS session_type
  FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id
),
cis_avail AS (
  SELECT cis_id, check_in_id, session_type,
         row_number() OVER (PARTITION BY check_in_id, session_type ORDER BY created_at, cis_id) AS rn
  FROM cis_map WHERE package_session_id IS NULL AND session_type IS NOT NULL AND is_trial=false
),
matched AS (
  SELECT ps.session_id FROM cis_avail a
  JOIN ps ON ps.check_in_id=a.check_in_id AND ps.session_type=a.session_type AND ps.rn=a.rn
),
unmatched AS (SELECT * FROM ps WHERE session_id NOT IN (SELECT session_id FROM matched)),
bucketed AS (
  SELECT u.session_id, u.check_in_id, u.session_type,
    CASE
      WHEN u.session_type='preconditioning' THEN 'A1_preconditioning(CASE미방출·구조적)'
      WHEN NOT EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id) THEN 'A2_check_in에CIS없음'
      WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.session_type IS NULL) THEN 'B1_LEAKY:CASE→NULL서비스존재'
      WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.is_trial) THEN 'B3_trial제외행존재'
      WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.session_type=u.session_type AND m.package_session_id IS NOT NULL) THEN 'C_rn/count비대칭'
      ELSE 'X_기타(수동조사)'
    END AS bucket
  FROM unmatched u
)`;

const out = { ticket: 'T-20260724-foot-PKGSESSION-B1-LEAKY-MAPPING-REVIEW', stage: 'R1 (READ-ONLY per-row 검토)', prod_ref: REF };

// ── ① gap-decomposition 계수 (버킷별) ──
out.step1_bucket_tally = await q(`${CTE}
  SELECT bucket, session_type, count(*) AS unmatched_used
  FROM bucketed GROUP BY 1,2 ORDER BY 1,2;`);

// used 4-type 총량 / matched 42 정합 확증
out.step1_totals = await q(`${CTE}
  SELECT
    (SELECT count(*) FROM ps)        AS used_4type,
    (SELECT count(*) FROM matched)   AS matched,
    (SELECT count(*) FROM unmatched) AS gap,
    (SELECT count(*) FROM bucketed WHERE bucket LIKE 'B1_LEAKY%') AS b1_leaky;`);

// ── ② B1_LEAKY used-session freeze(박제) ──
out.step2_b1_freeze = await q(`${CTE}
  SELECT session_id, left(check_in_id::text,8) AS ci8, session_type AS used_session_type
  FROM bucketed WHERE bucket LIKE 'B1_LEAKY%' ORDER BY check_in_id, session_type;`);

// ── ③ per-row: B1_LEAKY check_in 의 CASE→NULL(session_type=NULL) CIS 라인 판별근거 덤프 ──
//    (PHI-safe: service 메타 + price + 절단 ci id 만)
out.step3_leaky_service_lines = await q(`${CTE}
  SELECT DISTINCT left(b.check_in_id::text,8) AS ci8, b.session_type AS used_session_type,
         m.service_code, m.service_name, m.category, m.category_label, m.price
  FROM bucketed b
  JOIN cis_map m ON m.check_in_id=b.check_in_id AND m.session_type IS NULL
  WHERE b.bucket LIKE 'B1_LEAKY%'
  ORDER BY 1, m.service_code NULLS LAST, m.service_name;`);

// ── ③b: leaky 서비스 aggregate (서비스별 빈도 — widen 후보 후순위 판단용) ──
out.step3b_leaky_service_freq = await q(`${CTE}
  SELECT m.service_code, m.service_name, m.category_label, count(DISTINCT b.check_in_id) AS n_checkins
  FROM bucketed b
  JOIN cis_map m ON m.check_in_id=b.check_in_id AND m.session_type IS NULL
  WHERE b.bucket LIKE 'B1_LEAKY%'
  GROUP BY 1,2,3 ORDER BY n_checkins DESC, m.service_name;`);

console.log(JSON.stringify(out, null, 2));

// ── freeze 정합 assert (16 기대) ──
const b1n = Number(out.step1_totals?.[0]?.b1_leaky ?? -1);
const gapn = Number(out.step1_totals?.[0]?.gap ?? -1);
console.error(`\n[freeze] B1_LEAKY=${b1n} (기대 16) · gap=${gapn} (기대 39) · frozen_ids=${(out.step2_b1_freeze||[]).length}`);
if (b1n !== 16 || gapn !== 39) {
  console.error('[ABORT-SIGNAL] freeze셋 이탈 — 검토 시점 대상셋(gap39/B1_LEAKY16)과 불일치. 대상셋 재확정 전 widen 진입 금지(SOP §2-F).');
}
