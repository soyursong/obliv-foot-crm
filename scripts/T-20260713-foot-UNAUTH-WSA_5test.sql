\set ON_ERROR_STOP off
-- seed clinic
DO $$ DECLARE c uuid; BEGIN
  DELETE FROM status_transitions; DELETE FROM check_ins; DELETE FROM reservations; DELETE FROM customers; DELETE FROM clinics;
  INSERT INTO clinics(id,name) VALUES ('11111111-1111-1111-1111-111111111111','stub') ON CONFLICT DO NOTHING;
END $$;
DROP TABLE IF EXISTS _results; CREATE TABLE _results(test text, ok boolean, detail text);

-- ═══ TEST ① reservation-linked normal → raw 연결·신규 customers 0·denorm raw ═══
DO $$
DECLARE cl uuid:='11111111-1111-1111-1111-111111111111'; today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
  raw uuid; resv uuid; res jsonb; nbefore int; nafter int; ci record;
BEGIN
  INSERT INTO customers(clinic_id,name,phone) VALUES(cl,'최종테스트','+821099565453') RETURNING id INTO raw;
  INSERT INTO reservations(clinic_id,customer_id,reservation_date,status) VALUES(cl,raw,today,'confirmed') RETURNING id INTO resv;
  SELECT count(*) INTO nbefore FROM customers WHERE clinic_id=cl;
  res := self_checkin_with_reservation_link(cl, jsonb_build_object('name','최***트','phone','5453','reservation_id',resv,'visit_type','returning'), today);
  SELECT count(*) INTO nafter FROM customers WHERE clinic_id=cl;
  SELECT * INTO ci FROM check_ins WHERE reservation_id=resv;
  IF (res->>'success')<>'true' THEN RAISE EXCEPTION 'success not true: %',res; END IF;
  IF (res->>'customer_id')<>raw::text THEN RAISE EXCEPTION 'customer_id not raw: %',res; END IF;
  IF (res->>'reservation_linked')<>'true' THEN RAISE EXCEPTION 'not linked: %',res; END IF;
  IF nafter<>nbefore THEN RAISE EXCEPTION 'new customers created: %->%',nbefore,nafter; END IF;
  IF ci.customer_name<>'최종테스트' THEN RAISE EXCEPTION 'denorm not raw: %',ci.customer_name; END IF;
  IF ci.customer_name LIKE '%*%' THEN RAISE EXCEPTION 'masked stored: %',ci.customer_name; END IF;
  IF (SELECT status FROM reservations WHERE id=resv)<>'checked_in' THEN RAISE EXCEPTION 'resv not checked_in'; END IF;
  INSERT INTO _results VALUES('①reservation-linked→raw연결·신규0·denorm raw',true,'customer_id=raw, linked, new=0, denorm=최종테스트, resv=checked_in');
EXCEPTION WHEN OTHERS THEN INSERT INTO _results VALUES('①reservation-linked',false,SQLERRM); END $$;

-- ═══ TEST ② 마스킹 payload(키 없음) → 신규 masked 0·guard 발화·denorm NULL·환자 미차단 ═══
DO $$
DECLARE cl uuid:='11111111-1111-1111-1111-111111111111'; today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
  res jsonb; nbefore int; nafter int; ci record;
BEGIN
  DELETE FROM status_transitions; DELETE FROM check_ins WHERE clinic_id=cl;
  SELECT count(*) INTO nbefore FROM customers WHERE clinic_id=cl;
  res := self_checkin_with_reservation_link(cl, jsonb_build_object('name','최***트','phone','5453','visit_type','new'), today);
  SELECT count(*) INTO nafter FROM customers WHERE clinic_id=cl;
  IF (res->>'success')<>'true' THEN RAISE EXCEPTION '환자 차단됨(success≠true): %',res; END IF;   -- (c) hard-block 금지
  IF (res->>'unlinked_masking_hold')<>'true' THEN RAISE EXCEPTION 'guard 미발화: %',res; END IF;
  IF (res->>'customer_id') IS NOT NULL THEN RAISE EXCEPTION 'customer_id 연결됨(마스킹): %',res; END IF;
  IF nafter<>nbefore THEN RAISE EXCEPTION '마스킹 신규 customers 생성: %->%',nbefore,nafter; END IF;
  SELECT * INTO ci FROM check_ins WHERE clinic_id=cl ORDER BY created_at DESC LIMIT 1;
  IF ci.customer_name LIKE '%*%' OR ci.customer_phone LIKE '%5453%' THEN RAISE EXCEPTION '마스킹값 denorm 저장: %/%',ci.customer_name,ci.customer_phone; END IF;
  INSERT INTO _results VALUES('②마스킹 payload→masked신규0·guard발화·denorm안전·미차단',true,format('success, hold=true, new=0, denorm_name=%L phone=%L',ci.customer_name,ci.customer_phone));
EXCEPTION WHEN OTHERS THEN INSERT INTO _results VALUES('②마스킹 payload',false,SQLERRM); END $$;

-- ═══ TEST ③ 진짜 신규 워크인(raw·비마스킹) → 정상 INSERT 보존(회귀0) ═══
DO $$
DECLARE cl uuid:='11111111-1111-1111-1111-111111111111'; today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
  res jsonb; nbefore int; nafter int; ci record; newc record;
BEGIN
  DELETE FROM status_transitions; DELETE FROM check_ins WHERE clinic_id=cl;
  SELECT count(*) INTO nbefore FROM customers WHERE clinic_id=cl;
  res := self_checkin_with_reservation_link(cl, jsonb_build_object('name','김워크인','phone','01012349999','visit_type','new'), today);
  SELECT count(*) INTO nafter FROM customers WHERE clinic_id=cl;
  IF (res->>'success')<>'true' THEN RAISE EXCEPTION 'success≠true: %',res; END IF;
  IF nafter<>nbefore+1 THEN RAISE EXCEPTION '신규 워크인 INSERT 안됨(회귀): %->%',nbefore,nafter; END IF;
  SELECT * INTO newc FROM customers WHERE clinic_id=cl AND name='김워크인';
  IF newc.id IS NULL THEN RAISE EXCEPTION '신규 customer 없음'; END IF;
  SELECT * INTO ci FROM check_ins WHERE clinic_id=cl ORDER BY created_at DESC LIMIT 1;
  IF ci.customer_id<>newc.id THEN RAISE EXCEPTION 'check_in customer_id 불일치'; END IF;
  IF ci.customer_name<>'김워크인' THEN RAISE EXCEPTION 'denorm raw 아님: %',ci.customer_name; END IF;
  INSERT INTO _results VALUES('③진짜 워크인→정상 INSERT 보존(회귀0)',true,format('new +1, customer=김워크인, ci linked'));
EXCEPTION WHEN OTHERS THEN INSERT INTO _results VALUES('③진짜 워크인',false,SQLERRM); END $$;

-- ═══ TEST ④ 동일 예약 재체크인 → 멱등(already_checked_in) ═══
DO $$
DECLARE cl uuid:='11111111-1111-1111-1111-111111111111'; today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
  raw uuid; resv uuid; r1 jsonb; r2 jsonb; cnt int;
BEGIN
  DELETE FROM status_transitions; DELETE FROM check_ins WHERE clinic_id=cl; DELETE FROM reservations WHERE clinic_id=cl;
  INSERT INTO customers(clinic_id,name,phone) VALUES(cl,'재체크인','+821055559999') RETURNING id INTO raw;
  INSERT INTO reservations(clinic_id,customer_id,reservation_date,status) VALUES(cl,raw,today,'confirmed') RETURNING id INTO resv;
  r1 := self_checkin_with_reservation_link(cl, jsonb_build_object('name','최***트','phone','5453','reservation_id',resv,'visit_type','returning'), today);
  r2 := self_checkin_with_reservation_link(cl, jsonb_build_object('name','최***트','phone','5453','reservation_id',resv,'visit_type','returning'), today);
  SELECT count(*) INTO cnt FROM check_ins WHERE reservation_id=resv AND status<>'cancelled';
  IF (r2->>'already_checked_in')<>'true' THEN RAISE EXCEPTION '멱등 아님: %',r2; END IF;
  IF (r2->>'check_in_id')<>(r1->>'check_in_id') THEN RAISE EXCEPTION 'check_in_id 불일치: % vs %',r1->>'check_in_id',r2->>'check_in_id'; END IF;
  IF cnt<>1 THEN RAISE EXCEPTION '중복 체크인 생성: cnt=%',cnt; END IF;
  INSERT INTO _results VALUES('④동일 예약 재체크인→멱등',true,format('already_checked_in, same check_in_id, cnt=1'));
EXCEPTION WHEN OTHERS THEN INSERT INTO _results VALUES('④재체크인 멱등',false,SQLERRM); END $$;

-- ═══ TEST ⑤ 성함+연락처 ≥2 중복 → 미연결 보류(신규0·자동연결0·미차단) ═══
DO $$
DECLARE cl uuid:='11111111-1111-1111-1111-111111111111'; today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
  res jsonb; nbefore int; nafter int; ci record;
BEGIN
  DELETE FROM status_transitions; DELETE FROM check_ins WHERE clinic_id=cl; DELETE FROM reservations WHERE clinic_id=cl; DELETE FROM customers WHERE clinic_id=cl;
  INSERT INTO customers(clinic_id,name,phone) VALUES(cl,'중복자','010-1111-2222');
  INSERT INTO customers(clinic_id,name,phone) VALUES(cl,'중복자','+821011112222');
  SELECT count(*) INTO nbefore FROM customers WHERE clinic_id=cl;
  res := self_checkin_with_reservation_link(cl, jsonb_build_object('name','중복자','phone','01011112222','visit_type','new'), today);
  SELECT count(*) INTO nafter FROM customers WHERE clinic_id=cl;
  IF (res->>'success')<>'true' THEN RAISE EXCEPTION 'success≠true(차단): %',res; END IF;
  IF (res->>'customer_id') IS NOT NULL THEN RAISE EXCEPTION '≥2인데 자동연결됨: %',res; END IF;
  IF nafter<>nbefore THEN RAISE EXCEPTION '보류인데 신규 생성: %->%',nbefore,nafter; END IF;
  SELECT * INTO ci FROM check_ins WHERE clinic_id=cl ORDER BY created_at DESC LIMIT 1;
  IF ci.customer_name<>'중복자' THEN RAISE EXCEPTION 'denorm raw 보존 안됨: %',ci.customer_name; END IF;
  INSERT INTO _results VALUES('⑤성함+연락처 ≥2 중복→미연결 보류 보존',true,'customer_id null, new=0, 미차단, denorm=중복자');
EXCEPTION WHEN OTHERS THEN INSERT INTO _results VALUES('⑤≥2 중복 보류',false,SQLERRM); END $$;

\echo '════════════════ WS-A 행위 회귀 5테스트 결과 ════════════════'
SELECT CASE WHEN ok THEN '✅ PASS' ELSE '❌ FAIL' END AS 결과, test, detail FROM _results ORDER BY test;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail, count(*) AS total FROM _results;
