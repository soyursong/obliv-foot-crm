-- T-20260617-foot-CHECKIN-CHART-LINK-3KEY — AC-4 데이터 정정 (⚠️ supervisor DB 게이트 후 적용)
--
-- Phase1 진단 결과: 성함 불일치 오배정 체크인 3건 중 "실환자 + 복합키(성함 AND 연락처) 1건 해소 가능"은
--   4b091fa7 단 1건. 나머지 2건(10f10231 김민경/test-phone 9999, f0805c8f 고양이/test-phone 1111)은
--   테스트폰·더미명·정답후보 0건 → 자동 정정 범위 외(미조치).
--
-- 교차오염 점검: 오배정 차트(문자테스트 F-1189)에 실환자(김사비)의 form_submissions/payments/처방
--   오기록 無 확인 (문자테스트 유일 결제 10,000원은 문자테스트 본인 체크인 29d4692c 귀속).
--   → 의료기록 교차오염 없음 (BLOCK+ESCALATE 불요).
--
-- 정정: check_in 4b091fa7 (6/17, 김사비 셀프접수, +821094647501) 의 오연결 customer_id
--   8ba2bbef(문자테스트/F-1189) → 2be865ff(김사비/F-0087) 로 환원.
--   guard: 현재값이 오배정 값(문자테스트)이고 denormalized 성함이 '김사비'일 때만 (멱등·안전).

BEGIN;

UPDATE check_ins
   SET customer_id = '2be865ff-6a9d-4666-892c-1cfd2d971199'  -- 김사비 / F-0087 (정답)
 WHERE id = '4b091fa7-29c9-48c8-854b-42b53905351b'
   AND customer_id = '8ba2bbef-018e-4207-b2ab-196e18322437'  -- 문자테스트 / F-1189 (오배정) 일 때만
   AND trim(customer_name) = '김사비';

-- 적용 후 검증(1행, linked_name='김사비' 기대):
--   SELECT ci.id, ci.customer_id, c.name, c.chart_number
--     FROM check_ins ci JOIN customers c ON c.id = ci.customer_id
--    WHERE ci.id = '4b091fa7-29c9-48c8-854b-42b53905351b';

COMMIT;
