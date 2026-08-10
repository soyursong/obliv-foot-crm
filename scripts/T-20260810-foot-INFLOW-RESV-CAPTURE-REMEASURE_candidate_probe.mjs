/**
 * CANDIDATE-PATH PROBE (READ-ONLY): T-20260810-foot-INFLOW-RESV-CAPTURE-REMEASURE-FIX
 *   키오스크 셀프리포트 candidate 경로(check_ins.inflow_channel_self_reported) 왜 0 인지 특정.
 *   인증컨텍스트: Management API PAT(service-role-equiv, RLS bypass). SELECT-only.
 *   §36③ referral_source(freeze) 무접점: checklist_data JSONB 의 self-report key 존재여부만 count(값 read 아님).
 */
import { q } from './dryrun_lib.mjs';

const QUERIES = [
  { probe: 'K1_checklists_volume', label: 'K1 checklists 제출 볼륨(전체/최근14d) — 키오스크 태블릿 사용여부',
    sql: `SELECT count(*) AS total,
                 count(*) FILTER (WHERE created_at >= now() - interval '14 days') AS last14d,
                 max(created_at) AS latest
          FROM checklists;` },
  { probe: 'K2_referral_key_present', label: 'K2 checklist_data 에 referral_source 키 존재율(FE가 self-report 전달하는가)',
    sql: `SELECT count(*) AS total_checklists,
                 count(*) FILTER (WHERE checklist_data ? 'referral_source') AS has_referral_key,
                 count(*) FILTER (WHERE nullif(btrim(checklist_data->>'referral_source'),'') IS NOT NULL) AS has_nonempty_referral
          FROM checklists;` },
  { probe: 'K3_candidate_vs_checklist', label: 'K3 candidate write 도달 — referral 있는 checklist 의 check_in 이 self_reported 채웠나',
    sql: `SELECT
             count(*) FILTER (WHERE nullif(btrim(cl.checklist_data->>'referral_source'),'') IS NOT NULL) AS checklist_has_referral,
             count(*) FILTER (WHERE nullif(btrim(cl.checklist_data->>'referral_source'),'') IS NOT NULL
                              AND ci.inflow_channel_self_reported IS NOT NULL) AS candidate_landed
          FROM checklists cl JOIN check_ins ci ON ci.id = cl.check_in_id;` },
  { probe: 'K4_checklist_since_deploy', label: 'K4 candidate RPC 배포(2026-08-07) 이후 제출된 checklist 수(신경로 트래픽)',
    sql: `SELECT count(*) AS since_deploy
          FROM checklists WHERE created_at >= '2026-08-07';` },
];

const out = [];
for (const { probe, label, sql } of QUERIES) {
  try {
    const rows = await q(sql);
    console.log(`\n=== ${probe} — ${label} ===`);
    console.log(JSON.stringify(rows, null, 2));
    out.push({ probe, label, rows });
  } catch (e) {
    console.log(`\n=== ${probe} — ${label} ===\nERROR: ${e.message}`);
    out.push({ probe, label, error: e.message });
  }
}
console.log('\n\n__PROBE_JSON__' + JSON.stringify(out));
