# T-20260708-foot-QUICKRESV-TESTDATA-BUG — DB 정리 evidence

테스트 환자 '접수테스트'(및 유사) 안전 삭제. 파괴적 DML — 하드가드 3종 순서 준수.
연락처는 마스킹. 원본 덤프는 off-git(rollback/, gitignore).

## Guard 1 — SELECT-FREEZE (완료)
- 정확 `name='접수테스트'` = **0행**. 요청서 이름과 실제 등록명 불일치.
- 스코프 정합 대상 `name ILIKE '접수테스트%'` = **1행**:
  - `접수테스트2` / id=`41c2852c-d647-474c-8777-bc17111ff7d1` / phone=(끝자리 …47) / 차트 F-4510 / 생성 2026-07-08 / is_sim=false / clinic=74967aea(종로 풋)
- `%테스트%` 광범위 스캔 15행 중 나머지 14행 = **타 티켓 소유 테스트데이터**(풋테스트1~5/tm, 테스트경과 PROGRESSPUB 더미, 풋서류테스트, c2-sync-test) → **스코프 제외, 미삭제**.
- 실 내원고객 오매칭: 없음(이름/전화/생성일/차트번호 눈검증). 추정 삭제 없음.

## 삭제 대상 의존성 트리 (실존 행)
customers ← reservations ← check_ins ← 손자행. 실제 존재행만.

| 테이블 | id | 관계 | ON DELETE | 처리 |
|---|---|---|---|---|
| customers | 41c2852c | 부모 | — | 마지막 삭제 |
| reservations | fd13ce8b (7/8 11:30, checked_in) | customer_id RESTRICT | — | 2번째 |
| check_ins | 0e2dba57 (status=receiving) | customer_id·reservation_id RESTRICT | — | **1번째** |
| reservation_logs | 1행 | reservation_id | CASCADE | 자동 |
| health_q_tokens | 1행 | customer_id | CASCADE | 자동 |

- RESTRICT 블로커(service_charges/payments/packages/consent_forms/prescriptions/checklists/package_sessions) 전수 조사 = **전부 0**.
- 삭제 footprint 총 **5행**.
- 삭제 순서: `check_ins → reservations → customers` (자식 RESTRICT 선삭제, CASCADE 자동).

## Guard 2 — ARCHIVE-FIRST (완료)
- off-git 백업: `rollback/T-20260708-foot-QUICKRESV-TESTDATA-BUG_archive_20260708.json` (5행 full-row)
- rollback SQL: `rollback/T-20260708-foot-QUICKRESV-TESTDATA-BUG_rollback_20260708.sql` (5 INSERT, FK순)
- rollback 1줄: 삭제 후 이슈 시 위 SQL을 service_role 로 실행하면 customers→reservations→check_ins→reservation_logs→health_q_tokens 원복.

## Guard 3 — REPORTER 확인 (대기중)
- responder 경유 김주연 총괄에 삭제건수(1 고객/5행)+명단 제시: MSG-20260708-123638-uhvr
- 확인 포인트: (1) 실제명 '접수테스트2'가 대상 맞는지 (2) 타 테스트명 14건 미대상 통지
- **'진행' 확인 전까지 DELETE 미실행.**

## Guard 3 이후 (예정)
- DELETE 실행 → 0건 재조회(customers/reservations/check_ins) + orphan 잔존 0 검증.
- 도파민/CRM sync 전파 여부 확인.
- signals.md 기록 + planner 결과 보고.
