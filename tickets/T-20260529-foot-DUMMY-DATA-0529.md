---
id: T-20260529-foot-DUMMY-DATA-0529
domain: foot
priority: P1
status: deploy-ready
deploy_ready_at: 2026-05-29 10:30
commit_sha: TBD
db_changed: true
e2e_spec: exempt(db_only)
hotfix: false
created: 2026-05-29 07:19
deadline: 2026-05-29
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1780005866.221069"
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
e2e_spec_exempt_reason: db_only
risk_verdict: GO_WARN
insert_script: scripts/seed_testdata_20260529.mjs
rollback_script_js: scripts/rollback_testdata_20260529.mjs
rollback_script_sql: scripts/rollback_dummy_20260529.sql
---

# T-20260529-foot-DUMMY-DATA-0529 — 5/29 초진·재진 시간대별 더미 예약 80건

## 구현 요약

- **customers**: 80건 INSERT (초진 동물이름 40 + 재진 과일이름 40), `is_simulation=true`
- **reservations**: 80건 INSERT (2026-05-29, 10:00~19:00 슬롯당 4초진+4재진)
- **check_ins**: 40건 INSERT (재진 판별용 과거 체크인, 2026-05-01)
- 전화번호: `+821000002901~+821000002980` (비중복 테스트 범위)
- INSERT 스크립트: `scripts/seed_testdata_20260529.mjs`
- 롤백 스크립트(JS): `scripts/rollback_testdata_20260529.mjs`
- 롤백 스크립트(SQL): `scripts/rollback_dummy_20260529.sql` ← **supervisor QA 요청 반영 (FIX-REQUEST)**

## DB 검증 결과

```
customers:       80건 ✅
reservations:    80건 (2026-05-29) ✅
check_ins:       40건 (재진 판별용) ✅
슬롯별: 10:00~19:00 각 {new:4, returning:4} ✅
```

## AC 체크

- [x] AC-1: customers 80건 (초진 40 동물이름 + 재진 40 과일이름, is_simulation=true)
- [x] AC-2: reservations 80건 (5/29, 슬롯당 초진4+재진4)
- [x] AC-3: FK 정합성 + E.164 전화번호 + 재진 check_ins 생성
- [x] AC-4: 화면 확인용 데이터 로드 완료 (통합시간표·예약관리·셀프접수)
- [x] AC-5: 롤백 스크립트 구현
  - JS: `scripts/rollback_testdata_20260529.mjs`
  - SQL: `scripts/rollback_dummy_20260529.sql` ← 신규 추가 (FIX-REQUEST 대응)
- [x] AC-6: `npm run build` ✅ (3.28s, 에러 0)

## 빌드

```
npm run build: ✓ built in 3.28s (에러 0)
```

## 변경 이력
- 2026-05-29 07:19: 신규 생성
- 2026-05-29 08:40: deploy-ready 마킹 (DB 검증 완료, 빌드 ✅)
- 2026-05-29 10:30: FIX-REQUEST(supervisor) 대응 — SQL 롤백 스크립트 추가
  - 신규: `scripts/rollback_dummy_20260529.sql`
  - 티켓 frontmatter: `insert_script` / `rollback_script_js` / `rollback_script_sql` 3필드 명시
  - deploy-ready 재갱신
