-- T-20260610-foot-DUMMY-RESV-REAPPLY cleanup (AC-6)
-- reservations 먼저(FK), customers 나중. memo + phone prefix 2중 마커로 정밀 회수.
DELETE FROM reservations WHERE memo = '[TEST-DUMMY 20260610-REAPPLY]' AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
DELETE FROM customers    WHERE memo = '[TEST-DUMMY 20260610-REAPPLY]' AND phone LIKE '+82108811%';
