-- Rollback: T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT
-- 신규 FUNCTION 2개 제거. 스키마 변경이 없으므로 DROP 만으로 완전 복구.
-- 주의: FE(TransferDialog / PaymentMiniWindow.executeAutoDone)가 이 RPC를 호출하므로
--       롤백 시 FE도 이전 커밋으로 함께 되돌려야 한다(양도/선수금차감이 RPC 미존재로 실패).

DROP FUNCTION IF EXISTS transfer_package_atomic(UUID, UUID);
DROP FUNCTION IF EXISTS consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB);
