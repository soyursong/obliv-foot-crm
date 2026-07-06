-- ════════════════════════════════════════════════════════════════════════════
-- Rollback: T-20260706-foot-DOCFORM-CATEGORY-RELABEL-ROLLBACK
--   forward = '제증명' 카테고리 membership 재확인(멱등 SET, 대체로 no-op / drift만 보정).
--
-- ★ 의도적 NO-OP 롤백 (DML 없음) — 이유:
--   1) forward 마이그는 대상 10종을 category_label='제증명'으로 재확인할 뿐(신규 상태 도입 아님).
--      실제 귀속은 선행 Migration B(20260630140000, 2026-06-30)가 이미 배포한 상태다.
--   2) 이 마이그를 되돌린다는 것 = category_label을 '기본' 등 이전 값으로 UPDATE 하는 것인데,
--      이는 총괄 최종 정정으로 **명시 금지된 '기본' 원복 DML**(티켓 AC1)이다.
--      → 안전하게 되돌릴 수 있는 대상이 없으므로 롤백은 어떤 DML도 수행하지 않는다.
--   3) FE 노출(Services.tsx CATEGORY_LABEL_OPTIONS '제증명' 추가)을 되돌리려면 코드(FE)를
--      이전 커밋으로 함께 되돌려야 한다(DB 롤백 대상 아님).
--
-- 통짜 rollback SQL(전체 category_label 되돌리기) = 금지. 본 파일은 그 금지의 준수 기록이다.
-- ════════════════════════════════════════════════════════════════════════════

-- (의도적으로 DML 없음)
SELECT 'no-op rollback: 제증명 membership 재확인은 되돌릴 대상이 없음(''기본'' 원복은 AC1 금지)' AS rollback_note;
