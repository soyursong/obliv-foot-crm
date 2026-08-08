-- T-20260808-foot-DOCTPL-2ADD-BRAINVES-DEMENTIA
-- 서류 템플릿 데이터 seed (ADDITIVE · db_change:false · 무DDL)
--
-- 문지은 대표원장 요청(responder MSG-20260808-205407-6zjo):
--   진료관리 > 서류 템플릿 탭(admin/clinic-management?tab=document_templates)에
--   서류 템플릿 2종(뇌혈관약·치매약)을 추가. 관리자 UI 직접추가 가능하나 위임("네가 넣어줘").
--
-- 본 마이그 = 순수 데이터 row INSERT. DDL 없음(document_templates 旣존재).
--   선례 T-20260728-foot-DOCFORM-FIRSTVISIT-MGMTRECORD(form row INSERT=ADDITIVE·db_change false·GO·deployed).
--
-- ┌── T1: 뇌혈관약 (본문 완결 — 착수·INSERT) ─────────────────────────────
-- └── T2: 치매약  (⚠ 원문 truncated — HOLD, 본 마이그에서 INSERT 제외) ──────
--     티켓 AC-2: §템플릿2 원문이 문장 중간 절단("...조기 대처가 지연되어 피"에서 끊김).
--     전체 본문 확보 前 INSERT 절대 금지(미완결 의료-법적 서식 방지).
--     → planner가 문지은 대표원장께 전체본문 재확보 → 티켓 업데이트로 T2 본문 전달 후
--       별도 마이그로 INSERT. 본 파일에는 T2 본문을 (절단본조차) 포함하지 않는다.
--
-- 멱등: name='뇌혈관약' 旣존재 시 재INSERT 안 함(AC-3 이름 중복 방지). 재실행 안전.
-- 무접촉: 기존 서류·템플릿·데이터 무영향(순수 ADDITIVE).

INSERT INTO public.document_templates (document_type, name, content, sort_order, is_active)
SELECT
  'opinion',
  '뇌혈관약',
  E'<b>뇌혈관약</b>\n\n▎ 상기환자는 상기증상 및 병명으로 [오늘날짜]에 내원하였고 양측 조갑진균증으로 인한 내향성 발톱과 염증소견으로 내원하심. 환자는 현재 뇌경색·뇌졸중 등 뇌혈관 질환의 치료 및 재발 방지를 위해 항응고제 또는 항혈소판제를 복용 중임. 경구 항진균제는 간의 약물 대사 효소를 강력히 억제하여 이들 항혈전제의 혈중 농도를 급격히 상승시킴으로써 뇌내출혈·위장관출혈 등 생명을 위협하는 대량 출혈을 유발할 수 있으며, 일부 항응고제와는 병용이 금기로 분류되어 있음. 반대로 일부 항혈소판제는 간 효소에 의해 활성형으로 전환되어야 약효를 나타내는데, 경구 항진균제가 이 활성화를 차단하여 항혈소판 효과를 무력화시킴으로써 뇌경색 재발 및 혈전성 사건을 초래할 수 있음. 즉 환자가 복용 중인 약제에 따라 경구 항진균제는 출혈과 혈전 양방향으로 생명을 위협할 수 있으며, 뇌혈관 질환은 단 한 번의 재발로도 사망 또는 영구적 중증 후유장애를 남길 수 있어 항혈전 치료의 교란이 절대 허용되지 않음. 이에 병용금기에 해당할 수 있는 경구 항진균제 투여는 절대적으로 부적합하며, 약물 상호작용이 전혀 없는 레이저 치료와 도포제 치료의 병행이 필요할 것으로 보임. 향후 12-15개월간 외래 추시 및 반복적 보존적 치료를 요함.',
  30,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_templates WHERE name = '뇌혈관약'
);
