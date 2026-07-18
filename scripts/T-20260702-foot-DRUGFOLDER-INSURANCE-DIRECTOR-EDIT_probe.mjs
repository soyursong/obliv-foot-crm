/**
 * T-20260702-foot-DRUGFOLDER-INSURANCE-DIRECTOR-EDIT — PROD 라이브 스냅샷 (READ-ONLY)
 * 목적(G2 CONSULT 근거): 급여여부(prescription_codes.insurance_status) write RLS 가
 *   실제 PROD 에서 director 를 이미 포함하는지 확인.
 *   - is_admin_or_manager() 함수 body 실측 (director 포함 여부)
 *   - prescription_codes 정책 전량 (write=prescription_codes_admin_all 의 qual/with_check)
 * DDL 0 · 데이터 mutation 0. author: dev-foot / 2026-07-18
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

// 1) is_admin_or_manager() 함수 정의 실측
out.fn_is_admin_or_manager = await q(`
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='is_admin_or_manager';`);

// 2) prescription_codes 정책 전량 (write 정책의 qual/with_check)
out.prescription_codes_policies = await q(`
  SELECT policyname, cmd, roles, qual, with_check
  FROM pg_policies
  WHERE schemaname='public' AND tablename='prescription_codes'
  ORDER BY cmd, policyname;`);

// 3) director/admin/manager 계정 카운트 (문지은 대표원장 = director)
out.director_accounts = await q(`
  SELECT role, active, count(*)
  FROM public.user_profiles
  WHERE role IN ('admin','manager','director')
  GROUP BY role, active
  ORDER BY role;`);

console.log(JSON.stringify(out, null, 2));
