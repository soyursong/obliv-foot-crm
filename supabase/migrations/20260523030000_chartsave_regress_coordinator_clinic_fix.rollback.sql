-- ROLLBACK: T-20260523-foot-CHARTSAVE-REGRESS coordinator clinic_id fix
-- kim@oblivseoul.kr clinic_id 복원 (NULL로)

UPDATE user_profiles
   SET clinic_id = NULL
 WHERE id    = '2b613328-5c4e-43d3-8b8c-649806bc1095'
   AND email = 'kim@oblivseoul.kr';
