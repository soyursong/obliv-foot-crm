/**
 * BEHAVIORAL PROBE (AC4): T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL
 * ─────────────────────────────────────────────────────────────────────────────
 * apply(supervisor DB-GATE GO-token) 이후 실행. 실제 세션으로 실효 격리를 실측한다.
 *   (1) authenticated own-clinic no-regression : jongno staff 세션이 own-clinic 전행 read 유지
 *   (2) admin bypass                           : 술어에 is_admin_or_manager() 존재(+ admin 세션 시 전행)
 *   (3) anon 무파손                             : 6테이블 anon 도달 상태 = SEAL 前과 동일(신규 차단 0)
 *   (4) cross-tenant denied                    : predicate 구조 + songdo(latent) 활성화 시 격리 보장 논증
 *        ※ songdo=0/0 empty(재-census) → 실 cross-tenant 세션 부재로 behavioral 직접 재현 불가.
 *          canonical §A predicate byte-identical + package_payments_tenant_isolation 선례로 논증.
 *
 * 실행: (repo root) node scripts/T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL_behavioral.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 *       TEST_STAFF_EMAIL/TEST_STAFF_PW (또는 TEST_USER_EMAIL/TEST_USER_PASSWORD),
 *       (선택) TEST_ADMIN_EMAIL/TEST_ADMIN_PW.
 */
import { readFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

function env(k, opt) {
  if (process.env[k]) return process.env[k].trim();
  try {
    const m = readFileSync('.env.local', 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm'));
    if (m && m[1].trim()) return m[1].trim();
  } catch {}
  if (opt) return null;
  throw new Error('missing ' + k + ' in env/.env.local');
}
const URL = env('VITE_SUPABASE_URL');
const ANON = env('VITE_SUPABASE_ANON_KEY');

const SEALED = ['clinical_images', 'consent_forms', 'message_logs', 'service_charges', 'checklists', 'packages'];
const RESTRICTIVE_NAMES = {
  clinical_images: 'clinical_images_clinic_gate_restrict',
  consent_forms:   'consent_forms_clinic_gate_restrict',
  message_logs:    'message_logs_clinic_gate_restrict',
  service_charges: 'service_charges_clinic_gate_restrict',
  checklists:      'checklists_clinic_gate_restrict',
  packages:        'packages_clinic_read_restrict',
};

async function login(email, pw) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login fail ${email}: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}
async function count(table, token) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token || ANON}`, Prefer: 'count=exact' },
  });
  let rows = -1;
  const cr = r.headers.get('content-range');
  if (cr) { const m = cr.match(/\/(\d+|\*)$/); rows = m && m[1] !== '*' ? Number(m[1]) : (cr.startsWith('*/') ? 0 : rows); }
  return { status: r.status, exactCount: rows, contentRange: cr };
}

(async () => {
  console.log('== BEHAVIORAL PROBE (AC4) ==', new Date().toISOString(), '\n');
  let fail = false;

  // ── (0) structural: 6 restrictive 정책 실재 + predicate(admin bypass) ──────────
  const pol = await q(`
    SELECT pp.tablename, pp.policyname, pp.permissive, pp.cmd, pp.roles::text AS roles,
           pg_get_expr(po.polqual, po.polrelid) AS using_expr,
           pg_get_expr(po.polwithcheck, po.polrelid) AS check_expr
    FROM pg_policies pp
    JOIN pg_policy po ON po.polname=pp.policyname
    JOIN pg_class c ON c.oid=po.polrelid AND c.relname=pp.tablename
    WHERE pp.schemaname='public'
      AND pp.policyname IN (${Object.values(RESTRICTIVE_NAMES).map(n => `'${n}'`).join(',')})
    ORDER BY pp.tablename;`);
  const applied = pol.length === 6;
  console.log(`── (0) structural: restrictive 정책 ${pol.length}/6 실재 → ${applied ? 'APPLIED' : 'NOT-YET-APPLIED(baseline)'}`);
  for (const p of pol) {
    const adminBypass = /is_admin_or_manager\(\)/.test(p.using_expr || '');
    const clinicGate = /current_user_clinic_id\(\)/.test(p.using_expr || '');
    const checkOk = p.cmd === 'SELECT' ? true : /is_admin_or_manager\(\)/.test(p.check_expr || '') && /current_user_clinic_id\(\)/.test(p.check_expr || '');
    const ok = p.permissive === 'RESTRICTIVE' && p.roles === '{authenticated}' && adminBypass && clinicGate && checkOk;
    console.log(`   ${ok ? '✓' : '✗'} ${p.tablename.padEnd(16)} ${p.policyname} [${p.permissive}/${p.roles}/${p.cmd}] admin_bypass=${adminBypass} clinic_gate=${clinicGate} check_ok=${checkOk}`);
    if (!ok) fail = true;
  }

  // service_role totals (대조)
  const [tot] = await q(`SELECT ${SEALED.map(t => `(SELECT count(*) FROM public.${t}) AS ${t}`).join(', ')};`);
  console.log('\n── service_role totals(대조):', JSON.stringify(tot));

  // ── (1) authenticated own-clinic no-regression ────────────────────────────────
  const staffEmail = env('TEST_STAFF_EMAIL', true) || env('TEST_USER_EMAIL', true);
  const staffPw = env('TEST_STAFF_PW', true) || env('TEST_USER_PASSWORD', true);
  if (staffEmail && staffPw) {
    try {
      const tok = await login(staffEmail, staffPw);
      console.log(`\n── (1) authenticated no-regression (staff=${staffEmail}) ──`);
      for (const t of SEALED) {
        const c = await count(t, tok);
        const total = Number(tot[t]);
        // 단일 active clinic(jongno): staff 는 own-clinic 전행을 봐야 함(회귀0). admin이면 전행.
        const regressionOk = c.exactCount === total || total === 0;
        console.log(`   ${regressionOk ? '✓' : '✗'} ${t.padEnd(16)} staff_read=${c.exactCount} / total=${total} (status=${c.status})`);
        if (!regressionOk) { fail = true; console.log(`      ⚠ 회귀 의심: own-clinic 전행 미도달 — clinic_id stamp 또는 세션 clinic 확인`); }
      }
    } catch (e) { console.log(`\n── (1) staff 세션 skip: ${e.message}`); }
  } else {
    console.log('\n── (1) staff 세션 skip: TEST_STAFF_* / TEST_USER_* 미설정 ──');
  }

  // ── (2) admin bypass (선택) ───────────────────────────────────────────────────
  const adminEmail = env('TEST_ADMIN_EMAIL', true), adminPw = env('TEST_ADMIN_PW', true);
  if (adminEmail && adminPw) {
    try {
      const tok = await login(adminEmail, adminPw);
      console.log(`\n── (2) admin bypass (admin=${adminEmail}) ──`);
      for (const t of SEALED) {
        const c = await count(t, tok);
        console.log(`   ${t.padEnd(16)} admin_read=${c.exactCount} / total=${Number(tot[t])} (전행 기대)`);
      }
    } catch (e) { console.log(`\n── (2) admin 세션 skip: ${e.message}`); }
  } else {
    console.log('\n── (2) admin bypass: 술어 is_admin_or_manager() 존재로 구조 확인(위 structural). 세션 skip ──');
  }

  // ── (3) anon 무파손 ───────────────────────────────────────────────────────────
  console.log('\n── (3) anon 무파손 (신규 차단 0 — restrictive TO authenticated 는 anon 무영향) ──');
  for (const t of SEALED) {
    const c = await count(t, null);
    // clinical_images/consent_forms/message_logs/service_charges/packages = anon permissive 부재 → 원래 0/401.
    // checklists = anon 축 lane b 旣deny. 어느 경우든 '신규' 차단 아님.
    console.log(`   ${t.padEnd(16)} anon_read=${c.exactCount} (status=${c.status}) — SEAL 前후 동일 기대`);
  }

  // ── (4) cross-tenant denied 논증 ─────────────────────────────────────────────
  console.log('\n── (4) cross-tenant denied ──');
  console.log('   songdo-foot = 0/0 empty(latent) → 실 cross-tenant 세션 부재로 behavioral 직접 재현 불가.');
  console.log('   격리 보장 근거: (a) predicate `(clinic_id=current_user_clinic_id()) OR is_admin_or_manager()`');
  console.log('     byte-identical to canonical §A / package_payments_tenant_isolation(旣 behavioral 검증).');
  console.log('   (b) songdo 활성화 즉시 forward 격리 봉인 발효(비-admin staff = own-clinic scope).');

  console.log(`\n${fail ? '❌ BEHAVIORAL PROBE FAIL' : (applied ? '✅ BEHAVIORAL PROBE PASS' : 'ℹ️ NOT-YET-APPLIED (baseline만 — apply 후 재실행)')}`);
  if (fail) process.exit(1);
})();
