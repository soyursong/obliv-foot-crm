---
id: T-20260527-foot-RESV-TESTDATA-REGEN
domain: foot
priority: P1
status: complete
deploy-ready: false
db_changed: true
fe_changed: false
commit: 3837375
created: 2026-05-27
completed: 2026-05-27
---

# T-20260527-foot-RESV-TESTDATA-REGEN — 5/27 테스트 예약 데이터 동물 이름 재생성

## 요약

김주연 총괄 요청: 5/27 테스트 예약 데이터 시간대별 동물 이름 중복 문제 해결.
기존: 8마리 × 8슬롯 반복 → 슬롯별 고유 64마리로 재생성.

## 수용 기준 체크

- [x] AC-1: 5/27 기존 테스트 예약 전량 DELETE (reservations 64건, customers 8명, check_ins 4건)
- [x] AC-2: 8슬롯(11:00~18:00) × (초진4+재진4) = 64건 재생성
- [x] AC-3: 슬롯별 고유 동물 이름 배정
  - 11:00: 강아지·고양이·토끼·판다 / 사자·호랑이·코끼리·기린
  - 12:00: 햄스터·앵무새·거북이·고슴도치 / 여우·늑대·곰·원숭이
  - 13:00: 다람쥐·공작새·독수리·학 / 펭귄·북극곰·캥거루·코알라
  - 14:00: 오리·참새·까치·비둘기 / 치타·표범·하이에나·재규어
  - 15:00: 돌고래·고래·상어·바다사자 / 악어·이구아나·도마뱀·카멜레온
  - 16:00: 낙타·얼룩말·하마·코뿔소 / 두루미·황새·왜가리·해오라기
  - 17:00: 수달·밍크·오소리·족제비 / 사슴·노루·고라니·염소
  - 18:00: 문어·오징어·낙지·꽃게 / 개구리·두꺼비·도롱뇽·뱀
- [x] AC-4: 초진(new) / 재진(returning) 구분 정확
- [x] AC-5: 실환자 데이터 영향 없음 (is_simulation=true 필터)

## DB 변경

| 테이블 | 변경 |
|--------|------|
| customers | +64명 (is_simulation=true) |
| reservations | +64건 (2026-05-27, 11:00~18:00) |
| check_ins | +32건 (재진 판별용 과거체크인, 2026-05-01) |

## 스크립트

- `scripts/seed_testdata_20260527.mjs` — 재생성 v2
- `scripts/rollback_testdata_20260527.mjs` — 롤백 (64마리 전체 처리)

## 비고

DB-only 작업, FE 변경 없음. deploy-ready=false (코드 배포 불필요).
