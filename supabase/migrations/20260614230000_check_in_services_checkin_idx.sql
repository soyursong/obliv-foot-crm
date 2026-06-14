-- T-20260614-foot-STATS-SVCDIST-BOXGRID — FIX (statement timeout 57014 on /admin/stats)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-14
-- 롤백: 20260614230000_check_in_services_checkin_idx.rollback.sql
-- ref: MSG-20260614-224935 (supervisor FIX-REQUEST) / qa_fail_reason=spec_fail_new
--
-- ⚠️ db_change = FALSE (스키마 계약 무변경) — 성능 인덱스 1건 추가(additive)만. 컬럼/테이블/enum 무변경.
--
-- ─── 무엇을 / 왜 ─────────────────────────────────────────────────────────────
--   증상: /admin/stats 진입 시 "통계를 불러오지 못했습니다: canceling statement due to
--         statement timeout · code=57014". 매출 통계 탭(foot_stats_by_category) 8.1초 타임아웃.
--         그 여파로 통계 페이지 전체가 에러 배너 + 데이터 미로드(지표2 박스 그리드 '데이터 없음').
--
--   진단(실측, 추정 아님):
--     · 직접 pg(custom plan): foot_stats_by_category = 80ms / EXPLAIN 1.6ms (데이터 135/200/736행).
--     · PostgREST(prepared statement → generic plan): 7.6~8.2초 (6/6 재현) = authenticated
--       role statement_timeout(8s) 도달 → 57014.
--     · generic-plan EXPLAIN 병목: single_paid 의 payments ⋈ check_in_services 가
--       Hash Join(custom) 대신 **Nested Loop + Join Filter(인덱스 없음)** 로 뒤집힘 →
--       payment 52행마다 check_in_services 736행 **Seq Scan 52회 반복**, 그 안에서 RLS 정책
--       `is_consultant_or_above() OR is_approved_user() OR is_admin_or_manager()` 를 행마다 평가
--       (≈ 52 × 736 = 3.8만 회) = 7.9초.
--       (custom plan 은 payments 의 clinic_id 선택도를 알아 Hash Join 1패스 → 1.5ms.)
--
--   근본 원인: check_in_services.check_in_id 에 인덱스 부재(pkey 만 존재). generic plan 이
--             payments 행수를 과소추정해 Nested Loop 을 고르면 inner 가 매 루프 Seq Scan.
--
-- ─── 해결 ────────────────────────────────────────────────────────────────────
--   check_in_services(check_in_id) 인덱스 추가. plan 선택과 무관하게 inner 가 Index Scan 이 되어
--   루프당 매칭 소수 행만 RLS 평가 → 폭발 제거.
--   실측 검증(authenticated + force_generic_plan): 7.6초 → 128~222ms. REST 엔드투엔드 230ms/200.
--   RPC 본문/시그니처/반환형 무변경 — 인덱스만 추가하므로 계약·보안 posture 변화 없음.
--   FK 조인 컬럼 인덱스는 일반적으로도 정상(누락 보강).

BEGIN;

CREATE INDEX IF NOT EXISTS idx_check_in_services_check_in
  ON check_in_services (check_in_id);

COMMIT;
