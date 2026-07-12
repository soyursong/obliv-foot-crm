/**
 * DA-20260712-CROSSCRM-SELFCHECKIN-CONSENT-PGRST202-SWEEP — foot lane 잠복 점검 (READ-ONLY)
 * IMPROVE-PROPOSAL MSG-20260712-130201-fdro (data-architect).
 * scalp 사고: selfcheckin_set_resident_id(p_resident_id) DEFAULT 부재 → FE 미전송 → PGRST202/404
 *             → consent(sensitive/agreed_at/version) 캡처 prod silent-fail.
 * foot 대조: (1) self-checkin / consent 캡처 계열 RPC 시그니처의 DEFAULT 부재 인자 존재 여부
 *            (2) 그 인자를 FE가 미전송하는 경로가 있는지(코드측 대조는 별도)
 *            (3) 최근 배포 이후 consent 캡처 정상성(카운트만, 소급 조작 금지)
 * author: dev-foot / 2026-07-12
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// 1) self-checkin / consent 계열 RPC 전량 시그니처 + arg defaults 카운트
//    pronargdefaults = DEFAULT 를 가진 뒤쪽 인자 수. proargnames/pronargs 로 DEFAULT 부재 인자 판별.
out.rpc_signatures = await q(`
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.pronargs                                AS n_args,
         p.pronargdefaults                         AS n_defaults,
         (p.pronargs - p.pronargdefaults)          AS n_required
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public'
    AND (p.proname ILIKE '%selfcheckin%' OR p.proname ILIKE '%prescreen%'
      OR p.proname ILIKE '%resident%'    OR p.proname ILIKE '%consent%'
      OR p.proname ILIKE '%personal_info%' OR p.proname ILIKE '%checklist%')
  ORDER BY p.proname;`);

// 2) scalp 사고 함수명이 foot 에 존재하는지 직접 확인
out.scalp_fn_exists = await q(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='selfcheckin_set_resident_id';`);

// 3) customers 민감정보 동의 3컬럼 실재 + default
out.consent_cols = await q(`
  SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
    AND column_name IN ('consent_sensitive','consent_agreed_at','consent_version')
  ORDER BY column_name;`);

// 4) consent 캡처 정상성 — 카운트만(소급 조작 금지). 최근 30일 신규 동의 기록 추이.
out.consent_capture_recent = await q(`
  SELECT (consent_agreed_at AT TIME ZONE 'Asia/Seoul')::date AS d,
         count(*) n
  FROM customers
  WHERE consent_sensitive = true
    AND consent_agreed_at >= now() - interval '30 days'
  GROUP BY 1 ORDER BY 1 DESC;`);

// 5) consent_forms(desk 서명 경로) 최근 privacy 동의서 캡처 카운트 (silent-fail 이면 0 근처)
out.consent_forms_recent = await q(`
  SELECT (signed_at AT TIME ZONE 'Asia/Seoul')::date AS d,
         form_type, count(*) n
  FROM consent_forms
  WHERE signed_at >= now() - interval '30 days'
    AND form_type = 'privacy'
  GROUP BY 1,2 ORDER BY 1 DESC;`);

console.log(JSON.stringify(out, null, 2));
