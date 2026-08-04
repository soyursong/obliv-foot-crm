/**
 * T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — 배치 무영속 DRY-RUN 드라이버
 *
 * supervisor DDL-diff GO (MSG-20260805-073824-og8c) "apply 전 필수 #1" 이행:
 *   Migration Dry-Run No-Persistence Protocol (agents/docs/migration_dryrun_no_persistence_standard.md v1.0)
 *   = txn-control strip + plpgsql exception-handler 실행 + pre/post probe.
 *
 * ★ supervisor 경고: StageA #1(staff_attendance)·#2(waiting_board) SQL 에 파일 내장
 *    top-level BEGIN;…COMMIT; 존재 → dry-run 러너가 반드시 txn-control strip 후
 *    plpgsql exception-handler 로 실행(COMMIT 이 sentinel RAISE 이전 확정 = sentinel-bypass hazard).
 *   → 본 드라이버는 dryrun_lib.buildHarness() (stripTxnControl + sentinel + DO/EXCEPTION 래핑)를 사용해
 *     구조적으로 무영속을 보장한다. 실apply 는 무방(원문 BEGIN/COMMIT 정상 적용).
 *
 * ── 무영속 판정 = pre==post EQUALITY (INV-3 변형) ──
 *   본 배치는 07-01 이후 상태 혼재: StageA 3건은 이미 APPLIED(객체 존재),
 *   rx_audit_log/daily_room_status 는 여전히 MISSING(객체 부재), revoke-only 2건은 grant-state.
 *   → 순수 assertAbsent(부재 단언)는 이미-APPLIED 객체에서 위양성.
 *   → 각 대상 객체/권한을 harness 실행 前 pre-probe, 실행 後 post-probe 하여 **pre==post** 를 단언.
 *     dry-run 이 prod 상태를 1비트도 바꾸지 않았음(무영속)을 실측 증명한다.
 *
 * 사용: node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_batch_dryrun.mjs
 * author: dev-foot / 2026-08-05
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q as qRaw, buildHarness } from './dryrun_lib.mjs';

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// 429 ThrottlerException 재시도(지수 백오프). Management API throttle 대응.
async function q(sql) {
  let delay = 3000;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await qRaw(sql);
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('Throttler')) {
        process.stdout.write(`   ⏳ throttled — ${delay}ms 대기 후 재시도(${attempt + 1}/6)\n`);
        await sleepMs(delay);
        delay = Math.min(delay * 2, 30000);
        continue;
      }
      throw e;
    }
  }
  throw new Error('429 재시도 소진');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = join(__dirname, '../supabase/migrations');

// ── probe builders → {label, expr} 스칼라 식 (throttle 회피: 마이그당 1 round-trip 로 결합) ──
const P = {
  table: (t) => ({ label: `table ${t}`, expr: `(to_regclass('public.${t}') IS NOT NULL)` }),
  view: (t) => ({ label: `view ${t}`, expr: `(to_regclass('public.${t}') IS NOT NULL)` }),
  column: (t, c) => ({ label: `column ${t}.${c}`, expr: `EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name='${c}')` }),
  policy: (t, p) => ({ label: `policy ${p} on ${t}`, expr: `EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='${t}' AND policyname='${p}')` }),
  index: (i) => ({ label: `index ${i}`, expr: `EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='${i}')` }),
  trigger: (t, tr) => ({ label: `trigger ${tr} on ${t}`, expr: `EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${t}' AND g.tgname='${tr}' AND NOT g.tgisinternal)` }),
  func: (f) => ({ label: `function ${f}`, expr: `EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${f}')` }),
  rowcount: (t) => ({ label: `rowcount ${t}`, expr: `(SELECT count(*)::bigint FROM public.${t})` }),
  publication: (t) => ({ label: `publication supabase_realtime has ${t}`, expr: `EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='${t}')` }),
  // anon grant bits. null-safe: 테이블 부재(casualty) 시 NULL → pre==post 유지.
  priv: (t, verb) => ({ label: `anon ${verb} on ${t}`, expr: `CASE WHEN to_regclass('public.${t}') IS NULL THEN NULL ELSE has_table_privilege('anon','public.${t}','${verb}') END` }),
};

const privAll = (t) => ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'].map((verb) => P.priv(t, verb));

// ── batch: version → { file, probes } ──
const BATCH = [
  {
    version: '20260618200000', file: '20260618200000_staff_attendance_ssot.sql', stage: 'A#1',
    probes: [
      P.table('staff_attendance'), P.index('staff_attendance_clinic_date_idx'),
      P.policy('staff_attendance', 'staff_attendance_select'), P.policy('staff_attendance', 'staff_attendance_insert'),
      P.policy('staff_attendance', 'staff_attendance_update'), P.policy('staff_attendance', 'staff_attendance_delete'),
    ],
  },
  {
    version: '20260628200000', file: '20260628200000_waiting_board_projection.sql', stage: 'A#2',
    probes: [
      P.table('waiting_board'), P.func('mask_display_name'), P.func('sync_waiting_board'),
      P.trigger('check_ins', 'trg_sync_waiting_board'), P.policy('waiting_board', 'waiting_board_select'),
      P.index('idx_waiting_board_clinic_queue'), P.publication('waiting_board'), P.rowcount('waiting_board'),
    ],
  },
  {
    version: '20260625140000', file: '20260625140000_foreign_lang_save_customers_language.sql', stage: 'A#6',
    probes: [P.column('customers', 'language')],
  },
  {
    version: '20260611210000', file: '20260611210000_rx_audit_log.sql', stage: 'B1#4',
    probes: [
      P.table('rx_audit_log'), P.index('idx_rx_audit_log_check_in'), P.index('idx_rx_audit_log_clinic_date'),
      P.index('idx_rx_audit_log_actor'), P.policy('rx_audit_log', 'rx_audit_log_insert'),
      P.policy('rx_audit_log', 'rx_audit_log_select'), P.priv('rx_audit_log', 'SELECT'),
    ],
  },
  {
    version: '20260616010000', file: '20260616010000_phi_anon_grant_revoke_hardening.sql', stage: 'B1#1',
    probes: [
      ...privAll('insurance_claims'), ...privAll('claim_items'),
      ...privAll('insurance_claim_diagnoses'), ...privAll('edi_submissions'),
    ],
  },
  {
    version: '20260629140000', file: '20260629140000_anon_pii_leak_revoke_phase1.sql', stage: 'B1#2',
    probes: [
      ...privAll('staff'), ...privAll('user_profiles'),
      ...privAll('customers'), ...privAll('check_ins'), ...privAll('reservations'),
    ],
  },
  {
    version: '20260630200000', file: '20260630200000_daily_room_status_staff_unlock_6menu_rls_additive.sql', stage: 'B2#3',
    probes: [
      P.policy('daily_room_status', 'daily_room_status_staff_unlock_6menu'),
      // 기존 3정책 무접촉 불변식(pre==post 로 자동 보장 확인)
      P.policy('daily_room_status', 'daily_room_status_admin_manager_write'),
      P.policy('daily_room_status', 'daily_room_status_approved_read'),
      P.policy('daily_room_status', 'daily_room_status_staff_own_write'),
    ],
  },
];

const scalar = (rows) => (Array.isArray(rows) && rows.length ? Object.values(rows[0])[0] : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 모든 probe 를 단일 jsonb_build_object round-trip 으로 결합(throttle 회피).
async function probeAll(probes) {
  const pairs = probes.map((p, i) => `'p${i}', (${p.expr})`).join(',\n    ');
  const rows = await q(`SELECT jsonb_build_object(\n    ${pairs}\n  ) AS v;`);
  const obj = scalar(rows) || {};
  const out = {};
  probes.forEach((p, i) => { out[p.label] = obj[`p${i}`] ?? null; });
  return out;
}

(async () => {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('무영속 DRY-RUN 배치 (pre==post 등가 = 무영속 실측)');
  console.log('표준: migration_dryrun_no_persistence_standard.md v1.0 (txn-strip + plpgsql exception-handler + pre/post probe)');
  console.log('══════════════════════════════════════════════════════════════\n');

  let allPass = true;
  const summary = [];

  for (const b of BATCH) {
    await sleep(1500); // Management API throttle 회피(마이그당 3 round-trip)
    const upSql = readFileSync(join(MIG, b.file), 'utf8');
    const { harness, removed } = buildHarness(upSql);
    console.log(`── [${b.stage}] ${b.file} ──`);
    console.log(`   stripped top-level txn-control (INV-5): ${removed.length ? JSON.stringify(removed) : '(none)'}`);

    // 1) pre-probe
    const pre = await probeAll(b.probes);

    // 2) harness 실행 (sentinel rollback = 무영속)
    let ranOk = true, err = null;
    try {
      await q(harness);
    } catch (e) {
      // handler 가 sentinel 만 흡수 → q throw = 실 마이그 에러(비-sentinel) = FAIL (INV-4)
      ranOk = false; err = String(e.message || e);
    }

    // 3) post-probe
    const post = await probeAll(b.probes);

    // 4) pre==post 등가 판정
    const diffs = [];
    for (const k of Object.keys(pre)) {
      if (JSON.stringify(pre[k]) !== JSON.stringify(post[k])) diffs.push(`${k}: ${JSON.stringify(pre[k])} → ${JSON.stringify(post[k])}`);
    }

    const pass = ranOk && diffs.length === 0;
    allPass = allPass && pass;
    if (!ranOk) console.log(`   ✗ harness 실행 에러(비-sentinel, INV-4 re-raise): ${err}`);
    if (diffs.length) { console.log('   ✗ PERSISTENCE LEAK — pre≠post:'); diffs.forEach((d) => console.log(`       ${d}`)); }
    console.log(`   probe ${b.probes.length}개 pre==post: ${diffs.length === 0 ? 'ALL EQUAL ✓' : `${diffs.length} DIFF ✗`}  → ${pass ? 'PASS' : 'FAIL'}\n`);
    summary.push({ stage: b.stage, file: b.file, probes: b.probes.length, stripped: removed, ranOk, diffs, pass });
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  for (const s of summary) console.log(`  ${s.pass ? '✓ PASS' : '✗ FAIL'}  [${s.stage}] ${s.file}  (probes ${s.probes}, stripped ${s.stripped.length})`);
  console.log(`\n전체: ${allPass ? '✅ 무영속 DRY-RUN 전건 PASS (pre==post, prod 무변경 실측)' : '❌ FAIL — apply 중단'}`);
  console.log('══════════════════════════════════════════════════════════════');
  process.exit(allPass ? 0 : 1);
})().catch((e) => { console.error('DRIVER ERROR:', e); process.exit(2); });
