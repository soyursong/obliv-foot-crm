-- ROLLBACK — T-20260615-foot-CALLLIST-ROOMSUMMARY-NUM-REORDER WS-C
-- call_list_manual_order 컬럼 제거. ADDITIVE 컬럼이라 drop 시 자동 진입순 정렬로 복귀(데이터 손실 = 수기순서 한정).
-- IF EXISTS: 미적용 환경에서도 안전.

ALTER TABLE check_ins DROP COLUMN IF EXISTS call_list_manual_order;
