# CENSUS REPORT — T-20260820-foot-STAFF-USERID-LINK-COMPLETENESS-CENSUS

- **type**: feasibility_inquiry (조사 전용)
- **db_change**: FALSE — SELECT introspection only, WRITE 0 / DDL 0
- **scope**: jongno-foot (clinic_id `74967aea-a60b-4da3-a0e7-9c997a930bc8`) active staff (`active=true AND deleted_at IS NULL`) 中 `user_id IS NULL` 전수
- **date**: 2026-08-20
- **runner**: `dryrun_lib.mjs q()` (Supabase Management API, read-only)
- **scripts**: `_census.mjs` / `_match.mjs` / `_auth.mjs` / `_schema.mjs` (동일 디렉터리)

## 전수 집계 (jongno-foot active staff, role별 linked vs null)

| role | total_active | user_id_null | user_id_set |
|------|---|---|---|
| consultant | 9 | **0** | 9 |
| coordinator | 7 | 2 | 5 |
| director | 5 | 4 | 1 |
| manager | 1 | 0 | 1 |
| technician | 5 | 5 | 0 |
| therapist | 15 | 5 | 10 |
| **null 소계** | | **16** | |

- 선행 T-…-OPINIONDOC-…-CHOI(최현희 consultant fix) 반영 → **consultant null 0건 확인**.
- planner hint(coordinator 2 / director 4 / therapist 5 / technician 5 = 16) 실측 일치.

---

## 분류 결과

### (A) 진성 미링크 — auth 계정 실존·미연결·backfill 후보 【총괄 confirm 대상】 = 1건

| staff_id | name | role | auth_uid | email | 계정 상태 |
|---|---|---|---|---|---|
| `4e89256e-7cc6-4200-9572-396df4e6564c` | 김수민 | therapist | `b6642918-98d8-4cd6-9099-f5d978442984` | mauntindevv@gmail.com | active·approved·email확인·**last_sign_in 2026-08-17**. 계정 존재+본인 로그인 이력 있으나 staff.user_id 미연결 → **로그인/기능차단 유발 가능**. 해당 uid 는 어떤 staff 행에도 미연결(uid_already_linked_count=0). |

- **backfill 안(총괄 게이트 통과 후에만)**: `UPDATE staff SET user_id='b6642918-98d8-4cd6-9099-f5d978442984' WHERE id='4e89256e-7cc6-4200-9572-396df4e6564c' AND user_id IS NULL;` — 단일행·idempotent(WHERE user_id IS NULL)·rollback=해당 행 user_id→NULL.

### (A-모호) 이름매칭 계정 존재하나 비활성·이미 타 staff 연결 【총괄 disambiguation 필요·auto-backfill 금지】 = 1건

| staff_id | name | role | 매칭 후보 | 모호 사유 |
|---|---|---|---|---|
| `7d5261d7-4008-426b-a836-5d476ca8b4a1` | 김규리 | therapist | ①`63c387c0…`(angelgrgr12@gmail.com, therapist) ②`2ec0b57a…`(rwdqda@naver.com, admin) | 두 계정 모두 up_active=false 이고 **각각 비활성 staff 행에 이미 연결**(①→`3a0c6774`(therapist,inactive) ②→`d26717cb`(admin,inactive)). 신규 active 행 `7d5261d7`이 어느 계정 승계인지(또는 중복행 병합인지) 사람 판단 필요. 임의 backfill 시 오연결 위험 → **보류**. |

### (B) 무계정 — 링크 불필요/불가 【절대 손대지 말 것】 = 14건

**(B1) 장비·의사(疑似)스태프 = 로그인 불요 pseudo-staff (6건)**

| staff_id | name | role |
|---|---|---|
| `a9602b7a-442b-4a19-aa31-fa4b261690cf` | AF | technician |
| `8c36752d-f4e9-4f84-af26-41bc52f2ebca` | 아톰 | technician |
| `3cd0d008-eda2-4565-9b44-4a8419e50555` | 오니코 | technician |
| `189e00b8-092f-4137-9354-514c3a290f9e` | 패디스캔 | technician |
| `e91a164f-4c16-4294-973e-8084cd012acc` | 피검사 | technician |
| `b7229f47-c509-4d7c-aa6a-d9744c663f79` | 데스크 | coordinator |

→ 사람이 아닌 장비/시술스테이션/공용 접수 슬롯 명칭(시술 배정용). 로그인 불요·계정 없음 → **정상 무계정. 손대지 말 것.**

**(B2) 실인물이나 auth 계정 미존재 = backfill 대상 아님 (계정-생성은 별건·census scope 밖) = 8건**

| staff_id | name | role |
|---|---|---|
| `5ab928b4-4317-42e2-b3a0-0f64e30df0de` | 정세훈 | coordinator |
| `a7f17564-241e-464d-8731-3a837ad2a6bf` | 김윤기 | director |
| `9521c1e0-3ecf-45d8-a575-0dd9bb713564` | 박현수 | director |
| `cda4b06c-50fd-4e5d-be7a-d65ce7bc9aef` | 유완준 | director |
| `47d2e8fa-4fed-4371-8a80-0b6cc79f5426` | 윤주현 | director |
| `3beb6951-79ae-4f23-934c-a056aa8b776e` | 김연주 | therapist |
| `ba2e6761-b42e-4414-9fd2-7b092224bbc3` | 김호경 | therapist |
| `23f35c48-de8e-434e-a7eb-8980bbd2c6be` | 윤지수 | therapist |

→ 이름과 일치하는 auth 계정이 **없음** → 연결할 대상 부재 = **backfill(user_id 연결) 대상 아님**. '로그인해서 써야 하는 직원인지'는 계정-**생성** 판단(별건)이며, 필요 시 총괄 확인 후 계정 발급→링크 순. 본 census 의 backfill scope 밖.

---

## 게이트 요약

- census = 조사만(db_change=false). backfill 미실행.
- backfill 착수 가능 대상 = **(A) 김수민 1건뿐** (총괄 게이트 통과 시).
- (A-모호) 김규리 = 총괄 disambiguation 선행 필요.
- (B1)/(B2) 14건 = 정정 불요·미착수.
