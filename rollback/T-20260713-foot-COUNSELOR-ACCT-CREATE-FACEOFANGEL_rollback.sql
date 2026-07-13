-- Rollback: T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL 상태정정 되돌리기
UPDATE public.user_profiles SET role = 'coordinator', clinic_id = NULL
 WHERE id = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';
