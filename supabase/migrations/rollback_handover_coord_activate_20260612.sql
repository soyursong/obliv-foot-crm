-- ROLLBACK: T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR H3 코디 4인 활성화 되돌리기
-- 적용 전 상태: 아래 4행 active=false. 롤백 시 다시 false 로.
-- 주의: 되돌리면 /admin/handover 출근자 카드 코디 노란색 다시 미반영됨.
UPDATE staff SET active=false, updated_at=now()
 WHERE id IN (
   'ca0e8887-1163-4c0e-bb43-76b0d56ae383', -- 김민경
   '735dd27a-75de-4599-86e2-9d5d04b64015', -- 김지혜
   'fd54a977-d203-44f6-91cb-0f1fce47dd97', -- 박민석
   '0237eba4-d347-4251-bd61-32390f197f22'  -- 장예지
 )
   AND clinic_id='74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND role='coordinator';
