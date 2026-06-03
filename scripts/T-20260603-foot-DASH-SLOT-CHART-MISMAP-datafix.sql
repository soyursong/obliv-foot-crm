-- ============================================================================
-- T-20260603-foot-DASH-SLOT-CHART-MISMAP — AC-4 데이터 정정 SQL
-- ⚠️ supervisor 게이트. dev-foot 자동 실행하지 않음. 운영 적용 전 supervisor 검토 필수.
-- 대상: 오연결(예약/체크인 customer_id 가 예약명과 다른 고객을 가리킴) 테스트 데이터 정정.
--
-- 진단 근거(Phase1 read-only, 2026-06-03):
--   F-0174 빈혜린(원내촬영) = 테스트 고객(phone +821000000000, 5/20 생성)
--   에 서로 다른 이름의 예약/체크인이 phone-0000 dedup 으로 다수 오연결됨.
--   form_submissions/payments 0건 → 의료기록 교차오염 없음. 모두 cancelled/noshow.
--   ※ 74cbc3c(셀프접수 receiving 슬롯)와 무관 — 6/1 생성분 포함, reservations 미관여.
-- 긴급도: 낮음 (모두 cancelled/noshow → 타임라인 미노출 → 현재 오픈 위험 없음).
--         hygiene 차원 정정. 라이브 위험 없으므로 일괄 적용 또는 보류 모두 가능.
-- ============================================================================

BEGIN;

-- (1) 예약 453aacb3 '인도네시아 메가인플루언서'(cancelled): F-0174 빈혜린 → F-0995 인도네시아(정상)
UPDATE reservations
   SET customer_id = '850bac2a-0fc8-4ed1-aed2-3b75dc6da300'  -- F-0995 인도네시아 메가인플루언서
 WHERE id = '453aacb3-22f8-4376-b7b1-5ff6b93f872d'
   AND customer_id = '1e867904-8f08-4212-9b2d-bbe652f74374'  -- 현재 F-0174 빈혜린(오연결) 일 때만
   AND customer_name = '인도네시아 메가인플루언서';

-- (2) 예약 fb3a6e6f '김민경테스트'(noshow): 올바른 고객 미상 → customer_id NULL 처리(오연결 제거)
UPDATE reservations
   SET customer_id = NULL
 WHERE id = 'fb3a6e6f-5461-4ae7-b5de-e18476c23b60'
   AND customer_id = '1e867904-8f08-4212-9b2d-bbe652f74374'
   AND customer_name = '김민경테스트';

-- (3) 체크인 2fc1ab99 '김민경테스트'(cancelled): 오연결 → customer_id NULL 처리
UPDATE check_ins
   SET customer_id = NULL
 WHERE id = '2fc1ab99-25c1-4ed0-81e0-acb269e9702f'
   AND customer_id = '1e867904-8f08-4212-9b2d-bbe652f74374'
   AND customer_name = '김민경테스트';

-- 확인: F-0174 에는 본인('빈혜린(원내촬영)' done 체크인) 1건만 남아야 함
-- SELECT id, customer_name, status FROM check_ins WHERE customer_id='1e867904-8f08-4212-9b2d-bbe652f74374';
-- SELECT id, customer_name, status FROM reservations WHERE customer_id='1e867904-8f08-4212-9b2d-bbe652f74374';

COMMIT;

-- ============================================================================
-- ROLLBACK (원복) — 위 적용을 되돌릴 때 실행
-- ============================================================================
-- BEGIN;
-- UPDATE reservations SET customer_id='1e867904-8f08-4212-9b2d-bbe652f74374'
--   WHERE id='453aacb3-22f8-4376-b7b1-5ff6b93f872d';
-- UPDATE reservations SET customer_id='1e867904-8f08-4212-9b2d-bbe652f74374'
--   WHERE id='fb3a6e6f-5461-4ae7-b5de-e18476c23b60';
-- UPDATE check_ins    SET customer_id='1e867904-8f08-4212-9b2d-bbe652f74374'
--   WHERE id='2fc1ab99-25c1-4ed0-81e0-acb269e9702f';
-- COMMIT;
