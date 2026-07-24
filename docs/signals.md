# obliv-foot-crm signals

| 시각 | from | type | 내용 |
|------|------|------|------|
| 2026-07-21 21:21 | dev-foot | diagnosis | T-20260721-foot-SOLAPI-DAILY-SMS-QUOTA-EXCEEDED 1단계 read-only 진단. 문자 전면발송불가(sent=0). 실질주원인=잔액소진(98/148=66퍼) + 일일한도초과(50=34퍼). 2계정 잔액 16.47/7.47원(1건 45원). 계정=지점별전용 2개, 타CRM 비공유. Q3=솔라피 계정레벨(CRM 내부cap 없음). Q1 한도수치는 콘솔확인 필요(API미노출). 충전/한도상향=사람게이트 미실행 → planner FOLLOWUP P1(MSG-20260721-212155-p99j). diag: chore/T-20260721-foot-SOLAPI-QUOTA-DIAG |
| 2026-07-22 00:40 | dev-foot | source-close-ready | T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL: DA hdm3(MSG-20260721-234913) §3 처리. AC-2 소스닫힘=3 write-site 전부 커버하도록 storage-boundary NFC write-guard 트리거 추가(trg_name_nfc_writeguard: customers.name/reservations.customer_name+real_name/check_ins.customer_name, BEFORE INS/UPD, 멱등·무손실·ADDITIVE). 기존 EF-ingest 가드=도파민 경계만 닫아 check_ins 직접 write-site 미가드였음. build OK. mig=20260721150000(가드). ⚠순서(hdm3§3): supervisor DB-gate로 (1)가드 apply·live→(2)forensics 신규NFD=0→(3)백필140000 apply. dev-foot PROD 직접apply 안함. §8 bronze re-ingest DoD→planner FOLLOWUP. 백필SQL ⛔GATE_HOLD 유지. |
| 2026-07-24 13:05 | dev-foot | deploy-ready | T-20260724-foot-DOCPRINT-DIAGCODE-OVERFLOW-2PAGE: 진료비 세부산정내역 상병 4행 세로→2열 컴팩트 그리드(가로폭 활용, 세로높이 절반) + 셀 폰트/패딩 압축 → 상병 다건에도 1페이지 유지. 데이터/토큰 무접점(diag_code_N 불변, AC-4). render실측 OLD644→NEW600/661px. spec 9종+인접회귀 PASS. 빌드 OK. DB변경: 없음. commit 06e065bbed4a |
