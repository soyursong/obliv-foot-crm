-- =============================================================
-- 풋센터 CRM 더미데이터 30건 — 5/13 현장 테스트용
-- T-20260513-foot-DUMMY-DATA-30
-- 초진 15건 + 재진 15건, 2026-05-13 10:00~19:00
-- 식별자: [TEST] prefix + is_simulation = true
-- =============================================================

DO $$
DECLARE
  v_clinic    uuid;
  v_today     date := '2026-05-13';
  v_cid       uuid;
  v_pkg       uuid;
  v_ci        uuid;
  v_res_id    uuid;
  v_svc_laser uuid;
  v_svc_iv    uuid;
  v_svc_nail  uuid;
BEGIN
  -- 클리닉 확인
  SELECT id INTO v_clinic FROM clinics WHERE slug = 'jongno-foot';
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'clinic jongno-foot not found'; END IF;

  -- 서비스 ID 조회 (없으면 NULL 허용)
  SELECT id INTO v_svc_laser FROM services WHERE clinic_id = v_clinic AND name LIKE '가열 레이저%' LIMIT 1;
  SELECT id INTO v_svc_iv    FROM services WHERE clinic_id = v_clinic AND name LIKE '수액%' LIMIT 1;
  SELECT id INTO v_svc_nail  FROM services WHERE clinic_id = v_clinic AND name LIKE '발톱%' LIMIT 1;

  RAISE NOTICE '클리닉 ID: %, 레이저: %, 수액: %, 발톱: %', v_clinic, v_svc_laser, v_svc_iv, v_svc_nail;

  -- =============================================================
  -- 초진 15건 (visit_type: 'new')
  -- 신규 루트: registered → consult_waiting → consultation
  --           → exam_waiting → examination → treatment_waiting
  --           → preconditioning → laser_waiting → laser → done
  -- =============================================================

  -- 1. [TEST] 김민지 — 접수(registered) 10:00
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation, inflow_channel)
  VALUES (v_clinic, '[TEST] 김민지', '+821099010001', 'new', true, 'meta_ads')
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 김민지', '+821099010001', v_today, '10:00', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 김민지', '+821099010001', 'new', 'registered', 101, (v_today::timestamp + interval '10 hours'), 101);

  -- 2. [TEST] 이수아 — 접수(registered) 10:20
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation, inflow_channel)
  VALUES (v_clinic, '[TEST] 이수아', '+821099010002', 'new', true, 'naver_talk')
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 이수아', '+821099010002', v_today, '10:20', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 이수아', '+821099010002', 'new', 'registered', 102, (v_today::timestamp + interval '10 hours 20 minutes'), 102);

  -- 3. [TEST] 박지현 — 접수(registered) 10:40
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation, inflow_channel)
  VALUES (v_clinic, '[TEST] 박지현', '+821099010003', 'new', true, 'kakao')
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 박지현', '+821099010003', v_today, '10:40', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 박지현', '+821099010003', 'new', 'registered', 103, (v_today::timestamp + interval '10 hours 40 minutes'), 103);

  -- 4. [TEST] 정하윤 — 상담대기(consult_waiting) 11:00
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 정하윤', '+821099010004', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 정하윤', '+821099010004', v_today, '11:00', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 정하윤', '+821099010004', 'new', 'consult_waiting', 104, (v_today::timestamp + interval '11 hours'), 104);

  -- 5. [TEST] 최서연 — 상담대기(consult_waiting) 11:20
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 최서연', '+821099010005', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 최서연', '+821099010005', v_today, '11:20', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 최서연', '+821099010005', 'new', 'consult_waiting', 105, (v_today::timestamp + interval '11 hours 20 minutes'), 105);

  -- 6. [TEST] 한예원 — 상담중(consultation, 상담실1) 11:40
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 한예원', '+821099010006', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 한예원', '+821099010006', v_today, '11:40', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, consultation_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 한예원', '+821099010006', 'new', 'consultation', 106, (v_today::timestamp + interval '11 hours 40 minutes'), '상담실1', 106);

  -- 7. [TEST] 윤서진 — 상담중(consultation, 상담실2) 12:00
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 윤서진', '+821099010007', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 윤서진', '+821099010007', v_today, '12:00', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, consultation_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 윤서진', '+821099010007', 'new', 'consultation', 107, (v_today::timestamp + interval '12 hours'), '상담실2', 107);

  -- 8. [TEST] 임채원 — 진료대기(exam_waiting) 12:20
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 임채원', '+821099010008', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 임채원', '+821099010008', v_today, '12:20', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, notes, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 임채원', '+821099010008', 'new', 'exam_waiting', 108, (v_today::timestamp + interval '12 hours 20 minutes'), '{"needs_exam":true}', 108);

  -- 9. [TEST] 강민서 — 원장실(examination, 원장실) 12:40
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 강민서', '+821099010009', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 강민서', '+821099010009', v_today, '12:40', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, examination_room, notes, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 강민서', '+821099010009', 'new', 'examination', 109, (v_today::timestamp + interval '12 hours 40 minutes'), '원장실', '{"needs_exam":true}', 109);

  -- 10. [TEST] 서유나 — 관리대기(treatment_waiting) + 패키지1 13:00
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 서유나', '+821099010010', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today)
  RETURNING id INTO v_pkg;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 서유나', '+821099010010', v_today, '13:00', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 서유나', '+821099010010', 'new', 'treatment_waiting', 110, (v_today::timestamp + interval '13 hours'), v_pkg, 110);

  -- 11. [TEST] 조나현 — 관리대기(treatment_waiting) + 패키지2 13:20
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 조나현', '+821099010011', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today)
  RETURNING id INTO v_pkg;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 조나현', '+821099010011', v_today, '13:20', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 조나현', '+821099010011', 'new', 'treatment_waiting', 111, (v_today::timestamp + interval '13 hours 20 minutes'), v_pkg, 111);

  -- 12. [TEST] 배수빈 — 프리컨디셔닝(preconditioning, 치료실3) + 블레라벨 13:40
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 배수빈', '+821099010012', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today)
  RETURNING id INTO v_pkg;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 배수빈', '+821099010012', v_today, '13:40', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, treatment_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 배수빈', '+821099010012', 'new', 'preconditioning', 112, (v_today::timestamp + interval '13 hours 40 minutes'), v_pkg, '치료실3', 112);

  -- 13. [TEST] 남하린 — 레이저대기(laser_waiting) + 패키지1 14:00
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 남하린', '+821099010013', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today)
  RETURNING id INTO v_pkg;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 남하린', '+821099010013', v_today, '14:00', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 남하린', '+821099010013', 'new', 'laser_waiting', 113, (v_today::timestamp + interval '14 hours'), v_pkg, 113);

  -- 14. [TEST] 오지유 — 레이저(laser, 레이저실5) + NoPain 14:20
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 오지유', '+821099010014', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today)
  RETURNING id INTO v_pkg;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 오지유', '+821099010014', v_today, '14:20', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, laser_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 오지유', '+821099010014', 'new', 'laser', 114, (v_today::timestamp + interval '14 hours 20 minutes'), v_pkg, '레이저실5', 114);

  -- 15. [TEST] 신예진 — 완료(done) + 패키지2 + 결제 14:40 / 완료 16:00
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 신예진', '+821099010015', 'new', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today)
  RETURNING id INTO v_pkg;
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 신예진', '+821099010015', v_today, '14:40', 'new', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 신예진', '+821099010015', 'new', 'done', 115, (v_today::timestamp + interval '14 hours 40 minutes'), v_pkg, (v_today::timestamp + interval '16 hours'), 115)
  RETURNING id INTO v_ci;
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type)
  VALUES (v_clinic, v_ci, v_cid, 6000000, 'card', 'payment');

  -- =============================================================
  -- 재진 15건 (visit_type: 'returning')
  -- 재진 루트: registered → treatment_waiting → preconditioning
  --            → laser_waiting → laser → payment_waiting → done
  -- 각 고객에게 과거 방문 이력(check_in) 추가
  -- =============================================================

  -- 16. [TEST] 김태민 — 접수(registered) + 패키지2 (기존) 10:10
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 김태민', '+821099010016', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today - 30)
  RETURNING id INTO v_pkg;
  -- 과거 방문 이력 (4/13)
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 김태민', '+821099010016', 'returning', 'done', 51, (v_today - 30)::timestamp + interval '11 hours', v_pkg, (v_today - 30)::timestamp + interval '12 hours 30 minutes', 51);
  -- 오늘 예약
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 김태민', '+821099010016', v_today, '10:10', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 김태민', '+821099010016', 'returning', 'registered', 116, (v_today::timestamp + interval '10 hours 10 minutes'), v_pkg, 116);

  -- 17. [TEST] 이도현 — 접수(registered) + 블레라벨 10:30
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 이도현', '+821099010017', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 45)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 이도현', '+821099010017', 'returning', 'done', 52, (v_today - 45)::timestamp + interval '14 hours', v_pkg, (v_today - 45)::timestamp + interval '15 hours 30 minutes', 52);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 이도현', '+821099010017', v_today, '10:30', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 이도현', '+821099010017', 'returning', 'registered', 117, (v_today::timestamp + interval '10 hours 30 minutes'), v_pkg, 117);

  -- 18. [TEST] 박준혁 — 접수(registered) + NoPain 10:50
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 박준혁', '+821099010018', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today - 60)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 박준혁', '+821099010018', 'returning', 'done', 53, (v_today - 60)::timestamp + interval '10 hours', v_pkg, (v_today - 60)::timestamp + interval '11 hours 30 minutes', 53);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 박준혁', '+821099010018', v_today, '10:50', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 박준혁', '+821099010018', 'returning', 'registered', 118, (v_today::timestamp + interval '10 hours 50 minutes'), v_pkg, 118);

  -- 19. [TEST] 정시원 — 관리대기(treatment_waiting) + 패키지1 11:10
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 정시원', '+821099010019', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today - 14)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 정시원', '+821099010019', 'returning', 'done', 54, (v_today - 14)::timestamp + interval '11 hours', v_pkg, (v_today - 14)::timestamp + interval '12 hours', 54);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 정시원', '+821099010019', v_today, '11:10', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 정시원', '+821099010019', 'returning', 'treatment_waiting', 119, (v_today::timestamp + interval '11 hours 10 minutes'), v_pkg, 119);

  -- 20. [TEST] 최우진 — 관리대기(treatment_waiting) + 블레라벨 11:30
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 최우진', '+821099010020', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 20)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 최우진', '+821099010020', 'returning', 'done', 55, (v_today - 20)::timestamp + interval '13 hours', v_pkg, (v_today - 20)::timestamp + interval '14 hours 30 minutes', 55);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 최우진', '+821099010020', v_today, '11:30', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 최우진', '+821099010020', 'returning', 'treatment_waiting', 120, (v_today::timestamp + interval '11 hours 30 minutes'), v_pkg, 120);

  -- 21. [TEST] 한재원 — 관리대기(treatment_waiting) + NoPain 11:50
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 한재원', '+821099010021', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today - 90)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 한재원', '+821099010021', 'returning', 'done', 56, (v_today - 90)::timestamp + interval '11 hours', v_pkg, (v_today - 90)::timestamp + interval '12 hours 30 minutes', 56);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 한재원', '+821099010021', v_today, '11:50', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 한재원', '+821099010021', 'returning', 'treatment_waiting', 121, (v_today::timestamp + interval '11 hours 50 minutes'), v_pkg, 121);

  -- 22. [TEST] 윤성민 — 프리컨디셔닝(preconditioning, 치료실6) + 패키지2 12:10
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 윤성민', '+821099010022', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today - 35)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 윤성민', '+821099010022', 'returning', 'done', 57, (v_today - 35)::timestamp + interval '12 hours', v_pkg, (v_today - 35)::timestamp + interval '13 hours 30 minutes', 57);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 윤성민', '+821099010022', v_today, '12:10', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, treatment_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 윤성민', '+821099010022', 'returning', 'preconditioning', 122, (v_today::timestamp + interval '12 hours 10 minutes'), v_pkg, '치료실6', 122);

  -- 23. [TEST] 임지호 — 프리컨디셔닝(preconditioning, 치료실8) + 블레라벨 12:30
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 임지호', '+821099010023', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 50)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 임지호', '+821099010023', 'returning', 'done', 58, (v_today - 50)::timestamp + interval '14 hours', v_pkg, (v_today - 50)::timestamp + interval '15 hours 30 minutes', 58);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 임지호', '+821099010023', v_today, '12:30', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, treatment_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 임지호', '+821099010023', 'returning', 'preconditioning', 123, (v_today::timestamp + interval '12 hours 30 minutes'), v_pkg, '치료실8', 123);

  -- 24. [TEST] 강찬호 — 레이저대기(laser_waiting) + 패키지1 12:50
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 강찬호', '+821099010024', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today - 7)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 강찬호', '+821099010024', 'returning', 'done', 59, (v_today - 7)::timestamp + interval '10 hours', v_pkg, (v_today - 7)::timestamp + interval '11 hours 30 minutes', 59);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 강찬호', '+821099010024', v_today, '12:50', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 강찬호', '+821099010024', 'returning', 'laser_waiting', 124, (v_today::timestamp + interval '12 hours 50 minutes'), v_pkg, 124);

  -- 25. [TEST] 서민재 — 레이저대기(laser_waiting) + NoPain 13:10
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 서민재', '+821099010025', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today - 25)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 서민재', '+821099010025', 'returning', 'done', 60, (v_today - 25)::timestamp + interval '15 hours', v_pkg, (v_today - 25)::timestamp + interval '16 hours 30 minutes', 60);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 서민재', '+821099010025', v_today, '13:10', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 서민재', '+821099010025', 'returning', 'laser_waiting', 125, (v_today::timestamp + interval '13 hours 10 minutes'), v_pkg, 125);

  -- 26. [TEST] 조현우 — 레이저(laser, 레이저실2) + 패키지2 13:30
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 조현우', '+821099010026', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today - 40)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 조현우', '+821099010026', 'returning', 'done', 61, (v_today - 40)::timestamp + interval '13 hours', v_pkg, (v_today - 40)::timestamp + interval '14 hours 30 minutes', 61);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 조현우', '+821099010026', v_today, '13:30', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, laser_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 조현우', '+821099010026', 'returning', 'laser', 126, (v_today::timestamp + interval '13 hours 30 minutes'), v_pkg, '레이저실2', 126);

  -- 27. [TEST] 배주원 — 레이저(laser, 레이저실4) + 블레라벨 13:50
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 배주원', '+821099010027', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 55)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 배주원', '+821099010027', 'returning', 'done', 62, (v_today - 55)::timestamp + interval '11 hours', v_pkg, (v_today - 55)::timestamp + interval '12 hours 30 minutes', 62);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 배주원', '+821099010027', v_today, '13:50', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, laser_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 배주원', '+821099010027', 'returning', 'laser', 127, (v_today::timestamp + interval '13 hours 50 minutes'), v_pkg, '레이저실4', 127);

  -- 28. [TEST] 남유진 — 레이저(laser, 레이저실9) + NoPain 14:10
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 남유진', '+821099010028', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today - 70)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 남유진', '+821099010028', 'returning', 'done', 63, (v_today - 70)::timestamp + interval '10 hours', v_pkg, (v_today - 70)::timestamp + interval '11 hours 30 minutes', 63);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 남유진', '+821099010028', v_today, '14:10', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, laser_room, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 남유진', '+821099010028', 'returning', 'laser', 128, (v_today::timestamp + interval '14 hours 10 minutes'), v_pkg, '레이저실9', 128);

  -- 29. [TEST] 오민준 — 수납대기(payment_waiting) + 패키지1 14:30
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 오민준', '+821099010029', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today - 10)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 오민준', '+821099010029', 'returning', 'done', 64, (v_today - 10)::timestamp + interval '14 hours', v_pkg, (v_today - 10)::timestamp + interval '15 hours 30 minutes', 64);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 오민준', '+821099010029', v_today, '14:30', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 오민준', '+821099010029', 'returning', 'payment_waiting', 129, (v_today::timestamp + interval '14 hours 30 minutes'), v_pkg, 129);

  -- 30. [TEST] 신서하 — 완료(done) + 블레라벨 + 결제 15:00 / 완료 17:00
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '[TEST] 신서하', '+821099010030', 'returning', true)
  RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '[TEST] 블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 80)
  RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '[TEST] 신서하', '+821099010030', 'returning', 'done', 65, (v_today - 80)::timestamp + interval '13 hours', v_pkg, (v_today - 80)::timestamp + interval '14 hours 30 minutes', 65);
  INSERT INTO reservations (clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time, visit_type, memo, status)
  VALUES (v_clinic, v_cid, '[TEST] 신서하', '+821099010030', v_today, '15:00', 'returning', '[TEST]더미', 'confirmed')
  RETURNING id INTO v_res_id;
  INSERT INTO check_ins (clinic_id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, v_res_id, '[TEST] 신서하', '+821099010030', 'returning', 'done', 130, (v_today::timestamp + interval '15 hours'), v_pkg, (v_today::timestamp + interval '17 hours'), 130)
  RETURNING id INTO v_ci;
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type)
  VALUES (v_clinic, v_ci, v_cid, 0, 'card', 'payment');  -- 패키지 선납, 당일 수납 0

  RAISE NOTICE '✅ [TEST] 더미데이터 30건 삽입 완료 — 초진 15건 + 재진 15건 (T-20260513-foot-DUMMY-DATA-30)';
END $$;
