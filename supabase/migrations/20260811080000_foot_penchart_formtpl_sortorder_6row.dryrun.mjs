/**
 * DRY-RUN (No-Persistence): T-20260811-foot-PENCHART-FORMTPL-SORTORDER-FIX
 *   20260811080000_foot_penchart_formtpl_sortorder_6row.sql
 *   (form_templates.sort_order DML UPDATE 6행 — pen 계열 목록 순서 정정)
 *
 * canonical 러너 scripts/dryrun_lib.mjs(migration_dryrun_no_persistence_standard.md v1.0) 위임:
 *   ① txn-control strip  ② plpgsql exception-handler 무영속 실행  ③ post-probe.
 *
 * ── DML(비파괴 UPDATE)의 무영속 불변식 ─────────────────────────────────────────
 *   본 마이그 = form_templates.sort_order 6행 UPDATE. up.sql 안의 IN-TXN SELF-TEST 가
 *   txn-내 신규상태(90~95)를 검증 → sentinel RAISE 로 전량 롤백.
 *   probe = "before-image(privacy_consent_form=130 · foreigner_noncovered_consent=120 등)가
 *   dry-run 롤백 後 그대로 보존" = UPDATE 미영속. 각 probe TRUE(pass)=무영속. 하나라도 FALSE=영속누수→FAIL.
 *   (up.sql SELF-TEST 통과 = harness 안에서 UPDATE 로직·매핑이 정합함을 무영속으로 실증.)
 *
 * 실행: (repo root) node supabase/migrations/20260811080000_foot_penchart_formtpl_sortorder_6row.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260811080000_foot_penchart_formtpl_sortorder_6row.sql');

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SO = (fk) => `(SELECT sort_order FROM public.form_templates
   WHERE clinic_id='${CLINIC}'::uuid AND form_key='${fk}')`;

runDryrun({
  upPath: UP,
  passNote: '(sort_order DML — post-probe=before-image 보존/무영속 실측 + 스코프 6행 확인)',
  assertAbsent: [
    // (a) ★핵심 무영속: privacy_consent_form 이 dry-run 롤백 後 130(before-image)로 복원 = UPDATE 미영속.
    { label: '(a) privacy_consent_form sort_order restored to 130 (non-persistent)',
      sql: `SELECT (${SO('privacy_consent_form')} = 130) AS ok;` },
    // (b) foreigner_noncovered_consent 이 120(before-image)로 복원 = 미영속.
    { label: '(b) foreigner_noncovered_consent sort_order restored to 120 (non-persistent)',
      sql: `SELECT (${SO('foreigner_noncovered_consent')} = 120) AS ok;` },
    // (c) health_questionnaire_general=91 · senior=92 · refund_consent=93 (before-image) 보존.
    { label: '(c) hq_general=91 & hq_senior=92 & refund_consent=93 restored (non-persistent)',
      sql: `SELECT (${SO('health_questionnaire_general')} = 91
                AND ${SO('health_questionnaire_senior')}  = 92
                AND ${SO('refund_consent')}               = 93) AS ok;` },
    // (d) 새 목표값이 prod 에 남지 않음: privacy_consent_form 이 91 이 아님(영속누수 0 재확인).
    { label: '(d) privacy_consent_form NOT yet 91 (target value non-persistent)',
      sql: `SELECT (${SO('privacy_consent_form')} <> 91) AS ok;` },
    // (e) 스코프 read-only 확인: 대상 6 form_key 가 clinic 에 정확히 6행 존재(rows-affected=6 근거).
    { label: '(e) scope = exactly 6 target rows in clinic (rows-affected=6 basis)',
      sql: `SELECT (count(*) = 6) AS ok FROM public.form_templates
              WHERE clinic_id='${CLINIC}'::uuid
                AND form_key IN ('pen_chart','privacy_consent_form','health_questionnaire_general',
                                 'health_questionnaire_senior','refund_consent','foreigner_noncovered_consent');` },
  ],
});
