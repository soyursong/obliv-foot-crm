-- T-20260423-foot-DOC-PRINT-SPEC Phase 1 — form_templates seed (foot-service 5종)
-- 대상 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브 풋센터 종로)
-- field_map은 placeholder 빈 배열로 시작. Phase 2(원장 승인 후 좌표 측정)에서 채움.
-- 6종 중 표준처방전(rx_standard)은 별건 티켓(T-20260423-foot-RX-CODE-SEED) 영역으로 제외.
-- 멱등: ON CONFLICT DO NOTHING — clinic_id+category+form_key 자연 키 가정.

INSERT INTO form_templates (
  clinic_id, category, form_key, name_ko,
  template_path, template_format, field_map,
  requires_signature, required_role, active, sort_order
) VALUES
  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', 'foot-service', 'diag_opinion',
   '소견서',
   '/assets/forms/foot-service/소견서.jpg', 'jpg', '[]'::jsonb,
   false, 'admin', true, 10),

  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', 'foot-service', 'diagnosis',
   '진단서',
   '/assets/forms/foot-service/진단서.jpg', 'jpg', '[]'::jsonb,
   true, 'admin', true, 20),

  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', 'foot-service', 'bill_detail',
   '진료비내역서',
   '/assets/forms/foot-service/진료비내역서.pdf', 'pdf', '[]'::jsonb,
   false, 'coordinator', true, 30),

  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', 'foot-service', 'treat_confirm',
   '진료확인서',
   '/assets/forms/foot-service/진료확인서.jpg', 'jpg', '[]'::jsonb,
   false, 'coordinator', true, 40),

  ('74967aea-a60b-4da3-a0e7-9c997a930bc8', 'foot-service', 'visit_confirm',
   '통원확인서',
   '/assets/forms/foot-service/통원확인서.jpg', 'jpg', '[]'::jsonb,
   false, 'coordinator', true, 50)
ON CONFLICT DO NOTHING;
