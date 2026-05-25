-- T-20260525-foot-FEE-SET-TEMPLATE AC-3: rollback
-- 시드 3건 제거 (종로 풋센터)

DELETE FROM fee_set_templates
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND set_name IN ('초진/무좀', '초진/내성', '재진/내성');
