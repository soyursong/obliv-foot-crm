# DB-GATE 요청 — T-20260701-foot-DUMMY-DATE-UPDATE

- **요청자**: 김주연 총괄 (풋센터) / planner approved (P2, risk=GO_WARN)
- **작업**: prod `reservations.reservation_date` UPDATE — 경과분석 더미 4건 `2026-06-30 → 2026-07-01`
- **DB**: rxlomoozakkjesdqjtvd (foot prod)
- **변경 grain**: row UPDATE (스키마 변경 없음 / DDL 없음 / 신규 컬럼·enum 없음 → 데이터정책 CONSULT 비대상)

## 1. SELECT-first 결과 (실환자 미포함 확인)
6/30 `progress_check_required=true` 예약 = **4건, 전부 더미**. 실환자 0건.

| rid | 이름 | 시간 | 회차 | is_simulation | memo |
|-----|------|------|------|---------------|------|
| 89dd247d… | 테스트경과01 | 14:00 | 6회 | true | [TEST-DUMMY PROGRESSPUB 20260701] |
| 8d9ee9ad… | 테스트경과02 | 14:30 | 12회 | true | [TEST-DUMMY PROGRESSPUB 20260701] |
| d063cba1… | 테스트경과03 | 15:00 | 18회 | true | [TEST-DUMMY PROGRESSPUB 20260701] |
| 78f64a7c… | 테스트경과분석 | 15:30 | 24회 | true | [TEST-DUMMY 경과분석발행 20260701] |

식별 근거: customers.is_simulation=true AND memo '[TEST-DUMMY...]' AND 이름 '테스트경과…'.

## 2. WHERE 절 (전체 일괄 변경 차단)
`id IN (4건 명시) AND reservation_date='2026-06-30' AND progress_check_required=true`
→ 6/30 progress 4건만. 인접 실데이터·다른 날짜 무변경.

## 3. 영향 화면
경과분석 탭(ProgressTargetsSection)은 `reservations` where `reservation_date=오늘(7/1)`, `progress_check_required=true` 를 read-only 소비.
→ 더미 4건이 날짜선택기 기본(오늘 7/1)에서 보이게 됨. 실데이터 6/30 무변경.

## 4. 롤백
`rollback/T-20260701-foot-DUMMY-DATE-UPDATE_rollback.sql` (7/1→6/30 원복, 동일 가드).

## 5. 실행 방식
`scripts/T-20260701-foot-DUMMY-DATE-UPDATE_apply.mjs` (dev-foot 직접 실행, service_role).
- DRY-RUN 통과(4건 가드 일치). `--apply` 로 실행 예정.
- 코드 변경 없음 / 빌드 영향 없음 / FE 배포 없음.

## 판정
- [ ] GO  / [ ] NO-GO  — supervisor
