/**
 * apply_20260815000000_foot_clinic_operating_hours_gen.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 티켓: T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901
 * 게이트: supervisor DB-GATE GO-token (ed25519, key_id supv-dbgate-2026a).
 *   ⚠ GO-token 前 prod DDL/DML/GRANT 선집행 금지(deploy-precheck C20 · apply_before_go).
 *   ⚠ DA CONSULT-REPLY 명시: "dev 선-apply 금지 · apply-gate=supervisor 소관".
 *   apply = supervisor DB-GATE lane. GO-token(.json+.sig) 검증 후에만 prod COMMIT.
 * 대상 마이그: supabase/migrations/20260815000000_foot_clinic_operating_hours_gen.sql
 *   ADDITIVE — 신규 테이블 clinic_operating_hours 1개 + RLS + jongno seed 6행(월~토, 일=row-absent 휴무).
 *   no-persistence dry-run 변형: 20260815000000_foot_clinic_operating_hours_gen.dryrun.sql
 *   rollback: 20260815000000_foot_clinic_operating_hours_gen.rollback.sql
 *
 * DA GO(2건 reconciliation):
 *   · MSG-20260815-155009-sa8v (P1, in_reply_to 8mn7, da_consult_ref=DA-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901):
 *       Q1 = 신규 clinic_operating_hours 신설 canonical / clinic_schedules 확장 REJECT.
 *       Q3 = last_booking_slot INCLUSIVE 저장 canonical (close_time = 독립 사실 컬럼). ← 본 테이블 저장방식(settled).
 *       재-CONSULT(동일 substance) → HARD REJECT H1~H7. ∴ Q3 = settled(재질의 불요).
 *   · MSG-20260815-154824-cp5l / -154808-3yen (P2, da_consult_ref=DA-20260815-foot-JONGNO-OPHOURS-CHANGE):
 *       Q3 = A(close_exclusive 저장) 강권 / B(last_booking_slot 유지) acceptable — 단 4가드 의무.
 *       Q4 = clinic_schedules census 후 신테이블 vs ADD valid_from 택1(blind 신설 금지).
 *   reconciliation = 옵션 B 채택(= sa8v settled canonical). cp5l 4가드 전부 충족:
 *       가드1 컬럼 comment / 가드2 SSOT 명문화 / 가드3 resolver 변환지점 단일화 / 가드4 off-by-one self-test(spec T1).
 *   Q4 census(dev 실측) = clinic_schedules {id,clinic_id,day_of_week,open_time,close_time,is_closed,UNIQUE(clinic_id,dow)}
 *       = valid_from/effective_from 부재(NOT date-aware) + `grep clinic_schedules src/` = 0건(FE resolver 미참조·dead)
 *       → date-aware 발효축을 dead 테이블에 볼트온 = 축 혼동 + 여전히 unwired. ∴ 신 테이블 채택(blind 아님·census 근거).
 *
 * 실행:
 *   node scripts/apply_20260815000000_foot_clinic_operating_hours_gen.mjs          # PRE-PROBE(read-only PREFLIGHT)만, prod 무변경
 *   node scripts/apply_20260815000000_foot_clinic_operating_hours_gen.mjs --apply  # supervisor GO-token 검증 → apply → POST-PROBE
 */
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';
import { assertApplyGateForRunner, applyTimingSelfCheck, FOOT_PROD_REF } from './apply_gate_lib.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260815000000';
const FILE = '20260815000000_foot_clinic_operating_hours_gen.sql';
const TICKET_ID = 'T-20260815-foot-JONGNO-OPHOURS-CHANGE-20260901';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브 종로 풋센터(jongno-foot) — seed 대상
const EFFECTIVE_FROM = '2026-09-01';
const REF = FOOT_PROD_REF;
const __dir = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_LOG = join(__dir, '../db-gate/_apply_evidence/runner_apply.log.jsonl');
const SQL_FILE = join(MIG_DIR, FILE);

async function qsafe(name, sql) {
  try { const r = await query(sql); console.log(`  [${name}]`, JSON.stringify(r)); return r; }
  catch (e) { console.log(`  [${name}] (query error)`, e.message); return null; }
}

async function structuralProbe(label) {
  console.log(`\n══════════ ${label} ══════════`);
  // 방어: seed 대상 clinic_id 가 실제 jongno-foot 인지(songdo 오적재 방지).
  await qsafe('clinic identity (expect slug=jongno-foot)',
    `SELECT id, slug, open_time, close_time, weekend_close_time, slot_interval
       FROM public.clinics WHERE id='${CLINIC_ID}'`);
  // 멱등/세대겹침 방어: 해당 세대(effective_from) 사전 존부(expect 0 pre-apply).
  await qsafe('clinic_operating_hours 세대 사전 존부 (expect 0 pre-apply)',
    `SELECT count(*) n FROM public.clinic_operating_hours
       WHERE clinic_id='${CLINIC_ID}' AND effective_from='${EFFECTIVE_FROM}'`);
  // POST 기대: jongno 6행(월~토) + 일(dow 0) 0행(row-absent 휴무).
  await qsafe('clinic_operating_hours jongno 세대행 (POST expect 6: 월~토, 일 row-absent)',
    `SELECT day_of_week, open_time, close_time, last_booking_slot, effective_from, effective_to
       FROM public.clinic_operating_hours
       WHERE clinic_id='${CLINIC_ID}' AND effective_from='${EFFECTIVE_FROM}'
       ORDER BY day_of_week`);
}

(async () => {
  await structuralProbe('PRE-PROBE (read-only PREFLIGHT · apply 전 현재 상태)');
  if (!APPLY) {
    console.log('\n(PRE-PROBE only) --apply 미지정 → prod 무변경(read-only). supervisor GO-token 검증 후 --apply 재실행.');
    return;
  }
  // ── DB-GATE: GO-token 검증(prod lane 필수). 부재/불일치/만료 → abort ──
  readFileSync(SQL_FILE, 'utf8'); // content-binding 존재 확인
  const gate = assertApplyGateForRunner({
    ticketId: TICKET_ID, targetRef: REF, applyRequested: true,
    migrationSqlFile: SQL_FILE, evidenceLog: EVIDENCE_LOG,
  });
  console.log('\n[DB-GATE] GO-token 검증 통과:', JSON.stringify(gate.gate ?? gate));

  // ── apply evidence (C20 apply_before_go 지문) ──
  const applyTsMs = Date.now();
  const selfCheck = applyTimingSelfCheck(gate.gate, applyTsMs);
  console.log('\n[EVIDENCE] apply timing self-check:', JSON.stringify(selfCheck));
  if (selfCheck.anomaly) {
    throw new Error('SELF-CHECK abort: apply_ts < go_issued_at (apply_before_go 지문) — apply 중단.');
  }
  if (applyTsMs > Date.parse(gate.gate.expiresAt)) {
    throw new Error(`TTL abort: apply_ts > expires_at(${gate.gate.expiresAt}) — supervisor 재서명 필요.`);
  }

  // ── prod COMMIT (ledger 경유 apply) ──
  console.log('\n[APPLY] prod COMMIT 시작…');
  const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot:' + TICKET_ID });
  console.log('[APPLY] 완료:', JSON.stringify(r));

  await structuralProbe('POST-PROBE (structural POSTCHECK)');
  console.log('\n※ POSTCHECK(FE): 09-01(화) 마지막슬롯 19:00 / 09-05(토) 18:00 / 09-06(일) 슬롯0·예약차단 / 08-31 이전 무교란 = supervisor 사후검증.');
})();
