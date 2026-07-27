-- T-20260727-foot-VISITTYPE-JMH-INITIAL-FIX — ROLLBACK SQL
-- 정명희(F-4270, customer_id=299b6535-e1f1-420a-bbc2-8f552a4e7487) 배정 visit_type 정정 되돌리기.
-- forward: returning -> new  |  rollback: new -> returning
-- 대상 UUID 2개 명시(freeze). count/조건 기준 일괄 UPDATE 금지.
-- 각 UPDATE는 정확히 1행(합 2행)만 영향받아야 함. 그 외면 롤백 중단·보고.

UPDATE public.check_ins
   SET visit_type = 'returning'
 WHERE id = '1c2117de-b091-4227-b8a5-a167c1d865b7'
   AND visit_type = 'new';

UPDATE public.reservations
   SET visit_type = 'returning'
 WHERE id = 'eb7e5047-9cb5-4bac-80bc-f313d9db67aa'
   AND visit_type = 'new';
