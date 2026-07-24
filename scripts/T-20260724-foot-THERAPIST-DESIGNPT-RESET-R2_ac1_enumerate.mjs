/**
 * T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2 — AC-1 재-enumerate + freeze 스냅샷 (READ-ONLY)
 *
 * ⚠️ READ-ONLY — GET(SELECT)만. UPDATE/DELETE/PATCH 절대 없음.
 *
 * Opt-C (keep-only-F-4507): 김주연 총괄 현장 confirm(2026-07-24 13:46) — F-4552(이민태)=churn/7-18 잔재(삭제확정).
 * 규칙: clinic 내 designated_therapist_id IS NOT NULL 전량 중 chart_number='F-4507'만 보존, 나머지 전량 NULL.
 *
 * 산출:
 *   ① 대상 freeze 스냅샷 (치료사명+고객명+차트+현 designated_therapist_id, 롤백 원값)
 *   ② orphan-trace: F-4552(이민태) ↔ 박소예 잔재 (customers 자기행 + reservations.preferred_therapist_id)
 *   ③ AC-1b divergence 게이트: F-4507 부재/타치료사면 pause 신호
 *   ④ rollback SQL (BEGIN/COMMIT, 스냅샷 원값 per-row 복원)
 *
 * 접속: service-role over PostgREST (RLS bypass). DB password 불요.
 * 실행: node scripts/T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2_ac1_enumerate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRETS = `${process.env.HOME}/.config/medibuilder-secrets`;
const URL = readFileSync(`${SECRETS}/foot-supabase-url`, 'utf8').trim().replace(/\/$/, '');
const KEY = readFileSync(`${SECRETS}/foot-supabase-service-role`, 'utf8').trim();
const REST = `${URL}/rest/v1`;

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const PRESERVE_CHART = 'F-4507';
const F4552_ID = '5659dad8-c486-465f-a842-a0f41dbd478c'; // 이민태 (R3 스냅샷 기준)

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' };

async function get(path) {
  const r = await fetch(`${REST}/${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const main = async () => {
  // ── ① 대상 전량 재-enumerate (churn-robust: 13:32 이후 추가분 포함) ──
  const rows = await get(
    `customers?clinic_id=eq.${CLINIC}&designated_therapist_id=not.is.null` +
    `&select=id,name,chart_number,designated_therapist_id,updated_at&order=chart_number.asc`
  );
  const staffIds = [...new Set(rows.map(r => r.designated_therapist_id))];
  const staff = staffIds.length
    ? await get(`staff?id=in.(${staffIds.join(',')})&select=id,name`)
    : [];
  const staffName = Object.fromEntries(staff.map(s => [s.id, s.name]));

  const enriched = rows.map(r => ({
    ...r,
    therapist_name: staffName[r.designated_therapist_id] || '(unknown staff)',
  }));

  const preserveRow = enriched.find(r => r.chart_number === PRESERVE_CHART) || null;
  const targets = enriched.filter(r => r.chart_number !== PRESERVE_CHART); // Opt-C: F-4507 제외 전량

  // ── ② orphan-trace: F-4552(이민태) ↔ 박소예 잔재 ──
  const f4552Cust = await get(
    `customers?id=eq.${F4552_ID}` +
    `&select=id,name,chart_number,clinic_id,designated_therapist_id,assigned_consultant_id,updated_at`
  );
  const f4552Resv = await get(
    `reservations?customer_id=eq.${F4552_ID}&preferred_therapist_id=not.is.null` +
    `&select=id,customer_id,preferred_therapist_id,reservation_date,status`
  );
  // 클리닉 전체 reservations.preferred_therapist_id 잔재 (bisync 스테일 파악용, F-4507 제외 대상)
  const clinicResvPref = await get(
    `reservations?clinic_id=eq.${CLINIC}&preferred_therapist_id=not.is.null` +
    `&select=id,customer_id,preferred_therapist_id,reservation_date,status`
  );

  const orphanTrace = {
    f4552_id: F4552_ID,
    f4552_customer_row: f4552Cust[0] || null,
    f4552_in_target_set: targets.some(t => t.id === F4552_ID),
    f4552_reservations_with_preferred: f4552Resv,
    reservations_preferred_notnull_clinic_count: clinicResvPref.length,
    note: 'therapist_assignments 테이블 부재 확인(마이그 grep). 배정 조인 surface = customers.designated_therapist_id(주) + reservations.preferred_therapist_id(bisync) + assignment_actions(audit, append-only 보존).',
  };

  // ── ③ AC-1b divergence 게이트 ──
  const preserveTherapist = preserveRow ? preserveRow.therapist_name : null;
  const divergence = {
    preserve_present: !!preserveRow,
    preserve_therapist_name: preserveTherapist,
    preserve_therapist_is_parksoye: !!preserveTherapist && preserveTherapist.startsWith('박소예'),
    gate_pass: !!preserveRow, // Opt-C churn-robust: F-4507 존재하면 진행. 부재면 pause.
  };

  // ── ④ rollback SQL (스냅샷 원값 per-row 복원) ──
  const rollbackLines = [
    `-- ROLLBACK for T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2 (Opt-C keep-only-F-4507)`,
    `-- 스냅샷 기준 원 designated_therapist_id per-row 복원. ${targets.length} rows. F-4507 미변경(보존).`,
    `-- captured: AC-1 enumerate (live). 적용 되돌림 전용.`,
    `BEGIN;`,
    ...targets.map(t =>
      `UPDATE customers SET designated_therapist_id = '${t.designated_therapist_id}' WHERE id = '${t.id}';  -- ${t.chart_number} ${t.name} -> ${t.therapist_name}`
    ),
    `COMMIT;`,
    ``,
  ].join('\n');

  const snapshot = {
    ticket: 'T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2',
    rule: 'Opt-C keep-only-F-4507 (SET NULL WHERE chart_number <> F-4507)',
    field_confirm: '김주연 총괄 2026-07-24 13:46 — F-4552=churn 삭제확정 → Opt-C',
    clinic_id: CLINIC,
    preserve_chart: PRESERVE_CHART,
    clinic_total_assigned: enriched.length,
    target_count: targets.length,
    preserve_row: preserveRow,
    divergence,
    orphan_trace: orphanTrace,
    targets,
    all_rows: enriched,
  };

  writeFileSync(
    join(__dirname, 'T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2_snapshot.json'),
    JSON.stringify(snapshot, null, 2)
  );
  writeFileSync(
    join(__dirname, 'T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2_rollback.sql'),
    rollbackLines
  );

  console.log(JSON.stringify({
    clinic_total_assigned: enriched.length,
    target_count: targets.length,
    preserve: divergence,
    targets: targets.map(t => `${t.chart_number} ${t.name} -> ${t.therapist_name}`),
    orphan_trace: {
      f4552_row: orphanTrace.f4552_customer_row,
      f4552_in_target_set: orphanTrace.f4552_in_target_set,
      f4552_resv_preferred: f4552Resv.length,
      clinic_resv_preferred_notnull: clinicResvPref.length,
    },
  }, null, 2));
};

main().catch(e => { console.error('FATAL', e); process.exit(1); });
