-- T-20260526-foot-DUMMY-12RX: 경과파악(타임라인) 테스트용 더미 환자 데이터
-- 환자 2명: [경과테스트] 이수진 (12회 완료), [경과테스트] 김태호 (21회 진행 중)
-- is_simulation=true + [경과테스트] prefix — CLEANUP 대상과 시각적 구분
-- 각 방문: check_ins(done) + medical_charts + check_in_services + package_sessions
-- rollback: 20260526140000_dummy_progress_test.rollback.sql
-- risk: INSERT only, GO 0/5

DO $$
DECLARE
  v_clinic  uuid;
  v_cid1    uuid;   -- [경과테스트] 이수진
  v_cid2    uuid;   -- [경과테스트] 김태호
  v_pkg1    uuid;
  v_pkg2    uuid;
  v_ci      uuid;   -- loop 체크인 ID

  -- 이수진 방문 날짜 (12회, 약 2주 간격, 2025-12-16 ~ 2026-05-20)
  dates1 date[] := ARRAY[
    '2025-12-16'::date, '2025-12-30'::date, '2026-01-13'::date, '2026-01-27'::date,
    '2026-02-10'::date, '2026-02-24'::date, '2026-03-10'::date, '2026-03-24'::date,
    '2026-04-08'::date, '2026-04-22'::date, '2026-05-06'::date, '2026-05-20'::date
  ];

  -- 김태호 방문 날짜 (21회, 약 10~11일 간격, 2025-08-14 ~ 2026-05-22)
  dates2 date[] := ARRAY[
    '2025-08-14'::date, '2025-08-25'::date, '2025-09-05'::date, '2025-09-18'::date,
    '2025-09-29'::date, '2025-10-10'::date, '2025-10-23'::date, '2025-11-03'::date,
    '2025-11-17'::date, '2025-11-28'::date, '2025-12-09'::date, '2025-12-22'::date,
    '2026-01-05'::date, '2026-01-16'::date, '2026-01-29'::date, '2026-02-10'::date,
    '2026-02-23'::date, '2026-03-09'::date, '2026-03-23'::date, '2026-05-05'::date,
    '2026-05-22'::date
  ];

  i             int;
  v_visit_type  text;
  v_dx          text;
  v_tx          text;
  v_progress    text;
  v_session_type text;
  v_svc_name    text;
  v_price       int;

BEGIN
  SELECT id INTO v_clinic FROM clinics WHERE slug = 'jongno-foot';
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'clinic jongno-foot not found'; END IF;

  -- ─── 기존 [경과테스트] 데이터 idempotent 정리 ──────────────────────────────
  DELETE FROM medical_charts
  WHERE customer_id IN (
    SELECT id FROM customers
    WHERE name LIKE '[경과테스트]%' AND clinic_id = v_clinic AND is_simulation = true
  );
  -- check_ins 삭제 → check_in_services, status_transitions CASCADE
  DELETE FROM check_ins
  WHERE customer_id IN (
    SELECT id FROM customers
    WHERE name LIKE '[경과테스트]%' AND clinic_id = v_clinic AND is_simulation = true
  );
  DELETE FROM payments
  WHERE customer_id IN (
    SELECT id FROM customers
    WHERE name LIKE '[경과테스트]%' AND clinic_id = v_clinic AND is_simulation = true
  );
  -- packages 삭제 → package_sessions CASCADE
  DELETE FROM packages
  WHERE customer_id IN (
    SELECT id FROM customers
    WHERE name LIKE '[경과테스트]%' AND clinic_id = v_clinic AND is_simulation = true
  );
  -- customers 삭제 → customer_treatment_memos CASCADE
  DELETE FROM customers
  WHERE name LIKE '[경과테스트]%' AND clinic_id = v_clinic AND is_simulation = true;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- Patient 1: [경과테스트] 이수진 — 패키지1(12회), 12회 완료
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation, memo)
  VALUES (v_clinic, '[경과테스트] 이수진', '010-9901-0001', 'returning', true,
    '[경과테스트] 진료차트 타임라인 검증 — 패키지1 12회 완료')
  RETURNING id INTO v_cid1;

  INSERT INTO packages (
    clinic_id, customer_id, package_name, package_type,
    total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions,
    total_amount, paid_amount, status, contract_date, memo
  ) VALUES (
    v_clinic, v_cid1, '패키지1 (12회)', 'package1',
    12, 12, 0, 0, 0,
    3600000, 3600000, 'completed', '2025-12-16',
    '[경과테스트] 12회 완료'
  ) RETURNING id INTO v_pkg1;

  FOR i IN 1..12 LOOP
    v_visit_type  := CASE WHEN i = 1 THEN 'new' ELSE 'returning' END;
    v_session_type := 'heated_laser';
    v_svc_name    := '힐러';
    v_price       := 300000;

    v_dx := CASE (i % 3)
      WHEN 1 THEN '양발 조갑비후증 (L60.2)'
      WHEN 2 THEN '양발 조갑비후증 + 소양증 (L60.2)'
      ELSE        '양발 조갑비후증 — 호전 단계'
    END;

    v_tx := '힐러 레이저 ' || i || '회차: ' || CASE (i % 4)
      WHEN 1 THEN '양발 10발가락 전체 시술. 프리컨디셔닝 30분 선처치.'
      WHEN 2 THEN '양발 시술. 우측 무지 집중 추가 조사 1pass.'
      WHEN 3 THEN '양발 시술. 좌우 대칭 진행, 표준 프로토콜.'
      ELSE        '양발 시술. 마무리 진정 처치 포함.'
    END;

    v_progress := CASE i
      WHEN 1  THEN '초진: 양발 발톱 두께 3.5mm 이상, 황갈색 변색. NRS 통증 6/10. 보행 시 불편 호소. 12회 패키지1 치료 계획 수립.'
      WHEN 2  THEN '2회: 발톱 표면 미세 매끄러워짐. NRS 5/10. 큰 변화 아직 없으나 정상 경과.'
      WHEN 3  THEN '3회: 발톱 두께 3.2mm로 감소 시작. 색상 변화 관찰. NRS 5/10.'
      WHEN 4  THEN '4회: 두께 3.0mm. 황갈색 옅어짐. NRS 4/10. 환자 만족도 향상.'
      WHEN 5  THEN '5회: 발톱 두께 2.8mm. 신생 발톱 건강한 색상 확인. NRS 3/10.'
      WHEN 6  THEN '6회 중간평가: 두께 2.5mm, 확연한 호전. NRS 2/10. 치료 계획 유지.'
      WHEN 7  THEN '7회: 발톱 두께 2.2mm. 양발 균일 개선. NRS 2/10.'
      WHEN 8  THEN '8회: 두께 2.0mm. 통증 거의 소실. NRS 1/10. 일상생활 불편 없음.'
      WHEN 9  THEN '9회: 발톱 색상 거의 정상(연핑크). 두께 1.8mm. NRS 0~1/10.'
      WHEN 10 THEN '10회: 두께 1.7mm. 유지치료 단계 진입. 정상 발톱 성장 패턴 확인.'
      WHEN 11 THEN '11회: 발톱 두께 1.5mm, 정상 범위 근접. NRS 0/10. 마무리 단계.'
      WHEN 12 THEN '12회 최종: 발톱 두께 1.4mm, 색상 정상화. 패키지1 완료. 재발 방지를 위해 2~3개월 유지치료 권장.'
      ELSE        ''
    END;

    INSERT INTO check_ins (
      clinic_id, customer_id, customer_name, customer_phone,
      visit_type, status, queue_number,
      checked_in_at, completed_at, package_id, sort_order,
      treatment_memo
    ) VALUES (
      v_clinic, v_cid1, '[경과테스트] 이수진', '010-9901-0001',
      v_visit_type, 'done', 900 + i,
      (dates1[i]::timestamp + interval '10 hours' + (i * interval '5 minutes')),
      (dates1[i]::timestamp + interval '12 hours' + (i * interval '5 minutes')),
      v_pkg1, 0,
      jsonb_build_object('memo', v_tx, 'updated_at', dates1[i]::text)
    ) RETURNING id INTO v_ci;

    INSERT INTO package_sessions (
      package_id, check_in_id, session_number, session_type,
      session_date, unit_price, status, memo
    ) VALUES (
      v_pkg1, v_ci, i, v_session_type,
      dates1[i], v_price, 'used', v_progress
    );

    INSERT INTO check_in_services (
      check_in_id, service_name, price, original_price, is_package_session
    ) VALUES (
      v_ci, v_svc_name, v_price, v_price, true
    );

    -- 프리컨디셔닝: 1~8회차
    IF i <= 8 THEN
      INSERT INTO check_in_services (
        check_in_id, service_name, price, original_price, is_package_session
      ) VALUES (v_ci, '프리컨디셔닝', 0, 0, true);
    END IF;

    INSERT INTO medical_charts (
      customer_id, clinic_id, visit_date,
      chief_complaint, diagnosis, treatment_record, clinical_progress, created_by
    ) VALUES (
      v_cid1, v_clinic::text, dates1[i],
      CASE WHEN i = 1 THEN '양발 발톱 두꺼워짐, 통증, 황갈색 변색 (수개월 지속)' ELSE NULL END,
      v_dx, v_tx, v_progress, 'system_seed'
    );
  END LOOP;

  -- 원장 메모 — 이수진 (중간평가 6회, 최종 12회)
  INSERT INTO chart_doctor_memos (medical_chart_id, customer_id, clinic_id, memo, created_by)
  SELECT mc.id, mc.customer_id, mc.clinic_id, m.memo, 'system_seed'
  FROM medical_charts mc
  JOIN (VALUES
    ('2026-02-24'::date, '[이수진 6회 중간평가] 두께 감소 목표(3.5→2.5mm) 달성. 호전 반응 양호. 후반 6회 계속.'),
    ('2026-05-20'::date, '[이수진 12회 완료] 발톱 정상화. 예후 매우 양호. 필요 시 유지치료 권장.')
  ) AS m(vdate, memo) ON mc.visit_date = m.vdate
  WHERE mc.customer_id = v_cid1;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- Patient 2: [경과테스트] 김태호 — 블레라벨(36회), 21회 진행 중
  -- ═══════════════════════════════════════════════════════════════════════════
  INSERT INTO customers (clinic_id, name, phone, visit_type, is_simulation, memo)
  VALUES (v_clinic, '[경과테스트] 김태호', '010-9901-0002', 'returning', true,
    '[경과테스트] 진료차트 타임라인 검증 — 블레라벨 21/36회 진행 중')
  RETURNING id INTO v_cid2;

  INSERT INTO packages (
    clinic_id, customer_id, package_name, package_type,
    total_sessions, heated_sessions, unheated_sessions, iv_sessions, preconditioning_sessions,
    total_amount, paid_amount, status, contract_date, memo
  ) VALUES (
    v_clinic, v_cid2, '블레라벨 (36회)', 'blelabel',
    36, 12, 12, 12, 0,
    8400000, 8400000, 'active', '2025-08-14',
    '[경과테스트] 21/36회 진행 중'
  ) RETURNING id INTO v_pkg2;

  FOR i IN 1..21 LOOP
    v_visit_type := CASE WHEN i = 1 THEN 'new' ELSE 'returning' END;

    -- 시술 종류 순환 (힐러→오니코→수액 반복)
    CASE (i % 3)
      WHEN 1 THEN
        v_session_type := 'heated_laser'; v_svc_name := '힐러'; v_price := 300000;
      WHEN 2 THEN
        v_session_type := 'unheated_laser'; v_svc_name := '오니코'; v_price := 260000;
      ELSE
        v_session_type := 'iv'; v_svc_name := '발톱재생 수액'; v_price := 110000;
    END CASE;

    v_dx := CASE
      WHEN i <= 7  THEN '양발 발톱백선 + 조갑비후증 복합 (B35.1, L60.2)'
      WHEN i <= 14 THEN '양발 조갑비후증 호전 단계 (L60.2)'
      ELSE              '양발 조갑비후증 유지치료'
    END;

    v_tx := v_svc_name || ' ' || i || '회차: ' || CASE (i % 3)
      WHEN 1 THEN '양발 전체 힐러 레이저 조사. 프리컨디셔닝 포함.'
      WHEN 2 THEN '양발 저출력 오니코 레이저. 발톱 경계부 집중 정밀 시술.'
      ELSE        '발톱재생 수액 정맥주사. 혈행개선 + 발톱 성장 촉진 목적.'
    END;

    v_progress := CASE i
      WHEN 1  THEN '초진: 양발 발톱백선 + 비후 복합. 두께 4.0mm. NRS 7/10. 보행 시 심한 통증. 블레라벨 36회 장기 치료 계획.'
      WHEN 2  THEN '2회: 발톱 이물감 감소 시작. NRS 6/10.'
      WHEN 3  THEN '3회: 수액 병행 효과 관찰. 발톱 혈색 개선 시작. NRS 6/10.'
      WHEN 4  THEN '4회: 두께 3.8mm. 미세 호전. NRS 5/10.'
      WHEN 5  THEN '5회: 발톱 표면 거칠기 감소. NRS 5/10.'
      WHEN 6  THEN '6회: 두께 3.5mm. 색상 개선 진행. NRS 4/10.'
      WHEN 7  THEN '7회 초기단계 마무리: 두께 3.2mm. NRS 4/10. 감염균 반응 양호.'
      WHEN 8  THEN '8회: 본격 개선 단계. 발톱 분리 소실. NRS 3/10.'
      WHEN 9  THEN '9회: 두께 2.8mm. 신생 발톱 건강한 핑크빛. NRS 3/10.'
      WHEN 10 THEN '10회 중간평가: 두께 2.5mm. 발톱백선균 임상적 음성. NRS 2/10. 치료 효과 매우 양호.'
      WHEN 11 THEN '11회: 두께 2.2mm. 양발 균일 개선. NRS 2/10.'
      WHEN 12 THEN '12회: 두께 2.0mm. 통증 소실. NRS 1/10. 유지치료 단계 진입.'
      WHEN 13 THEN '13회: 발톱 색상 정상화 70%. 두께 1.8mm. 환자 일상 복귀.'
      WHEN 14 THEN '14회: NRS 0~1/10. 두께 1.6mm. 운동·보행 완전 정상화.'
      WHEN 15 THEN '15회: 양발 외형 거의 정상. 두께 1.5mm. 유지치료 계속.'
      WHEN 16 THEN '16회: 장기유지 단계 진입. 발톱 완전 정상화. 재발 소견 없음.'
      WHEN 17 THEN '17회: NRS 0/10. 외형·기능 모두 정상. 월 1회 유지 방문 권고.'
      WHEN 18 THEN '18회: 상태 유지 양호. 특이사항 없음. 잔여 패키지 계속 활용.'
      WHEN 19 THEN '19회: 봄 환절기 대비 집중 보강 시술 1회 추가.'
      WHEN 20 THEN '20회 이정표: 전반적 상태 최상. NRS 0/10. 잔여 16회는 유지관리 목적.'
      WHEN 21 THEN '21회 (최근): 발톱 상태 완전 정상 유지. NRS 0/10. 2개월 후 22회 예약.'
      ELSE        ''
    END;

    INSERT INTO check_ins (
      clinic_id, customer_id, customer_name, customer_phone,
      visit_type, status, queue_number,
      checked_in_at, completed_at, package_id, sort_order,
      treatment_memo
    ) VALUES (
      v_clinic, v_cid2, '[경과테스트] 김태호', '010-9901-0002',
      v_visit_type, 'done', 920 + i,
      (dates2[i]::timestamp + interval '10 hours' + (i * interval '7 minutes')),
      (dates2[i]::timestamp + interval '12 hours' + (i * interval '7 minutes')),
      v_pkg2, 0,
      jsonb_build_object('memo', v_tx, 'updated_at', dates2[i]::text)
    ) RETURNING id INTO v_ci;

    INSERT INTO package_sessions (
      package_id, check_in_id, session_number, session_type,
      session_date, unit_price, status, memo
    ) VALUES (
      v_pkg2, v_ci, i, v_session_type,
      dates2[i], v_price, 'used', v_progress
    );

    INSERT INTO check_in_services (
      check_in_id, service_name, price, original_price, is_package_session
    ) VALUES (
      v_ci, v_svc_name, v_price, v_price, true
    );

    -- 프리컨디셔닝: 홀수회차에 추가 (힐러 시술 전 선처치)
    IF (i % 3) = 1 THEN
      INSERT INTO check_in_services (
        check_in_id, service_name, price, original_price, is_package_session
      ) VALUES (v_ci, '프리컨디셔닝', 0, 0, true);
    END IF;

    INSERT INTO medical_charts (
      customer_id, clinic_id, visit_date,
      chief_complaint, diagnosis, treatment_record, clinical_progress, created_by
    ) VALUES (
      v_cid2, v_clinic::text, dates2[i],
      CASE WHEN i = 1 THEN '양발 발톱 변색·비후·통증 (6개월 이상 지속), 보행 불편' ELSE NULL END,
      v_dx, v_tx, v_progress, 'system_seed'
    );
  END LOOP;

  -- 원장 메모 — 김태호 (중간평가 10회, 20회 이정표)
  INSERT INTO chart_doctor_memos (medical_chart_id, customer_id, clinic_id, memo, created_by)
  SELECT mc.id, mc.customer_id, mc.clinic_id, m.memo, 'system_seed'
  FROM medical_charts mc
  JOIN (VALUES
    ('2025-11-28'::date, '[김태호 10회 중간평가] 발톱백선 임상 음성. 두께 2.5mm → 정상화 순조. 탁월한 치료 반응.'),
    ('2025-12-22'::date, '[김태호 12회] 통증 소실, 유지치료 단계 전환. 블레라벨 후반부 유지에 최적 활용 권고.'),
    ('2026-05-05'::date, '[김태호 20회 이정표] 완전 정상화. 잔여 16회 유지관리 목적으로 탄력적 소진 예정.')
  ) AS m(vdate, memo) ON mc.visit_date = m.vdate
  WHERE mc.customer_id = v_cid2;

  RAISE NOTICE '✅ [경과테스트] 더미 환자 2명 생성 완료 — 이수진 12회 (패키지1 완료), 김태호 21회 (블레라벨 진행 중)';
END $$;
