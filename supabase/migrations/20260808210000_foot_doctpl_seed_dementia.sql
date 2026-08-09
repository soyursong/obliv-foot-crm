-- T-20260808-foot-DOCTPL-2ADD-BRAINVES-DEMENTIA (T2 치매약)
-- 서류 템플릿 데이터 seed (ADDITIVE · db_change:false · 무DDL)
--
-- 문지은 대표원장 요청(responder MSG-20260808-205407-6zjo):
--   진료관리 > 서류 템플릿 탭(admin/clinic-management?tab=document_templates)에
--   서류 템플릿 2종(뇌혈관약·치매약)을 추가. 관리자 UI 직접추가 가능하나 위임("네가 넣어줘").
--
-- ┌── T1: 뇌혈관약 (완결 — 20260808200000_foot_doctpl_seed_brainves.sql, deployed) ──
-- └── T2: 치매약  (본 파일) ────────────────────────────────────────────────────
--     당초 원문이 문장 중간 절단("...조기 대처가 지연되어 피")되어 HOLD 상태였으나,
--     responder(TICKET-UPDATE, ts 1786189940.994679) 원문 재독 결과 전체 본문 확보 완료
--     ("절단" 판단은 오류였고 본문은 완결). HOLD 해제 → 본 마이그로 INSERT.
--
-- 본 마이그 = 순수 데이터 row INSERT. DDL 없음(document_templates 旣존재).
--   선례 T-20260728-foot-DOCFORM-FIRSTVISIT-MGMTRECORD(form row INSERT=ADDITIVE·db_change false·GO·deployed).
--
-- verbatim: <b>치매약</b> 볼드 제목 + ▎ 문단 + [오늘날짜] placeholder 를 원문 글자 그대로 저장.
--   ([오늘날짜] → 발급일 자동치환은 T1(뇌혈관약)과 동일한 발급-시점 렌더 로직으로 처리되며,
--    본 seed 는 placeholder 문자열을 그대로 담기만 한다 — T1 과 동일 패턴.)
-- 멱등: name='치매약' 旣존재 시 재INSERT 안 함(AC-3 이름 중복 방지). 재실행 안전.
-- 무접촉: 기존 서류·템플릿·데이터 무영향(순수 ADDITIVE). sort_order=40(뇌혈관약 30 다음).

INSERT INTO public.document_templates (document_type, name, content, sort_order, is_active)
SELECT
  'opinion',
  '치매약',
  E'<b>치매약</b>\n\n▎ 상기환자는 상기증상 및 병명으로 [오늘날짜]에 내원하였고 양측 조갑진균증으로 인한 내향성 발톱과 염증소견으로 내원하심. 환자는 현재 인지기능 저하(치매) 치료를 위해 콜린에스터라제 억제제 등 경구약을 복용 중임. 콜린에스터라제 억제제는 그 자체로 미주신경을 항진시켜 서맥, 방실차단, 실신, 심정지 등 중대한 심장 전도장애를 유발할 수 있고 QT 연장 및 치명적 부정맥이 보고된 약물임. 경구 항진균제는 간의 약물 대사 효소를 강력히 억제하여 이들 치매약의 혈중 농도를 급격히 상승시킴으로써 서맥·실신·심정지 등 콜린성 및 심장 부작용을 위험 수준으로 증폭시킴. 특히 고령의 치매 환자는 심장 전도계 예비능이 저하되어 있고 심박수를 낮추는 다른 약물을 함께 복용하는 경우가 많아, 경구 항진균제 병용 시 실신·서맥으로 인한 낙상·골절·두개내출혈, 심정지 등 치명적 사건으로 이어질 위험이 매우 높음. 또한 치매 환자는 부작용 하지 못해 조기 대처가 지연되어 피해가 더욱 커짐.이처럼 경구 항진균제는 치매 환자에서 생명을 위협하는 심장 부작용을 유발할 수 있어 투여가 절대적으로 부적합하며, 전신 흡수 및 약물 상호작용이 없는 레이저 치료와 도포제 치료의. 향후 12-15개월간 외래 추시 및 반복적 보존적 치료를 요함.',
  40,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_templates WHERE name = '치매약'
);
