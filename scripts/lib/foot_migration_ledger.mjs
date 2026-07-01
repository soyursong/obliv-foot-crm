/**
 * foot_migration_ledger.mjs — 공용 마이그 apply helper (Track3 root-cause 복구)
 * 티켓: T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP (Track3)
 *
 * ── 배경 (RC) ──
 * 기존 scripts/apply_*.mjs 는 전부 standalone 이며 Management API /database/query 로 SQL 만 POST 하고
 * `supabase_migrations.schema_migrations` 원장에 기록하지 않았다. 그 결과 foot 원장이 20260609234500(118행)에서
 * 정지 → 6/09 이후 마이그는 원장 미추적 → apply 누락 시 PROD 에 조용히 미반영(drift). = systemic root-cause.
 *
 * ── 복구 (비파괴) ──
 * 이 helper 는 (1) SQL 을 적용하고 (2) 적용 성공 시에만 원장에 version 을 idempotent INSERT 한다.
 * dopamine sibling T-20260626-dopamine-MIGRATION-TOOLING-REPAIR convention 정합:
 *   "적용 = 원장 기록" 을 단일 경로로 강제해 원장 정지·drift 재발을 원천차단.
 * 기존 apply.mjs 동작(Management API POST)은 그대로 보존하고 원장 기록만 추가한다.
 *
 * ── PROD write 게이트 ──
 * 이 helper 를 경유하는 실적용(applyMigration / recordLedger 의 실행)은 PROD write → supervisor 게이트 경유.
 * dryRun 모드에서는 SQL·원장 기록을 절대 실행하지 않고 계획만 출력한다.
 *
 * author: dev-foot / 2026-07-01
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../..');
export const MIG_DIR = join(REPO_ROOT, 'supabase/migrations');
export const PROJ_REF = 'rxlomoozakkjesdqjtvd'; // obliv-foot-crm prod

function loadToken() {
  const t = process.env.SUPABASE_ACCESS_TOKEN
    || (() => {
      try {
        const env = readFileSync(join(REPO_ROOT, '.env.local'), 'utf8');
        return (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
      } catch { return null; }
    })();
  if (!t) throw new Error('SUPABASE_ACCESS_TOKEN 필요 (env 또는 .env.local)');
  return t;
}

/** Management API /database/query — raw SQL 실행 (read/write 공용). */
export async function query(sql, { token } = {}) {
  const TOKEN = token || loadToken();
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body)}`);
  return body;
}

/** SQL 리터럴 이스케이프 ($$ dollar-quote 회피용 안전 처리). */
function esc(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * 원장에 version 을 idempotent 기록한다. 이미 있으면 no-op(ON CONFLICT DO NOTHING).
 * statements 는 빈 배열('{}')로 둔다 = reconcile 백필 표준(supabase migration repair 와 동형).
 * created_by 로 기록 출처를 남겨 감사추적 가능하게 한다.
 *
 * @param {object} o
 * @param {string} o.version   14자리 timestamp 버전
 * @param {string} [o.name]    마이그 이름(파일명에서 유도)
 * @param {string} [o.createdBy] 기록 출처 태그
 * @param {boolean} [o.dryRun] true면 실행 없이 계획만 반환
 */
export async function recordLedger({ version, name = '', createdBy = 'ledger-drift-sweep-track3', dryRun = true, token } = {}) {
  if (!/^\d{14}$/.test(version || '')) throw new Error(`invalid version: ${version}`);
  const sql = `INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('${esc(version)}', '${esc(name)}', '{}'::text[], '${esc(createdBy)}')
ON CONFLICT (version) DO NOTHING;`;
  if (dryRun) return { version, name, applied: false, dryRun: true, sql };
  await query(sql, { token });
  return { version, name, applied: true, dryRun: false };
}

/** 원장에 이미 존재하는 version 집합을 조회한다(read-only). */
export async function ledgerVersions({ token } = {}) {
  const rows = await query('SELECT version FROM supabase_migrations.schema_migrations;', { token });
  return new Set((Array.isArray(rows) ? rows : []).map((r) => r.version));
}

/**
 * 마이그 .sql 을 적용하고, 성공 시 원장에 version 을 기록한다(단일 경로).
 * = Track3 핵심: "적용 = 원장 기록". 향후 모든 apply 는 이 함수 경유가 표준.
 *
 * @param {object} o
 * @param {string} o.version   14자리 timestamp
 * @param {string} o.file      supabase/migrations 하위 파일명 (foward .sql)
 * @param {boolean} [o.dryRun] true면 SQL·원장 미실행, 계획만
 * @param {string} [o.createdBy]
 */
export async function applyMigration({ version, file, dryRun = true, createdBy = 'ledger-drift-sweep-track2', token } = {}) {
  if (!/^\d{14}$/.test(version || '')) throw new Error(`invalid version: ${version}`);
  const name = file.replace(/^\d{14}_/, '').replace(/\.sql$/, '');
  const sql = readFileSync(join(MIG_DIR, file), 'utf8');
  if (dryRun) {
    return { version, file, name, applied: false, dryRun: true, bytes: sql.length };
  }
  // 1) DDL 적용 (기존 apply.mjs 동작 보존 — Management API POST)
  await query(sql, { token });
  // 2) 적용 성공 후에만 원장 기록 (idempotent)
  await recordLedger({ version, name, createdBy, dryRun: false, token });
  return { version, file, name, applied: true, dryRun: false };
}
