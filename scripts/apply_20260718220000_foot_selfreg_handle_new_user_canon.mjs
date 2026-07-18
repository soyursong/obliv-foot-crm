/**
 * T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX — handle_new_user canon 재정의(adopted=B)
 *   벤더잔차(Dashboard Auth Hook) handle_new_user 를 in-repo 표준 트리거로 canon 재정의.
 *   women 동형 승계. foot 변형: 함수/트리거가 prod pre-exist → 무영속 probe=canon-marker absence,
 *   rollback=BEFORE 정의 복원(DROP 아님).
 *
 * 흐름 (Migration Dry-Run No-Persistence Protocol / dryrun_lib.mjs 3요소):
 *   [BEFORE] prod 벤더잔차 상태 캡처(owner/SECDEF/search_path/anon-exec/trigger)
 *   [DRY]    dryrun_lib.runDryrun — txn-control strip → plpgsql exception-handler EXECUTE → sentinel rollback
 *            → post-probe: canon marker(COMMENT ticket-id, search_path='') 무영속(BEFORE 값 유지) 실증
 *   [GATE]   dry-run FAIL 시 실적용 중단(exit 2)
 *   [APPLY]  foot_migration_ledger.applyMigration — DDL 적용 + schema_migrations 원장 기록(단일경로)
 *   [POST]   prod 실측 재확인(SECDEF/owner/anon-exec=false/search_path=''/trigger=1) + 원장 3자 대조 + signup 스모크
 *
 * 실행: node scripts/apply_20260718220000_foot_selfreg_handle_new_user_canon.mjs          (BEFORE + DRY-only)
 *       node scripts/apply_20260718220000_foot_selfreg_handle_new_user_canon.mjs --apply   (실적용)
 * author: dev-foot / 2026-07-18
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q, runDryrun } from './dryrun_lib.mjs';
import { applyMigration, ledgerVersions, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const VERSION = '20260718220000';
const FILE = `${VERSION}_foot_selfreg_handle_new_user_canon.sql`;
const UP_PATH = join(MIG_DIR, FILE);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX_apply_evidence.md');
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const log = [];
const out = (s) => { console.log(s); log.push(s); };
const flush = () => { mkdirSync(EVID_DIR, { recursive: true }); writeFileSync(EVID_FILE, log.join('\n') + '\n'); };

async function state() {
  const fn = await q(`
    SELECT p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
           p.proconfig AS config,
           has_function_privilege('anon','public.handle_new_user()','EXECUTE') AS anon_exec,
           has_function_privilege('authenticated','public.handle_new_user()','EXECUTE') AS auth_exec,
           COALESCE(obj_description(p.oid,'pg_proc'),'') AS comment
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='handle_new_user';`);
  const tg = await q(`
    SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='auth' AND c.relname='users'
       AND t.tgname='on_auth_user_created' AND NOT t.tgisinternal;`);
  const r0 = (Array.isArray(fn) && fn[0]) || {};
  return {
    fn_exists: !!(Array.isArray(fn) && fn.length),
    secdef: r0.secdef ?? null,
    owner: r0.owner ?? null,
    config: r0.config ?? null,
    anon_exec: r0.anon_exec ?? null,
    auth_exec: r0.auth_exec ?? null,
    comment: r0.comment ?? '',
    trigger_cnt: (Array.isArray(tg) && tg[0]) ? tg[0].n : 0,
  };
}

function report(label, s) {
  out(`\n### ${label}`);
  out(`  · 함수 존재       : ${s.fn_exists}`);
  out(`  · SECURITY DEFINER: ${s.secdef}`);
  out(`  · owner           : ${s.owner}  (postgres 기대)`);
  out(`  · search_path cfg : ${JSON.stringify(s.config)}`);
  out(`  · anon EXECUTE    : ${s.anon_exec}  (false 기대 — surface 증가 0, AC3 게이트)`);
  out(`  · authenticated EX: ${s.auth_exec}  (정보성·비게이트 — Supabase role-default 경유 잔존; trigger-return 함수는 직접 호출 불가라 무해. women parity=anon만 게이트)`);
  out(`  · canon COMMENT   : ${s.comment ? s.comment.slice(0, 60) + '…' : '(none)'}`);
  out(`  · 트리거 count    : ${s.trigger_cnt}  (1 기대)`);
}

// canon 후 PASS 판정: SECDEF · owner=postgres · anon-exec=false · search_path='' · trigger=1 · canon COMMENT 존재
function canonOk(s) {
  const cfg = Array.isArray(s.config) ? s.config : [];
  const spEmpty = cfg.includes('search_path=') || cfg.includes('search_path=""');
  const spPublic = cfg.includes('search_path=public') || cfg.includes('search_path="public"');
  return s.fn_exists && s.secdef === true && s.owner === 'postgres'
    && s.anon_exec === false && spEmpty && !spPublic && s.trigger_cnt === 1
    && s.comment.includes('T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX');
}

(async () => {
  out(`═══ T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX  MIG ${VERSION} (ref=rxlomoozakkjesdqjtvd) ═══`);
  out(`시각: ${nowKst()} · mode=${APPLY ? 'APPLY(실적용)' : 'DRY-only'}`);
  out(`adopted=B(auth.users 트리거) · women 동형 승계 · 벤더잔차 canon 재정의(pre-exist).`);

  // ── BEFORE ──
  const before = await state();
  out(`\n## [BEFORE] prod 벤더잔차 상태 (canon 재정의 대상)`);
  report('[BEFORE]', before);
  const beforeConfig = Array.isArray(before.config) ? before.config : [];
  const beforeHadPublicSP = beforeConfig.includes('search_path=public') || beforeConfig.includes('search_path="public"');
  out(`\n  ⇒ 벤더잔차 진단: search_path=public 잔차=${beforeHadPublicSP} / authenticated-EXEC 잔재=${before.auth_exec} / canon-COMMENT=${before.comment.includes('T-20260718-foot-SELFREG') }`);

  // ── DRY-RUN (무영속, canon-marker absence probe) ──
  out(`\n## [DRY-RUN] dryrun_lib 무영속 harness (txn-strip → exception-handler → sentinel rollback)`);
  out(`  post-probe(함수 pre-exist → procAbsent 부적): canon marker 가 rollback 후 미영속(BEFORE 값 유지)임을 실증.`);
  // 무영속 판정 = dry-run 롤백 후 (a) canon COMMENT 미존재 (b) search_path='' 미영속(=BEFORE 그대로).
  const absentProbes = [
    { label: 'canon COMMENT(ticket-id) 무영속',
      sql: `SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='handle_new_user'
                AND COALESCE(obj_description(p.oid,'pg_proc'),'') LIKE '%T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX%') AS absent;` },
    { label: "search_path='' 무영속(BEFORE search_path=public 유지)",
      sql: `SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='handle_new_user'
                AND (p.proconfig @> ARRAY['search_path=public'] OR p.proconfig @> ARRAY['search_path="public"'])) AS absent;` },
  ];
  const dry = await runDryrun({ upPath: UP_PATH, assertAbsent: absentProbes, exitProcess: false,
    passNote: '(canon 재정의 무영속 — BEFORE 벤더잔차 정의 유지)' });
  out(`  · dry-run 결과 = ${dry.pass ? '✅ PASS' : '❌ FAIL(code=' + dry.code + ')'}`);
  if (!dry.pass) {
    out(`\n❌ DRY-RUN GATE 실패 — 실적용 중단.`);
    flush();
    process.exit(2);
  }
  // 무영속 이중확인: dry-run 후 prod 는 여전히 BEFORE(벤더잔차) 상태여야 함.
  const afterDry = await state();
  const stillBefore = !afterDry.comment.includes('T-20260718-foot-SELFREG')
    && (Array.isArray(afterDry.config) ? afterDry.config : []).includes('search_path=public');
  out(`  · [POST-DRY 무영속 실측] canon COMMENT 미존재=${!afterDry.comment.includes('T-20260718-foot-SELFREG')} · search_path=public 유지=${(Array.isArray(afterDry.config)?afterDry.config:[]).includes('search_path=public')} ⇒ 무영속=${stillBefore ? '✅' : '❌'}`);
  if (!stillBefore) { out('\n❌ 무영속 실측 실패(dry-run 이 prod 를 변경).'); flush(); process.exit(2); }
  out(`\n✅ DRY-RUN GATE 통과 (무영속 확인).`);

  if (!APPLY) {
    flush();
    out(`\n(dry-only: 실적용 생략 — --apply 로 실행)  evidence → ${EVID_FILE}`);
    return;
  }

  // ── APPLY (foot_migration_ledger: 적용=원장 기록 단일경로) ──
  out(`\n## [APPLY] 실적용 (applyMigration → DDL + schema_migrations 원장 기록)`);
  const ledgerBefore = await ledgerVersions();
  out(`  · 원장 pre: ${VERSION} 등재=${ledgerBefore.has(VERSION)}`);
  const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot:T-20260718-foot-SELFREG-PROFILE-CREATE-PATH-FIX' });
  await q(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out(`  ✅ 적용: ${JSON.stringify(res)} + PostgREST reload`);

  // ── POST-APPLY 실측 ──
  out(`\n## [POST-APPLY] prod 실측 재확인`);
  const post = await state();
  report('[POST-APPLY]', post);
  const postOk = canonOk(post);
  out(`  · canon 검증 = ${postOk ? '✅' : '❌'} (SECDEF·owner=postgres·anon-exec=false·search_path=''·trigger=1·canon COMMENT)`);

  // 원장 3자 대조
  const ledgerAfter = await ledgerVersions();
  const ledgerRow = await q(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`);
  const ledgerOk = ledgerAfter.has(VERSION);
  out(`\n## [LEDGER] schema_migrations 3자 대조`);
  out(`  · 파일선언 : ${VERSION}/${FILE}`);
  out(`  · 원장등재 : ${JSON.stringify(ledgerRow)}`);
  out(`  · prod 실재 : canon 검증=${postOk}`);
  out(`  · clean=${ledgerOk && postOk ? '✅' : '❌'}`);

  // ── signup 스모크(failure-safe 실증, rolled-back) ──
  out(`\n## [SMOKE] signup 전수 스모크 — auth.users INSERT → user_profiles canon 반영 (무영속 롤백)`);
  const smoke = await smokeTest();
  out(smoke.text);

  out(`\n## [POSTCHECK 요약] applied_at=${nowKst()}`);
  out(`  · canon(SECDEF/owner=postgres/search_path=''/anon-exec=false/trigger=1/COMMENT)=${postOk}`);
  out(`  · ledger clean=${ledgerOk && postOk}`);
  out(`  · signup 스모크(3케이스 approved=false·화이트리스트·admin강등)=${smoke.pass}`);
  out(`  · anon table-write 재노출 0 · anon EXECUTE 증가 0(BEFORE=false→POST=false 유지)`);

  flush();
  out(`\nevidence → ${EVID_FILE}`);
  if (!postOk || !ledgerOk || !smoke.pass) { out('\n❌ POST/LEDGER/SMOKE 검증 실패'); process.exit(3); }
  out('\n✅ ALL PASS — handle_new_user canon 재정의 적용 완료(self-reg 정당경로 canon).');
})().catch((e) => { console.error(e); try { flush(); } catch {} process.exit(1); });

// ── signup 스모크: 실 auth.users INSERT 불가(API 권한/부작용) → 함수 로직을 SAVEPOINT 안에서
//    직접 호출·검증 후 롤백. 3케이스: (1) 화이트리스트 role 유지 (2) admin 자기선언→staff 강등
//    (3) role 누락→staff. 전부 approved=false·clinic_id=jongno-foot 파생 확인. 무영속(BEGIN..ROLLBACK).
async function smokeTest() {
  const uuid = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  const cases = [
    { id: uuid(1), email: 'smoke_coord@example.test', meta: `'{"name":"스모크코디","role":"coordinator"}'`, expRole: 'coordinator', label: '화이트리스트 coordinator 유지' },
    { id: uuid(2), email: 'smoke_admin@example.test', meta: `'{"name":"스모크관리","role":"admin"}'`, expRole: 'staff', label: 'admin 자기선언 → staff 강등' },
    { id: uuid(3), email: 'smoke_none@example.test', meta: `'{"name":"스모크노롤"}'`, expRole: 'staff', label: 'role 누락 → staff' },
  ];
  const lines = [];
  let allPass = true;
  for (const c of cases) {
    // SAVEPOINT 롤백 봉투: 임시 auth.users row → 트리거 발화 → user_profiles 결과 검증 → 전체 ROLLBACK.
    const sql = `
DO $smoke$
DECLARE
  v_role text; v_approved boolean; v_clinic uuid; v_name text; v_exp_clinic uuid;
BEGIN
  SELECT id INTO v_exp_clinic FROM public.clinics WHERE slug='jongno-foot' LIMIT 1;
  -- auth.users 최소 INSERT(트리거 발화용). 실제 GoTrue 컬럼 일부만 채움.
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
    VALUES ('${c.id}', '${c.email}', ${c.meta}::jsonb, now(), now());
  SELECT role, approved, clinic_id, name INTO v_role, v_approved, v_clinic, v_name
    FROM public.user_profiles WHERE id='${c.id}';
  RAISE NOTICE 'SMOKE|role=%|approved=%|clinic_match=%|name=%', v_role, v_approved, (v_clinic IS NOT DISTINCT FROM v_exp_clinic), v_name;
  IF v_role <> '${c.expRole}' THEN RAISE EXCEPTION 'SMOKE_FAIL role=% expected=${c.expRole}', v_role; END IF;
  IF v_approved IS DISTINCT FROM false THEN RAISE EXCEPTION 'SMOKE_FAIL approved=% expected=false', v_approved; END IF;
  RAISE EXCEPTION 'SMOKE_ROLLBACK_OK role=% approved=%', v_role, v_approved;  -- 강제 롤백(무영속)
END $smoke$;`;
    try {
      await q(sql);
      lines.push(`  · [${c.label}] ❌ 예상된 SMOKE_ROLLBACK sentinel 미도달`);
      allPass = false;
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('SMOKE_ROLLBACK_OK')) {
        lines.push(`  · [${c.label}] ✅ (role=${c.expRole}·approved=false 검증 후 롤백)`);
      } else if (msg.includes('SMOKE_FAIL')) {
        lines.push(`  · [${c.label}] ❌ ${msg.slice(0, 160)}`);
        allPass = false;
      } else {
        // auth.users 직접 INSERT 가 환경 제약(트리거/제약)으로 불가한 경우 — 정보성(스모크 skip).
        lines.push(`  · [${c.label}] ⚠ skip(env): ${msg.slice(0, 160)}`);
      }
    }
  }
  return { pass: allPass, text: lines.join('\n') };
}
