/**
 * PROD APPLY — T-20260730-foot-CLOSING-READER-DB-PROVISION (매출전령 수신측 foot 리더 프로비저닝)
 * file:   supabase/migrations/20260730160000_foot_closing_reader_provision.sql
 * 계약:   DA-REPLY-...-reader-registry §3(fn 시그니처)·§4(role/grant/REVOKE) / 롱레·body golden idiom 동형.
 * gate:   전건 ADDITIVE(CREATE FUNCTION SECDEF / CREATE ROLE 2종 / GRANT+REVOKE) → autonomy §3.1 대표게이트 면제.
 *         db_change=true → supervisor DDL-diff + 42501 적대실증 게이트로 배포.
 * safety: 신규 자산 = fn read_closing_confirmed_events + role mgosu_outbox_reader(NOLOGIN) +
 *         mgosu_outbox_reader_login(NOLOGIN, 비번 미주입) 뿐. 테이블/컬럼/RLS/데이터 무변경.
 * ★ 2단 절차:
 *     (1) 본 러너 --apply : 마이그 up 영속 + ledger. (login role 은 NOLOGIN·비번 없음 → 아직 접속 불가.)
 *     (2) 비번 주입(별도 git-미커밋): ~/.config/medibuilder-secrets/foot-outbox-reader-login-apply.sql
 *         = ALTER ROLE mgosu_outbox_reader_login LOGIN PASSWORD '<gen>';  (supervisor prod exec 전용)
 *     (3) 42501 적대실증(비번 주입 후): psql pooler 접속 실증 — 하단 POSTCHECK 명령 참조.
 * dryrun(무영속 PASS·post-probe absent): dev-foot 통과(scripts/dryrun_foot_closing_reader_provision_T-20260730.mjs).
 * method: prod REF pre-probe(outbox present + fn/roles 부재) → 마이그 실행 → ledger → 증거기반 post-probe(grant matrix).
 * mode:   기본 PRE(read-only probe) / --apply PROD 착지.
 * 실행:   node scripts/apply_foot_closing_reader_provision_PROD_SUPERVISOR_T-20260730.mjs         # PRE(read-only)
 *         node scripts/apply_foot_closing_reader_provision_PROD_SUPERVISOR_T-20260730.mjs --apply # PROD 착지
 */
import { readFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260730160000';
const NAME = '20260730160000_foot_closing_reader_provision';
const UP = new URL('../supabase/migrations/20260730160000_foot_closing_reader_provision.sql', import.meta.url);

const PROBE = `
  SELECT
    (SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='closing_confirmed_outbox')) AS outbox_tbl,
    (SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='read_closing_confirmed_events')) AS read_fn,
    (SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mgosu_outbox_reader')) AS role_nologin,
    (SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mgosu_outbox_reader_login')) AS role_login,
    (SELECT rolcanlogin FROM pg_roles WHERE rolname='mgosu_outbox_reader_login') AS login_canlogin;`;

const GRANTS = `
  SELECT
    has_schema_privilege('mgosu_outbox_reader','public','USAGE') AS reader_usage,
    has_function_privilege('mgosu_outbox_reader','public.read_closing_confirmed_events(timestamptz,uuid,int)','EXECUTE') AS reader_fn_exec,
    has_function_privilege('anon','public.read_closing_confirmed_events(timestamptz,uuid,int)','EXECUTE') AS anon_fn_exec,
    has_function_privilege('authenticated','public.read_closing_confirmed_events(timestamptz,uuid,int)','EXECUTE') AS auth_fn_exec,
    has_table_privilege('mgosu_outbox_reader','public.closing_confirmed_outbox','SELECT') AS reader_outbox_sel,
    pg_has_role('mgosu_outbox_reader_login','mgosu_outbox_reader','MEMBER') AS login_in_reader;`;

console.log(`[foot-CLOSING-READER] target=rxlomoozakkjesdqjtvd(prod) mode=${APPLY ? 'APPLY' : 'PRE(read-only)'}`);
const pre = (await q(PROBE))[0];
console.log('pre-probe:', JSON.stringify(pre));
if (!pre.outbox_tbl) { console.error('ABORT: closing_confirmed_outbox 부재 (emit-side 미배포).'); process.exit(1); }
if (pre.read_fn || pre.role_nologin || pre.role_login) console.warn('NOTE: 리더 객체 일부 이미 존재 — 멱등(CREATE OR REPLACE / DO 가드 / GRANT) 재적용됨.');

if (!APPLY) { console.log('PRE 모드 종료 (--apply 로 착지).'); process.exit(0); }

const sql = readFileSync(UP, 'utf8');
await q(sql);
await q(`INSERT INTO supabase_migrations.schema_migrations (version, name)
         VALUES ('${VERSION}', '${NAME}')
         ON CONFLICT (version) DO NOTHING;`);

const post = (await q(PROBE))[0];
const g = (await q(GRANTS))[0];
console.log('post-probe:', JSON.stringify(post));
console.log('grant-matrix:', JSON.stringify(g));

const ok = post.read_fn && post.role_nologin && post.role_login && post.login_canlogin === false
  && g.reader_usage && g.reader_fn_exec && !g.anon_fn_exec && !g.auth_fn_exec && !g.reader_outbox_sel && g.login_in_reader;
console.log(ok
  ? '✅ foot-CLOSING-READER PROD apply OK (fn + roles + grants 정합, login NOLOGIN·비번 주입 대기)'
  : '❌ post/grant-probe 불일치 — DDL-diff 재확인');

console.log(`
── 다음 단계 (supervisor) ─────────────────────────────────────────────
(2) 비번+LOGIN 주입 (git-미커밋, prod exec):
    psql "<postgres admin DSN>" -f ~/.config/medibuilder-secrets/foot-outbox-reader-login-apply.sql
    # = ALTER ROLE mgosu_outbox_reader_login LOGIN PASSWORD '<gen>';
(3) 42501 적대실증 (비번 주입 후, reader DSN 으로 pooler 접속):
    URI="$(grep '^OUTBOX_READER_URI=' ~/.config/medibuilder-secrets/foot-supabase-outbox-reader-key | cut -d= -f2- | tr -d '\"')"
    psql "$URI" -tAc "SELECT count(*) FROM public.read_closing_confirmed_events(NULL);"  # 성공(count)
    psql "$URI" -tAc "SELECT 1 FROM public.closing_confirmed_outbox LIMIT 1;"            # 42501 기대
    psql "$URI" -tAc "SELECT 1 FROM public.customers LIMIT 1;"                           # 42501 기대(PHI)
(4) applied_at 기입 + C2(b) 격리 재확인(reader DSN ≠ service_role/write 토큰).
────────────────────────────────────────────────────────────────────`);
process.exit(ok ? 0 : 1);
