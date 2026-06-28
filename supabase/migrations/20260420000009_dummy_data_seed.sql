-- 더미 데이터: 시뮬레이션 환자 15명 (신환 7 + 재진 8)
-- 각 단계별 분포, 오늘 날짜 기준
-- is_simulation = true → 시뮬레이션 종료 시 일괄 삭제 가능
--
-- T-20260629-foot-DUMMYDATA-SEED-LINKAGE-FIX (P1): 4축 연동 보완
--   1) 15 check_ins 에 treatment_kind / treatment_memo({"details":...}) / doctor_note 채움
--      → MedicalChartPanel.visibleVisitHistory 필터 통과 (방문이력 표시)
--   2) 15 환자 각각 medical_charts 1건 INSERT (customer_id + clinic_id=v_clinic::text + visit_date=v_today)
--      → 진료차트·진료경과(clinical_progress) 표시
--   3) DELETE 블록에 medical_charts cleanup 추가 (is_simulation 격리 누수 방지)
--   범위: is_simulation=true 한정 · 운영 데이터 미접촉 · 스키마 무변경 (기존 컬럼 채움)

DO $$
DECLARE
  v_clinic uuid;
  v_today date := CURRENT_DATE;
  v_cid uuid;
  v_pkg uuid;
  v_ci uuid;
  -- T-20260629-foot-DUMMYDATA-SEED-LINKAGE-FIX: medical_charts 진료의 강제(트리거) 충족용
  v_doctor_id   uuid;
  v_doctor_name text;
  v_doctor_seal text;
BEGIN
  SELECT id INTO v_clinic FROM clinics WHERE slug = 'jongno-foot';
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'clinic not found'; END IF;

  -- 진료의(서명의) 1명 선택 — medical_charts.signing_doctor_id NOT NULL 강제(enforce_medchart_signing_doctor) 충족
  SELECT id, name, seal_image_url
    INTO v_doctor_id, v_doctor_name, v_doctor_seal
    FROM clinic_doctors
   WHERE clinic_id = v_clinic AND active = true
   ORDER BY is_default DESC, sort_order ASC
   LIMIT 1;
  IF v_doctor_id IS NULL THEN RAISE EXCEPTION 'active clinic_doctor not found for jongno-foot'; END IF;

  -- 기존 시뮬레이션 데이터 정리
  -- T-20260629-foot-DUMMYDATA-SEED-LINKAGE-FIX: medical_charts cleanup 추가
  --   medical_charts.customer_id 는 FK 미설정(customers 삭제로 CASCADE 안 됨) → 명시 삭제 필수.
  --   chart_doctor_memos 는 medical_chart_id FK ON DELETE CASCADE 이므로 함께 정리됨.
  DELETE FROM medical_charts WHERE customer_id IN (
    SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic
  );
  -- T-20260629-foot-DUMMYDATA-SEED-LINKAGE-FIX: payments 는 check_in_id 가 NULL 인 행도 있을 수 있어
  --   customer_id 기준까지 포함해 삭제(시뮬 고객 결제 전량 정리).
  DELETE FROM payments WHERE customer_id IN (SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic)
     OR check_in_id IN (
    SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic
  );
  DELETE FROM package_payments WHERE customer_id IN (SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic);
  -- T-20260629-foot-DUMMYDATA-SEED-LINKAGE-FIX: check_ins 를 참조하는 자식 테이블 FK(NO CASCADE) 가
  --   check_ins 삭제를 막음 → 자식 행을 check_ins 보다 먼저 삭제해야 재적용(idempotent) 가능.
  --   (payment_audit_logs.check_in_id / package_sessions.check_in_id 둘 다 NO CASCADE)
  DELETE FROM payment_audit_logs WHERE check_in_id IN (
    SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id
     WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic
  );
  -- package_sessions: package_id 경유 + check_in_id 경유 양쪽 모두 정리 (cross-seed [경과테스트] 포함)
  DELETE FROM package_sessions WHERE package_id IN (
    SELECT p.id FROM packages p JOIN customers cu ON p.customer_id = cu.id WHERE cu.is_simulation = true
  );
  DELETE FROM package_sessions WHERE check_in_id IN (
    SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id
     WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic
  );
  -- check_ins 를 NO ACTION(차단) FK 로 참조하는 나머지 자식 테이블도 선삭제.
  --   (CASCADE/SET NULL FK 자식은 check_ins 삭제 시 자동 처리되어 별도 정리 불필요)
  DELETE FROM consent_forms       WHERE check_in_id IN (SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic);
  DELETE FROM checklists          WHERE check_in_id IN (SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic);
  DELETE FROM insurance_documents WHERE check_in_id IN (SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic);
  DELETE FROM notifications       WHERE check_in_id IN (SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic);
  DELETE FROM form_submissions    WHERE check_in_id IN (SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic);
  DELETE FROM service_charges     WHERE check_in_id IN (SELECT ci.id FROM check_ins ci JOIN customers cu ON ci.customer_id = cu.id WHERE cu.is_simulation = true AND cu.clinic_id = v_clinic);
  -- check_ins 는 자식 행 정리 후 삭제
  DELETE FROM check_ins WHERE customer_id IN (SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic);
  DELETE FROM packages WHERE customer_id IN (SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic);
  DELETE FROM reservations WHERE customer_id IN (SELECT id FROM customers WHERE is_simulation = true AND clinic_id = v_clinic);
  DELETE FROM customers WHERE is_simulation = true AND clinic_id = v_clinic;

  ---- 신환 7명 ----

  -- 1. 김서연 — 접수(registered)
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '김서연', '010-1001-0001', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '김서연', '010-1001-0001', 'new', 'registered', 1, v_today + interval '10h5m', 1,
    '상담', jsonb_build_object('details', '초진 접수. 양발 엄지발톱 변색 주호소 접수 완료.'), '초진 대기 — 양발 엄지발톱 황변·두꺼워짐 주호소');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 엄지발톱 황변·두꺼워짐 (약 3개월)', '조갑진균증 의증 (B35.1)', '초진 상담 — 검사 후 치료 계획 수립 예정', '초진 접수 단계. 발톱 상태 확인 후 치료 방향 결정 예정.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 2. 이지민 — 상담대기(consult_waiting)
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '이지민', '010-1001-0002', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '이지민', '010-1001-0002', 'new', 'consult_waiting', 2, v_today + interval '10h15m', 2,
    '상담', jsonb_build_object('details', '상담 대기. 양발 새끼발톱 두꺼움 — 발톱무좀 상담 예정.'), '상담 대기 — 양발 새끼발톱 비후 호소');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 새끼발톱 비후 (수개월)', '조갑비후증 의증 (L60.2)', '상담 대기 — 치료 옵션 안내 예정', '상담 전 단계. 패키지 치료 옵션 안내 예정.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 3. 박하늘 — 상담중(consultation, 상담실2)
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '박하늘', '010-1001-0003', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, consultation_room, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '박하늘', '010-1001-0003', 'new', 'consultation', 3, v_today + interval '10h30m', '상담실2', 3,
    '상담', jsonb_build_object('details', '상담 진행 중. 발톱 진균+통증 — 패키지 치료 안내.'), '상담 중 — 양발 발톱 진균·통증, 패키지 치료 권유');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 변색 및 통증', '조갑진균증 (B35.1)', '상담 진행 — 치료 계획 협의 중', '상담 단계. 패키지 치료 권장, 치료 계획 협의 중.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 4. 최민준 — 결제대기(payment_waiting) + 패키지1
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '최민준', '010-1001-0004', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 0, 'active', v_today) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '최민준', '010-1001-0004', 'new', 'payment_waiting', 4, v_today + interval '10h45m', v_pkg, 4,
    '상담+결제', jsonb_build_object('details', '패키지1 12회 결제 대기. 치료 시작 예정.'), '결제 대기 — 패키지1 12회 치료 계획 확정');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 두꺼워짐·통증', '조갑비후증 (L60.2)', '패키지1 12회 치료 계획 수립', '치료 시작 전. 패키지1 12회 결제 진행 단계.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 5. 정은서 — 시술대기(treatment_waiting) + 패키지2
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '정은서', '010-1001-0005', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '정은서', '010-1001-0005', 'new', 'treatment_waiting', 5, v_today + interval '11h', v_pkg, 5,
    '가열레이저', jsonb_build_object('details', '패키지2 1회차 시술 대기. 프리컨디셔닝 준비.'), '시술 대기 — 패키지2 24회 1회차, 가열레이저 예정');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱백선·비후', '발톱백선 + 조갑비후증 (B35.1, L60.2)', '패키지2 1회차 시술 대기 — 가열레이저 예정', '1회차 시술 준비. 프리컨디셔닝 후 레이저 진행 예정.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 6. 한소율 — 레이저(laser, 레이저실3) + 블레라벨
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '한소율', '010-1001-0006', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, laser_room, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '한소율', '010-1001-0006', 'new', 'laser', 6, v_today + interval '11h30m', v_pkg, '레이저실3', 6,
    '프컨+레이저', jsonb_build_object('details', '블레라벨 1회차 레이저 진행 중. 양발 10발가락 전체.'), '레이저 진행 — 블레라벨 1회차, 양발 전체 조사');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 변색·비후·통증', '발톱백선 복합 (B35.1, L60.2)', '블레라벨 1회차 — 프리컨디셔닝 30분 후 가열레이저 양발 시술', '1회차 시술 중. 양발 10발가락 전체 조사. 이상반응 없음.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 7. 윤채원 — 완료(done) + 패키지1 + 결제
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '윤채원', '010-1001-0007', 'new', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today - 30) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '윤채원', '010-1001-0007', 'new', 'done', 7, v_today + interval '9h30m', v_pkg, v_today + interval '12h', 7,
    '가열레이저', jsonb_build_object('details', '패키지1 1회차 완료. 양발 시술 후 경과 양호.'), '1회차 완료 — 시술 후 통증 호소 없음, 2주 후 재방문 안내')
  RETURNING id INTO v_ci;
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 두꺼워짐 (수개월)', '조갑비후증 (L60.2)', '패키지1 1회차 — 가열레이저 양발 시술 완료', '1회차 완료. 시술 후 이상반응 없음. 2주 후 재방문 예약.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type)
  VALUES (v_clinic, v_ci, v_cid, 3600000, 'card', 'payment');

  ---- 재진 8명 ----

  -- 8. 강도현 — 진료대기(exam_waiting, 원장진료 루트) + 패키지2
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '강도현', '010-2001-0001', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today - 60) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, notes, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '강도현', '010-2001-0001', 'returning', 'exam_waiting', 8, v_today + interval '10h10m', v_pkg, '{"needs_exam":true}', 8,
    '가열레이저', jsonb_build_object('details', '재진 진료 대기. 패키지2 진행 경과 확인 예정.'), '진료 대기 — 패키지2 진행 경과 확인 후 시술 예정');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 경과 확인', '조갑비후증 호전 단계 (L60.2)', '패키지2 경과 진료 대기', '재진. 이전 회차 대비 호전. 금일 진료 후 시술 예정.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 9. 서지안 — 원장실 진료중(examination, 원장실) + 블레라벨
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '서지안', '010-2001-0002', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 45) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, examination_room, notes, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '서지안', '010-2001-0002', 'returning', 'examination', 9, v_today + interval '10h20m', v_pkg, '원장실', '{"needs_exam":true}', 9,
    '프컨+레이저', jsonb_build_object('details', '원장 진료 중. 블레라벨 경과 양호, 색상 개선 확인.'), '진료 중 — 발톱 호전, 동일 프로토콜 유지');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱백선 경과', '발톱백선 호전 (B35.1)', '블레라벨 경과 진료 — 호전 확인, 시술 계속', '재진 진료 중. 발톱 색상 개선 확인. 시술 계속 진행.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 10. 임하진 — 재진접수(registered, 원장진료 루트) + NoPain
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '임하진', '010-2001-0003', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, 'NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today - 90) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, notes, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '임하진', '010-2001-0003', 'returning', 'registered', 10, v_today + interval '10h25m', v_pkg, '{"needs_exam":true}', 10,
    '가열레이저', jsonb_build_object('details', '재진 접수. NoPain 유지치료 단계.'), '재진 접수 — NoPain 유지 단계, 상태 안정적');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 유지치료', '조갑비후증 유지치료 (L60.2)', 'NoPain 유지치료 접수', '재진 접수. 유지치료 단계, 상태 안정적.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 11. 오승우 — 재진접수(registered, 치료직행 루트) + 1month
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '오승우', '010-2001-0004', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '1month (4회)', '1month', 4, 4, 0, 0, 0, 1200000, 1200000, 'active', v_today - 10) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, notes, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '오승우', '010-2001-0004', 'returning', 'registered', 11, v_today + interval '10h35m', v_pkg, '{"needs_exam":false}', 11,
    '비가열레이저', jsonb_build_object('details', '재진 접수 — 치료 직행. 1month 단기 집중치료 진행.'), '치료 직행 — 진료 생략(needs_exam=false)');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 단기 집중치료', '조갑비후증 (L60.2)', '1month 치료 직행 — 진료 생략', '재진. 단기 패키지 진행 중. 치료 직행.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 12. 배서준 — 사전처치(preconditioning, 치료실5) + 블레라벨
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '배서준', '010-2001-0005', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '블레라벨 (36회)', 'blelabel', 36, 12, 12, 12, 12, 8400000, 8400000, 'active', v_today - 30) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, treatment_room, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '배서준', '010-2001-0005', 'returning', 'preconditioning', 12, v_today + interval '10h50m', v_pkg, '치료실5', 12,
    '프리컨디셔닝', jsonb_build_object('details', '프리컨디셔닝 진행 중. 레이저 전 선처치.'), '사전처치 중 — 레이저 준비 단계');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 진균·비후', '발톱백선 (B35.1)', '블레라벨 — 프리컨디셔닝 선처치 진행', '사전처치 단계. 프리컨디셔닝 후 레이저 예정.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 13. 조예린 — 레이저대기(laser, room=null) + 패키지2
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '조예린', '010-2001-0006', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지2 (24회)', 'package2', 24, 12, 12, 0, 0, 6000000, 6000000, 'active', v_today - 50) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '조예린', '010-2001-0006', 'returning', 'laser', 13, v_today + interval '11h5m', v_pkg, 13,
    '가열레이저', jsonb_build_object('details', '레이저 대기. 패키지2 진행, 두께 감소 경과.'), '레이저 대기 — 패키지2, 이전 대비 호전');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 비후 경과', '조갑비후증 호전 (L60.2)', '패키지2 — 레이저 시술 대기', '레이저 대기 중. 이전 대비 발톱 두께 감소.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 14. 남지후 — 레이저중(laser, 레이저실7) + 패키지1
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '남지후', '010-2001-0007', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, '패키지1 (12회)', 'package1', 12, 12, 0, 0, 0, 3600000, 3600000, 'active', v_today - 20) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, laser_room, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '남지후', '010-2001-0007', 'returning', 'laser', 14, v_today + interval '11h15m', v_pkg, '레이저실7', 14,
    '가열레이저', jsonb_build_object('details', '레이저 진행 중. 패키지1 후반 회차, 발톱 정상화 진행.'), '레이저 중 — 패키지1 후반, 통증 거의 소실');
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 두께 감소 경과', '조갑비후증 호전 (L60.2)', '패키지1 — 가열레이저 양발 시술 중', '시술 중. 발톱 정상화 진행. 통증 거의 소실.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);

  -- 15. 유하은 — 완료(done) + NoPain + 결제
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation)
  VALUES (v_clinic, '유하은', '010-2001-0008', 'returning', true) RETURNING id INTO v_cid;
  INSERT INTO packages (clinic_id, customer_id, package_name, package_type, total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions, total_amount, paid_amount, status, contract_date)
  VALUES (v_clinic, v_cid, 'NoPain (48회)', 'nopain', 48, 12, 12, 12, 12, 10800000, 10800000, 'active', v_today - 120) RETURNING id INTO v_pkg;
  INSERT INTO check_ins (clinic_id, customer_id, customer_name, customer_phone, visit_type, status, queue_number, checked_in_at, package_id, completed_at, sort_order, treatment_kind, treatment_memo, doctor_note)
  VALUES (v_clinic, v_cid, '유하은', '010-2001-0008', 'returning', 'done', 15, v_today + interval '9h45m', v_pkg, v_today + interval '11h30m', 15,
    '프컨+레이저', jsonb_build_object('details', 'NoPain 시술 완료. 유지치료 경과 양호, 발톱 정상 유지.'), '완료 — 발톱 정상 유지, 추가 결제 완료, 다음 유지 방문 예약')
  RETURNING id INTO v_ci;
  INSERT INTO medical_charts (customer_id, clinic_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress, created_by, signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)
  VALUES (v_cid, v_clinic::text, v_today, '양발 발톱 유지치료 경과', '조갑비후증 유지치료 (L60.2)', 'NoPain — 프리컨디셔닝+레이저 시술 완료', '시술 완료. 발톱 정상 유지. 다음 유지 방문 예약.', 'system_seed', v_doctor_id, v_doctor_name, v_doctor_seal);
  INSERT INTO payments (clinic_id, check_in_id, customer_id, amount, method, payment_type)
  VALUES (v_clinic, v_ci, v_cid, 300000, 'card', 'payment');

  RAISE NOTICE 'Seeded 15 simulation patients (7 new + 8 returning)';
END $$;
