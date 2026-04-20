-- 더미 데이터: 시뮬레이션 환자 15명 (신환 7 + 재진 8)
-- 각 단계별 분포, 오늘 날짜 기준
-- is_simulation = true → 시뮬레이션 종료 시 일괄 삭제 가능

DO $$
DECLARE
  v_clinic uuid;
  v_today date := CURRENT_DATE;
  v_cid uuid;
  v_pkg uuid;
  v_ci uuid;
BEGIN
  SELECT id INTO v_clinic FROM clinics WHERE slug = 'jongno-foot';
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'clinic not found'; END IF;

  -- 기존 시뮬레이션 데이터 정리
  DELETE FROM payments WHERE check_in_id IN (
    SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id WHERE cu.is_simulation = true
  );
  DELETE FROM check_ins WHERE customer_id IN (SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic);
  DELETE FROM package_sessions WHERE package_id IN (
    SELECT p.id FROM packages p JOIN customers cu ON p.customer_id = cu.id WHERE cu.is_simulation = true
  );
  DELETE FROM packages WHERE customer_id IN (SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic);
  DELETE FROM reservations WHERE customer_id IN (SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic);
  DELETE FROM customers WHERE is_simulation = true AND clinic_id = v_clinic;

  ---- 신환 7명 ----

  -- 1. 김서연 — 접수(registered)
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '김서연', '010-1001-0001', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order)
  VALUES (v_clinic, v_cid, '김서연', '010-1001-0001', 'new', 'registered', 1, v_today + interval '10h5m', 1);

  -- 2. 이지민 — 상담대기(consult_waiting)
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '이지민', '010-1001-0002', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order)
  VALUES (v_clinic, v_cid, '이지민', '010-1001-0002', 'new', 'consult_waiting', 2, v_today + interval '10h15m', 2);

  -- 3. 박하늘 — 상담중(consultation, 상담실2)
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '박하늘', '010-1001-0003', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, consultation_room, sort_order)
  VALUES (v_clinic, v_cid, '박하늘', '010-1001-0003', 'new', 'consultation', 3, v_today + interval '10h30m', '상담실2', 3);

  -- 4. 최민준 — 결제대기(payment_waiting) + 패키지1
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '최민준', '010-1001-0004', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 0, 'active', v_today) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, '최민준', '010-1001-0004', 'new', 'payment_waiting', 4, v_today + interval '10h45m', v_pkg, 4);

  -- 5. 정은서 — 시술대기(treatment_waiting) + 패키지2
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '정은서', '010-1001-0005', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, '정은서', '010-1001-0005', 'new', 'treatment_waiting', 5, v_today + interval '11h', v_pkg, 5);

  -- 6. 한소율 — 레이저(laser, 레이저실3) + 블레라벨
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '한소율', '010-1001-0006', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, laser_room, sort_order)
  VALUES (v_clinic, v_cid, '한소율', '010-1001-0006', 'new', 'laser', 6, v_today + interval '11h30m', v_pkg, '레이저실3', 6);

  -- 7. 윤채원 — 완료(done) + 패키지1 + 결제
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '윤채원', '010-1001-0007', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today - 30) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '윤채원', '010-1001-0007', 'new', 'done', 7, v_today + interval '9h30m', v_pkg, v_today + interval '12h', 7)
  RETURNING id INTO v_ci;
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type)
  VALUES (v_clinic, v_ci, v_cid, 3600000, 'card', 'payment');

  ---- 재진 8명 ----

  -- 8. 강도현 — 진료대기(exam_waiting, 원장진료 루트) + 패키지2
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '강도현', '010-2001-0001', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today - 60) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, notes, sort_order)
  VALUES (v_clinic, v_cid, '강도현', '010-2001-0001', 'returning', 'exam_waiting', 8, v_today + interval '10h10m', v_pkg, '{"needs_exam":true}', 8);

  -- 9. 서지안 — 원장실 진료중(examination, 원장실) + 블레라벨
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '서지안', '010-2001-0002', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 45) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, examination_room, notes, sort_order)
  VALUES (v_clinic, v_cid, '서지안', '010-2001-0002', 'returning', 'examination', 9, v_today + interval '10h20m', v_pkg, '원장실', '{"needs_exam":true}', 9);

  -- 10. 임하진 — 재진접수(registered, 원장진료 루트) + NoPain
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '임하진', '010-2001-0003', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, 'NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today - 90) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, notes, sort_order)
  VALUES (v_clinic, v_cid, '임하진', '010-2001-0003', 'returning', 'registered', 10, v_today + interval '10h25m', v_pkg, '{"needs_exam":true}', 10);

  -- 11. 오승우 — 재진접수(registered, 치료직행 루트) + 1month
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '오승우', '010-2001-0004', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '1month (4회)', '1month', 4, 4, 0, 0, 0, 1200000, 1200000, 'active', v_today - 10) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, notes, sort_order)
  VALUES (v_clinic, v_cid, '오승우', '010-2001-0004', 'returning', 'registered', 11, v_today + interval '10h35m', v_pkg, '{"needs_exam":false}', 11);

  -- 12. 배서준 — 사전처치(preconditioning, 치료실5) + 블레라벨
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '배서준', '010-2001-0005', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 30) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, treatment_room, sort_order)
  VALUES (v_clinic, v_cid, '배서준', '010-2001-0005', 'returning', 'preconditioning', 12, v_today + interval '10h50m', v_pkg, '치료실5', 12);

  -- 13. 조예린 — 레이저대기(laser, room=null) + 패키지2
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '조예린', '010-2001-0006', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today - 50) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order)
  VALUES (v_clinic, v_cid, '조예린', '010-2001-0006', 'returning', 'laser', 13, v_today + interval '11h5m', v_pkg, 13);

  -- 14. 남지후 — 레이저중(laser, 레이저실7) + 패키지1
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '남지후', '010-2001-0007', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today - 20) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, laser_room, sort_order)
  VALUES (v_clinic, v_cid, '남지후', '010-2001-0007', 'returning', 'laser', 14, v_today + interval '11h15m', v_pkg, '레이저실7', 14);

  -- 15. 유하은 — 완료(done) + NoPain + 결제
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '유하은', '010-2001-0008', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, 'NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today - 120) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order)
  VALUES (v_clinic, v_cid, '유하은', '010-2001-0008', 'returning', 'done', 15, v_today + interval '9h45m', v_pkg, v_today + interval '11h30m', 15)
  RETURNING id INTO v_ci;
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type)
  VALUES (v_clinic, v_ci, v_cid, 300000, 'card', 'payment');

  RAISE NOTICE 'Seeded 15 simulation patients (7 new + 8 returning)';
END $$;
