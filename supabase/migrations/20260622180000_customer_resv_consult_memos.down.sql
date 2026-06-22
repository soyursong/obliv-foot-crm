-- T-20260622-foot-CHART2-MEMO-HISTORY rollback
-- 신규 테이블만 제거. customers.customer_memo / customers.tm_memo 는 보존됐으므로 데이터 손실 없음.
DROP TABLE IF EXISTS customer_reservation_memos;
DROP TABLE IF EXISTS customer_consult_memos;
