-- rollback: dosu-center form_templates 10종 삭제
DELETE FROM form_templates
WHERE category = 'dosu-center'
  AND clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND form_key IN (
    'dosu_consent',
    'general_consent',
    'minor_consent',
    'nonbenefit_explain',
    'growth_hormone_survey',
    'model_contract_1',
    'model_contract_2',
    'experience_portrait',
    'initial_chart',
    'row_chart'
  );
