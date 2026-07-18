/**
 * T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX — BEFORE prod introspection (AC2)
 *   벤더잔차(Dashboard Auth Hook) handle_new_user / on_auth_user_created 실측 캡처.
 *   owner/SECDEF/search_path/supabase_admin 잔차 상태 + user_profiles grants/CHECK + slug 확인.
 *   read-only. author: dev-foot / 2026-07-18
 */
import { q } from './dryrun_lib.mjs';
const j = (x) => JSON.stringify(x, null, 2);
(async () => {
  console.log('== [BEFORE] foot prod introspection (ref rxlomoozakkjesdqjtvd) ==');
  const fn = await q(`
    SELECT p.proname,
           pg_catalog.pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef AS secdef,
           p.proconfig AS config,
           has_function_privilege('anon','public.handle_new_user()','EXECUTE') AS anon_exec,
           has_function_privilege('authenticated','public.handle_new_user()','EXECUTE') AS auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='handle_new_user';`).catch(e=>({error:String(e.message||e)}));
  console.log('\n[FN public.handle_new_user]', j(fn));
  const trig = await q(`
    SELECT t.tgname, p.proname AS fn_name, n2.nspname AS fn_schema,
           pg_catalog.pg_get_userbyid(p.proowner) AS fn_owner, p.prosecdef AS fn_secdef
      FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n2 ON n2.oid=p.pronamespace
     WHERE n.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal;`).catch(e=>({error:String(e.message||e)}));
  console.log('\n[TRIGGERS auth.users non-internal]', j(trig));
  const grants = await q(`
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='user_profiles'
       AND grantee IN ('anon','authenticated') ORDER BY grantee, privilege_type;`).catch(e=>({error:String(e.message||e)}));
  console.log('\n[user_profiles grants anon/authenticated]', j(grants));
  const chk = await q(`
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid='public.user_profiles'::regclass AND contype='c';`).catch(e=>({error:String(e.message||e)}));
  console.log('\n[user_profiles CHECK constraints]', j(chk));
  const clinic = await q(`SELECT id, slug, name FROM public.clinics WHERE slug='jongno-foot';`).catch(e=>({error:String(e.message||e)}));
  console.log('\n[clinics jongno-foot]', j(clinic));
  const cols = await q(`
    SELECT column_name, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema='public' AND table_name='user_profiles'
       AND column_name IN ('id','email','name','role','clinic_id','approved','active') ORDER BY column_name;`).catch(e=>({error:String(e.message||e)}));
  console.log('\n[user_profiles relevant columns]', j(cols));
})();
