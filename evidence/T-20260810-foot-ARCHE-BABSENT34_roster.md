# T-20260810-foot-ARCHE-BABSENT34-VOID-CONFIRMGATE — B-absent 34 roster (READ-ONLY)

- **mode**: READ-ONLY · pure SELECT (write/DDL/void **0** · 34행 무접촉)
- **probe**: `scripts/T-20260810-foot-ARCHE-BABSENT34-VOID-CONFIRMGATE_roster_probe.mjs` (SELECT only)
- **predicate**: `is_package_session=true ∩ package_session_id IS NULL ∩ NOT EXISTS matching package_session` (부모 absent_probe verbatim 계승)
- **DB**: obliv-foot-crm / rxlomoozakkjesdqjtvd
- **count**: **34행 / 16 고객** — 테스트·더미 명백 **6행** · 판단보류(실데이터 가능) **28행**
- **⚠ created_by**: 전 34행 `check_ins.created_by = NULL` → **created_by 기반 confirm 주체 자동확정 불가**. planner는 고객명 패턴/활동이력 기반으로 confirm 주체 판정 요망.
- **⚠ is_simulation**: 전 16 고객 `is_simulation=false` (sim 플래그로는 테스트 식별 불가 → 이름 패턴/활동이력이 유일 단서, 자동 확정 금지)

## per-row roster (34)

| # | cis_pk | 고객명 | customer_id | created_by | visit_date | session_type | sim | void | 제안분류 | 근거 |
|---|--------|--------|-------------|-----------|-----------|--------------|-----|------|---------|------|
| 1 | `745ddfeb-1814-4c3f-bf33-4f736aac0212` | 엄경은2 | `02594dfa…` | NULL | 2026-07-13 | podologue | false | - | 판단보류(실데이터 가능) | 실명+숫자접미(2) = 테스트 재등록 dupe 가능성 높음(실재 여부 field confirm 필요) |
| 2 | `333132e9-3970-443f-9573-99f79556c179` | 박민석 | `1c61bad2…` | NULL | 2026-07-24 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 12건·package 1건·활동 2026-07-23~2026-08-05 → 실환자/스태프연습 판별 불가 |
| 3 | `78a9c656-5278-4724-a7f1-09d64db62ec6` | 박민석 | `1c61bad2…` | NULL | 2026-07-24 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 12건·package 1건·활동 2026-07-23~2026-08-05 → 실환자/스태프연습 판별 불가 |
| 4 | `ea0bb2ec-11a4-4cb8-af5e-4db2eb7ee1a7` | 박민석 | `1c61bad2…` | NULL | 2026-07-24 | podologue | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 12건·package 1건·활동 2026-07-23~2026-08-05 → 실환자/스태프연습 판별 불가 |
| 5 | `a629e0dc-1f30-403f-8814-80258a074038` | 풋테스트3 | `21a82994…` | NULL | 2026-06-30 | podologue | false | - | 테스트·더미 명백 | 고객명에 명시적 테스트 키워드(테스트/서류테스트) |
| 6 | `142521aa-5fb2-42db-ac9e-0145b0db6454` | 총괄테스트중 | `351d34c5…` | NULL | 2026-07-18 | unheated_laser | false | - | 테스트·더미 명백 | 고객명에 명시적 테스트 키워드(테스트/서류테스트) |
| 7 | `8282bb19-5038-48d4-a4a4-580bc1f6e195` | 기은서 | `4151cc2b…` | NULL | 2026-07-07 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 1건·package 1건·활동 2026-07-07~2026-07-07 → 실환자/스태프연습 판별 불가 |
| 8 | `6d54c7b0-a0e6-4ed0-8f33-84e377bd76d1` | 서류테스트 | `78975d00…` | NULL | 2026-07-22 | unheated_laser | false | - | 테스트·더미 명백 | 고객명에 명시적 테스트 키워드(테스트/서류테스트) |
| 9 | `74ac3114-65c7-44fe-95cc-0064103c6b32` | 박경수 | `8020be04…` | NULL | 2026-07-23 | podologue | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 2건·package 1건·활동 2026-07-23~2026-07-23 → 실환자/스태프연습 판별 불가 |
| 10 | `c06fbe1d-4340-4150-bcd5-b40a9d4c57d2` | 서류테스트2 | `80df7a6b…` | NULL | 2026-07-24 | unheated_laser | false | - | 테스트·더미 명백 | 고객명에 명시적 테스트 키워드(테스트/서류테스트) |
| 11 | `5d55c4da-9033-48b2-b277-7bc81af5a1ad` | 김OO | `83ab4fe1…` | NULL | 2026-05-27 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 12 | `e8b692bb-17ca-4e29-ac61-7f1b55482a25` | 김OO | `83ab4fe1…` | NULL | 2026-05-29 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 13 | `196c54db-17c2-48b0-8818-ed2d0a844518` | 김OO | `83ab4fe1…` | NULL | 2026-06-06 | heated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 14 | `afa1997d-b048-4d59-947c-b93f25320507` | 김OO | `83ab4fe1…` | NULL | 2026-06-08 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 15 | `aad454d5-7104-452b-9267-efeb051c6d07` | 김OO | `83ab4fe1…` | NULL | 2026-06-09 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 16 | `18ea0df8-03f3-42a8-978a-1c6be3457935` | 김OO | `83ab4fe1…` | NULL | 2026-06-10 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 17 | `a0cbc4ef-bf11-4cc9-af4a-e123ad117598` | 김OO | `83ab4fe1…` | NULL | 2026-06-12 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 18 | `8fea9012-a0e6-4b99-b2e8-ee4099d0ce19` | 김OO | `83ab4fe1…` | NULL | 2026-06-16 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 19 | `5c2f69b0-4dc7-4d28-9167-980fccd3dcb8` | 김OO | `83ab4fe1…` | NULL | 2026-06-17 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 20 | `9e0bb3ee-6ff1-48f5-93a2-65fdeb85079a` | 김OO | `83ab4fe1…` | NULL | 2026-06-23 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 21 | `df4310f7-3872-4243-963d-0097100d5bbe` | 김OO | `83ab4fe1…` | NULL | 2026-06-25 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 22 | `e28dffa5-2262-4825-acc2-df2c26b56eaf` | 김OO | `83ab4fe1…` | NULL | 2026-06-26 | heated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 23 | `0e8f84c8-29b9-4d8f-96b2-7bf8fb076eb6` | 김OO | `83ab4fe1…` | NULL | 2026-06-27 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 24 | `ecd6cb45-64f9-4cfe-8e7c-42b22aea3bc3` | 김OO | `83ab4fe1…` | NULL | 2026-06-30 | heated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 25 | `b4959728-a6f4-4803-89d9-7a3d77508f64` | 김OO | `83ab4fe1…` | NULL | 2026-07-04 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 26 | `76b533ad-2218-4871-829a-302a701456c5` | 김OO | `83ab4fe1…` | NULL | 2026-07-06 | heated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 27 | `fa4e86d0-b951-4eb4-a298-9f405d730539` | 김OO | `83ab4fe1…` | NULL | 2026-07-14 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 40건·package 4건·활동 2026-05-20~2026-08-07 → 실환자/스태프연습 판별 불가 |
| 28 | `261d6aad-8cb2-4767-8170-dcc288e28c09` | 김지혜 | `9200573f…` | NULL | 2026-07-02 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 7건·package 1건·활동 2026-06-30~2026-08-06 → 실환자/스태프연습 판별 불가 |
| 29 | `c3125286-638b-4463-859b-34ecaf4ee79f` | 풋 서류 테스트 입니다 | `c074025b…` | NULL | 2026-07-06 | unheated_laser | false | - | 테스트·더미 명백 | 고객명에 명시적 테스트 키워드(테스트/서류테스트) |
| 30 | `8cdbb847-1c03-480f-bdfa-98ea98c28423` | 김OO | `c59a2600…` | NULL | 2026-07-13 | podologue | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 2건·package 2건·활동 2026-07-02~2026-07-13 → 실환자/스태프연습 판별 불가 |
| 31 | `72d97156-5a80-4ca4-ac5d-cacb9ac40b8d` | 김설아 | `ca8975d4…` | NULL | 2026-07-07 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 2건·package 1건·활동 2026-07-07~2026-07-14 → 실환자/스태프연습 판별 불가 |
| 32 | `bdc08d55-5d36-40f9-9e45-43f1dd155ad4` | 김연희 | `d2b849b3…` | NULL | 2026-07-07 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명 패턴·is_simulation=false·check-in 2건·package 1건·활동 2026-07-01~2026-07-07 → 실환자/스태프연습 판별 불가 |
| 33 | `40fbd98b-439e-433d-8c1e-31eb164c7c30` | 송지현2 | `d7faae9b…` | NULL | 2026-07-13 | unheated_laser | false | - | 판단보류(실데이터 가능) | 실명+숫자접미(2) = 테스트 재등록 dupe 가능성 높음(실재 여부 field confirm 필요) |
| 34 | `1a14c169-f53b-434b-85b0-5272df93b117` | 풋테스트1 | `e72022d0…` | NULL | 2026-06-30 | unheated_laser | false | - | 테스트·더미 명백 | 고객명에 명시적 테스트 키워드(테스트/서류테스트) |

## by-customer (16)

| n_rows | 고객명 | customer_id | is_sim | total_checkins | total_packages | 활동기간 |
|--------|--------|-------------|--------|----------------|----------------|----------|
| 17 | 김OO | `83ab4fe1…` | false | 40 | 4 | 2026-05-20~2026-08-07 |
| 3 | 박민석 | `1c61bad2…` | false | 12 | 1 | 2026-07-23~2026-08-05 |
| 1 | 총괄테스트중 | `351d34c5…` | false | 2 | 1 | 2026-07-10~2026-07-18 |
| 1 | 기은서 | `4151cc2b…` | false | 1 | 1 | 2026-07-07~2026-07-07 |
| 1 | 서류테스트 | `78975d00…` | false | 4 | 2 | 2026-07-22~2026-07-30 |
| 1 | 박경수 | `8020be04…` | false | 2 | 1 | 2026-07-23~2026-07-23 |
| 1 | 서류테스트2 | `80df7a6b…` | false | 1 | 1 | 2026-07-24~2026-07-24 |
| 1 | 김지혜 | `9200573f…` | false | 7 | 1 | 2026-06-30~2026-08-06 |
| 1 | 풋 서류 테스트 입니다 | `c074025b…` | false | 1 | 1 | 2026-07-06~2026-07-06 |
| 1 | 김OO | `c59a2600…` | false | 2 | 2 | 2026-07-02~2026-07-13 |
| 1 | 김설아 | `ca8975d4…` | false | 2 | 1 | 2026-07-07~2026-07-14 |
| 1 | 김연희 | `d2b849b3…` | false | 2 | 1 | 2026-07-01~2026-07-07 |
| 1 | 송지현2 | `d7faae9b…` | false | 1 | 1 | 2026-07-13~2026-07-13 |
| 1 | 엄경은2 | `02594dfa…` | false | 1 | 1 | 2026-07-13~2026-07-13 |
| 1 | 풋테스트1 | `e72022d0…` | false | 1 | 1 | 2026-06-30~2026-06-30 |
| 1 | 풋테스트3 | `21a82994…` | false | 1 | 1 | 2026-06-30~2026-06-30 |

## freeze PK 목록 (34 cis_pk) — void 직전 재검증 앵커

```
0e8f84c8-29b9-4d8f-96b2-7bf8fb076eb6
142521aa-5fb2-42db-ac9e-0145b0db6454
18ea0df8-03f3-42a8-978a-1c6be3457935
196c54db-17c2-48b0-8818-ed2d0a844518
1a14c169-f53b-434b-85b0-5272df93b117
261d6aad-8cb2-4767-8170-dcc288e28c09
333132e9-3970-443f-9573-99f79556c179
40fbd98b-439e-433d-8c1e-31eb164c7c30
5c2f69b0-4dc7-4d28-9167-980fccd3dcb8
5d55c4da-9033-48b2-b277-7bc81af5a1ad
6d54c7b0-a0e6-4ed0-8f33-84e377bd76d1
72d97156-5a80-4ca4-ac5d-cacb9ac40b8d
745ddfeb-1814-4c3f-bf33-4f736aac0212
74ac3114-65c7-44fe-95cc-0064103c6b32
76b533ad-2218-4871-829a-302a701456c5
78a9c656-5278-4724-a7f1-09d64db62ec6
8282bb19-5038-48d4-a4a4-580bc1f6e195
8cdbb847-1c03-480f-bdfa-98ea98c28423
8fea9012-a0e6-4b99-b2e8-ee4099d0ce19
9e0bb3ee-6ff1-48f5-93a2-65fdeb85079a
a0cbc4ef-bf11-4cc9-af4a-e123ad117598
a629e0dc-1f30-403f-8814-80258a074038
aad454d5-7104-452b-9267-efeb051c6d07
afa1997d-b048-4d59-947c-b93f25320507
b4959728-a6f4-4803-89d9-7a3d77508f64
bdc08d55-5d36-40f9-9e45-43f1dd155ad4
c06fbe1d-4340-4150-bcd5-b40a9d4c57d2
c3125286-638b-4463-859b-34ecaf4ee79f
df4310f7-3872-4243-963d-0097100d5bbe
e28dffa5-2262-4825-acc2-df2c26b56eaf
e8b692bb-17ca-4e29-ac61-7f1b55482a25
ea0bb2ec-11a4-4cb8-af5e-4db2eb7ee1a7
ecd6cb45-64f9-4cfe-8e7c-42b22aea3bc3
fa4e86d0-b951-4eb4-a298-9f405d730539
```

## 하드 제약 준수
- void/UPDATE/DELETE/DDL **0** — 순수 SELECT roster (지속출혈 0·비긴급 P3)
- 실환자 데이터 혼재 가능 → 자동 분류 확정 금지, **'제안'분류만** (최종 판정 = planner per-row confirm-gate)
- freeze PK 34 = 이후 confirm-gate/void 직전 freeze 재검증 기준 (재검증 시 predicate 재실행하여 34 PK set 불변 확인)
