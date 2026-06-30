-- ROLLBACK — T-20260617-foot-DOCFORM-POPUP-OVERHAUL Migration B Phase3 (Q2/Q3 deactivate 복원)
--  soft deactivate 되돌림: 소견서 C5900003 / 진료기록사본2 → active=true 복원.
--  (resurrect 가드: 본래 active=true였던 2행만 대상. C59000xx inactive 레거시는 무접촉.)
BEGIN;

UPDATE services
   SET active = true
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code IN ('C5900003', '진료기록사본2')
   AND active = false;

COMMIT;
