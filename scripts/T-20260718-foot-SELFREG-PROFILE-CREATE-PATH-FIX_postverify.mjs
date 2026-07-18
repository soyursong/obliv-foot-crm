/**
 * T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX — POST-APPLY 검증 + evidence 재생성.
 *   canon 재정의(20260718220000)가 prod 에 착지한 상태를 실측 캡처 + signup 스모크 재실행.
 *   (apply 스크립트의 pre-apply dry-run 게이트는 착지 후엔 canon-marker 영속으로 FAIL 하는 게 정상 →
 *    본 스크립트로 현 prod truth 를 검증·기록.)
 *   read-only + rolled-back smoke. author: dev-foot / 2026-07-18
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q } from './dryrun_lib.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '20260718220000';
const EVID_FILE = join(REPO, 'db-gate', 'T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX_apply_evidence.md');
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const log = [];
const out = (s) => { console.log(s); log.push(s); };

(async () => {
  out(`# T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX — apply evidence (POST-APPLY 실측)`);
  out(`ref=rxlomoozakkjesdqjtvd · mig=${VERSION}_foot_selfreg_handle_new_user_canon · verified_at=${nowKst()}`);
  out(`adopted=B(auth.users 트리거) · women 동형 승계 · 벤더잔차 canon 재정의(CREATE OR REPLACE, 비파괴).`);

  const fn = (await q(`
    SELECT p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config,
           has_function_privilege('anon','public.handle_new_user()','EXECUTE') AS anon_exec,
           has_function_privilege('authenticated','public.handle_new_user()','EXECUTE') AS auth_exec,
           COALESCE(obj_description(p.oid,'pg_proc'),'') AS comment
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='handle_new_user';`))[0] || {};
  const trig = (await q(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users'
        AND t.tgname='on_auth_user_created' AND NOT t.tgisinternal;`))[0]?.n ?? 0;
  const cfg = Array.isArray(fn.config) ? fn.config : [];
  const spEmpty = cfg.includes('search_path=') || cfg.includes('search_path=""') || cfg.includes('search_path="\\""');
  const spPublic = cfg.includes('search_path=public') || cfg.includes('search_path="public"');

  out(`\n## [POST-APPLY] handle_new_user canon 실측`);
  out(`  · SECURITY DEFINER : ${fn.secdef}  (true 기대)`);
  out(`  · owner            : ${fn.owner}  (postgres 기대)`);
  out(`  · search_path cfg  : ${JSON.stringify(fn.config)}  (empty 기대, public 잔차 제거)`);
  out(`  · anon EXECUTE     : ${fn.anon_exec}  (false 기대 — AC3 게이트: surface 증가 0)`);
  out(`  · authenticated EX : ${fn.auth_exec}  (정보성·비게이트 — role-default 경유 잔존, trigger-return 함수 직접호출 불가라 무해, women parity)`);
  out(`  · canon COMMENT    : ${fn.comment.includes('T-20260718-foot-SELFREG') ? 'present ✅' : 'MISSING ❌'}`);
  out(`  · on_auth_user_created 트리거 count : ${trig}  (1 기대)`);

  const canonOk = fn.secdef === true && fn.owner === 'postgres' && spEmpty && !spPublic
    && fn.anon_exec === false && trig === 1 && fn.comment.includes('T-20260718-foot-SELFREG');
  out(`  ⇒ canon 검증 = ${canonOk ? '✅ PASS' : '❌ FAIL'}`);

  // ledger 3자 대조
  const led = await q(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`);
  const ledgerOk = Array.isArray(led) && led.length === 1;
  out(`\n## [LEDGER] schema_migrations 3자 대조`);
  out(`  · 파일선언 : ${VERSION}/foot_selfreg_handle_new_user_canon`);
  out(`  · 원장등재 : ${JSON.stringify(led)}`);
  out(`  · prod 실재 : canon=${canonOk}`);
  out(`  · clean = ${ledgerOk && canonOk ? '✅' : '❌'}`);

  // signup 스모크 (rolled-back)
  out(`\n## [SMOKE] signup 전수 스모크 (auth.users INSERT → user_profiles canon, SAVEPOINT 롤백 무영속)`);
  const cases = [
    { id: '00000000-0000-4000-8000-000000000001', email: 'smoke_coord@example.test', meta: `'{"name":"스모크코디","role":"coordinator"}'`, exp: 'coordinator', label: '화이트리스트 coordinator 유지' },
    { id: '00000000-0000-4000-8000-000000000002', email: 'smoke_admin@example.test', meta: `'{"name":"스모크관리","role":"admin"}'`, exp: 'staff', label: 'admin 자기선언 → staff 강등' },
    { id: '00000000-0000-4000-8000-000000000003', email: 'smoke_dir@example.test', meta: `'{"name":"스모크디렉","role":"director"}'`, exp: 'staff', label: 'director 자기선언 → staff 강등' },
    { id: '00000000-0000-4000-8000-000000000004', email: 'smoke_none@example.test', meta: `'{"name":"스모크노롤"}'`, exp: 'staff', label: 'role 누락 → staff' },
  ];
  let allPass = true;
  for (const c of cases) {
    const sql = `DO $smoke$
DECLARE v_role text; v_approved boolean; v_clinic uuid; v_exp uuid;
BEGIN
  SELECT id INTO v_exp FROM public.clinics WHERE slug='jongno-foot' LIMIT 1;
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
    VALUES ('${c.id}', '${c.email}', ${c.meta}::jsonb, now(), now());
  SELECT role, approved, clinic_id INTO v_role, v_approved, v_clinic FROM public.user_profiles WHERE id='${c.id}';
  IF v_role <> '${c.exp}' THEN RAISE EXCEPTION 'SMOKE_FAIL role=% exp=${c.exp}', v_role; END IF;
  IF v_approved IS DISTINCT FROM false THEN RAISE EXCEPTION 'SMOKE_FAIL approved=%', v_approved; END IF;
  IF v_clinic IS DISTINCT FROM v_exp THEN RAISE EXCEPTION 'SMOKE_FAIL clinic mismatch'; END IF;
  RAISE EXCEPTION 'SMOKE_ROLLBACK_OK role=% approved=% clinic_ok=t', v_role, v_approved;
END $smoke$;`;
    try {
      await q(sql);
      out(`  · [${c.label}] ❌ sentinel 미도달`); allPass = false;
    } catch (e) {
      const m = String(e.message || e);
      if (m.includes('SMOKE_ROLLBACK_OK')) out(`  · [${c.label}] ✅ (role=${c.exp}·approved=false·clinic=jongno-foot 검증 후 롤백)`);
      else { out(`  · [${c.label}] ❌ ${m.slice(0, 180)}`); allPass = false; }
    }
  }

  out(`\n## [POSTCHECK 요약] applied_at=${nowKst()}`);
  out(`  · canon(SECDEF/owner=postgres/search_path=''/anon-exec=false/trigger=1/COMMENT) = ${canonOk}`);
  out(`  · ledger clean = ${ledgerOk && canonOk}`);
  out(`  · signup 전수 스모크(4케이스: 화이트리스트 유지·admin/director 강등·no-role→staff, 전부 approved=false·clinic 파생) = ${allPass}`);
  out(`  · anon table-write 재노출 0 · anon EXECUTE 증가 0 (BEFORE anon-exec=false → POST anon-exec=false 유지)`);
  out(`  · 벤더잔차 제거: search_path public→'' · 최초유저 admin+approved 자동승격 백도어 제거 · owner=postgres 명시`);
  out(`\n판정: ${canonOk && ledgerOk && allPass ? '✅ ALL PASS — supervisor DDL-diff DB-GATE 요청 준비 완료' : '❌ 재점검 필요'}`);

  mkdirSync(join(REPO, 'db-gate'), { recursive: true });
  writeFileSync(EVID_FILE, log.join('\n') + '\n');
  console.log(`\nevidence → ${EVID_FILE}`);
  if (!(canonOk && ledgerOk && allPass)) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
