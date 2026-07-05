\set clinic '11111111-1111-1111-1111-111111111111'
\set ther '22222222-2222-2222-2222-222222222222'
\set cust '33333333-3333-3333-3333-333333333333'
\set pkgA '44444444-4444-4444-4444-444444444444'
\set pkgB '55555555-5555-5555-5555-555555555555'
INSERT INTO staff VALUES (:'ther','김치료',:'clinic','therapist',true);
INSERT INTO customers VALUES (:'cust',:'clinic',:'ther');
INSERT INTO packages VALUES (:'pkgA',:'cust',:'clinic','2026-07-02');
INSERT INTO package_sessions (package_id,performed_by,session_date,status,session_type,unit_price,surcharge)
 VALUES (:'pkgA',:'ther','2026-07-02','used','iv',50000,0),
        (:'pkgA',:'ther','2026-07-02','used','heated_laser',30000,0);
INSERT INTO packages VALUES (:'pkgB',:'cust',:'clinic','2026-07-05');
INSERT INTO check_ins VALUES ('66666666-6666-6666-6666-666666666666',:'ther',:'cust','experience',:'pkgA','2026-07-02 04:00:00+00',:'clinic','done');
INSERT INTO check_ins VALUES ('77777777-7777-7777-7777-777777777777',:'ther',:'cust','experience',:'pkgB','2026-07-02 04:00:00+00',:'clinic','done');
INSERT INTO package_payments (package_id,payment_type) VALUES (:'pkgA','payment'),(:'pkgB','payment');
\echo '--- AC1 by_category: iv MUST be absent, heated_laser present ---'
SELECT category, sessions, amount FROM foot_stats_by_category(:'clinic','2026-07-01','2026-07-31');
\echo '--- AC3 therapist_summary: exp_total=2, converted=1 (sameday pkgA only), rate=50.0 ---'
SELECT name, experience_total, experience_converted, conversion_rate FROM foot_stats_therapist_summary(:'clinic','2026-07-01','2026-07-31');
