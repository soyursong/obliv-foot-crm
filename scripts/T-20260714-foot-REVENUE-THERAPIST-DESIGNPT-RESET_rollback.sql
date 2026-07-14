-- ROLLBACK for T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET
-- 스냅샷 기반 원값(designated_therapist_id) 복원. 13 rows.
BEGIN;
UPDATE customers SET designated_therapist_id = '7c24cd3b-8e52-4c72-9652-e14f75151514' WHERE id = '21a82994-b231-4bcc-94ff-dd9e6c3a4951';
UPDATE customers SET designated_therapist_id = '8c21c9ab-eb83-4688-a95b-4566c301c470' WHERE id = '3210644b-04a5-4f24-b425-c3d10ae87dc9';
UPDATE customers SET designated_therapist_id = '7c24cd3b-8e52-4c72-9652-e14f75151514' WHERE id = '362663c7-bb77-4e33-9f17-05b94b3fd866';
UPDATE customers SET designated_therapist_id = '5c17e4bc-e948-4dc4-a8cf-37904873edeb' WHERE id = '40a4f761-0bb2-4650-9118-39aa16d38e02';
UPDATE customers SET designated_therapist_id = '03642b85-4b30-48e4-b762-c2d04e6af7f3' WHERE id = '4c7fcad8-115d-4e80-a88d-65e2e24e81d4';
UPDATE customers SET designated_therapist_id = '03642b85-4b30-48e4-b762-c2d04e6af7f3' WHERE id = '7d004a07-ff23-470b-948b-40e3deb34220';
UPDATE customers SET designated_therapist_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b' WHERE id = '830a1a84-b47a-49b7-9426-054f97dc80f8';
UPDATE customers SET designated_therapist_id = '1d2165fa-5263-4521-9402-d19b8ceae451' WHERE id = 'c074025b-cd27-443c-93a9-151d6d4214d4';
UPDATE customers SET designated_therapist_id = '1d2165fa-5263-4521-9402-d19b8ceae451' WHERE id = 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b';
UPDATE customers SET designated_therapist_id = '8d244cee-3a7c-4220-8e1c-43e03c8e505a' WHERE id = 'd2b849b3-cb3d-4d4e-88f0-1e5b5d393d7a';
UPDATE customers SET designated_therapist_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b' WHERE id = 'de5436a5-40b0-4ef5-8f30-c3a677f33391';
UPDATE customers SET designated_therapist_id = '5c17e4bc-e948-4dc4-a8cf-37904873edeb' WHERE id = 'e59d3172-5f99-42d4-b7b6-367704d3bff2';
UPDATE customers SET designated_therapist_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b' WHERE id = 'e72022d0-7cf5-4f42-b5e3-b5162005b454';
COMMIT;
