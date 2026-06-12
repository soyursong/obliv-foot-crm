-- T-20260612-foot-DUMMY-RESV-0612 cleanup (롤백) — reservations → customers 순
-- ⚠ is_simulation=false 사용(ADMIN-SIM-FILTER 숨김 회피). customers는 memo+phone prefix로 식별.
DELETE FROM reservations
  WHERE memo = '[TEST-DUMMY 20260612]'
    AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

DELETE FROM customers
  WHERE memo = '[TEST-DUMMY 20260612]'
    AND phone LIKE '+82108812%'
    AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
