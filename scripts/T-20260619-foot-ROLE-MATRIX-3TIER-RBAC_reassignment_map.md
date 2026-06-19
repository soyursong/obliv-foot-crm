# T-20260619-foot-ROLE-MATRIX-3TIER-RBAC — 12 admin 분류·역배정 맵 제안 (non-destructive)

작성일: 2026-06-19 / dev-foot / prod read-only enumerate(DUALROLE-FINAL evidence §AC-1③ 재사용, 41 profiles) 기반.
**상태: 제안만. 실인물 role/flag 변경 DML은 reporter(문지은 대표원장) name→role 맵 confirm 후에만 apply (planner 회신 게이트).**

## 0. 확정 모델 (DA branch B)
- `has_ops_authority` boolean ADDITIVE flag (default false). 임상 role(director) ⟂ 운영권한 2축 분리.
- 진료관리 EDIT = `admin || has_ops_authority` (lock-out-safe). 운영최고권한(계정/통계/매출) = director는 flag 필요(봉직의 배제), admin/manager는 role-implied.

## 1. 현재 prod 분포 (read-only 실측, single-role)
```
admin: 12,  manager: 1(QA테스트),  director: 0,  therapist: 12,
consultant: 4,  coordinator: 7,  tm: 3,  staff: 2
```
director=0 · 핵심 운영자 전원 admin → tier가 데이터상 구분 안 됨. **게이트 binding 전 role 재배정이 선결**(lock-out 가드 AC-4).

## 2. 12 admin 분류 + 제안 역배정

| # | 이름 | 분류 | 현재 | **제안 role** | **has_ops_authority** | 근거 / confirm 필요 |
|---|------|------|------|--------------|----------------------|---------------------|
| 1 | 문지은 (mne@yonsei.ac.kr) | **clinic — 대표원장** | admin | **director** | **true** | reporter 본인. MUNJIEUN-ROLE-DIRECTOR B2 in-flight 경로로 admin→director. 운영최고권한 보유. |
| 2 | 김주연 (총괄) | **clinic — 총괄실장** | admin | **manager** | **true** | 운영 총괄(진료의 아님). 통계/매출/계정 유지(§12-3 EXCL-3 manager+ 표준). |
| 3 | 백승민 | clinic-operator(추정) | admin | **TBD** (manager/coordinator 등) | false | ★실직무 reporter confirm 필요. 현행 admin 유지 시 진료관리 over-grant. |
| 4 | 김다인 | clinic-operator(추정) | admin | **TBD** | false | ★실직무 confirm 필요. |
| 5 | 정용현 | clinic-operator(추정) | admin | **TBD** | false | ★실직무 confirm 필요. |
| 6 | 정혜인 | clinic-operator(추정) | admin | **TBD** | false | ★실직무 confirm 필요. (※ 별건 STAFF-DELETE 오등록 정리 진행 이력 있음 — 계정 상태 교차확인.) |
| 7 | 오세빈 | clinic-operator(추정) | admin | **TBD** | false | ★실직무 confirm 필요. |
| 8 | 박민지 | TM/마케팅팀장(추정) | admin | **TBD** (tm 등) | false | ★박민지 팀장=TM 맥락(STAFF-ROLE-TM-ADD). 운영최고권한 부여 여부 confirm. |
| 9 | 이광현 | 메디빌더 팀(추정) | admin | **system 유지** 또는 TBD | (유지 시 admin escape) | 메디빌더 측 팀장 추정. 시스템/외부면 admin 유지. |
| 10 | 김승현 (대표) | **system — 메디빌더 대표** | admin | **admin 유지** | (admin escape) | 플랫폼 CEO·슈퍼유저. 진료/운영 게이트 대상 아님. |
| 11 | 테스트관리자 (QA) | **test** | admin | **admin 유지 또는 제외** | (admin escape) | QA 테스트 계정. |
| 12 | dev-foot-test | **test/dev** | admin | **admin 유지 또는 제외** | (admin escape) | dev 테스트 계정. |

### 분류 요약
- **clinic-operator + flag (확정 제안)**: #1 문지은(director+true), #2 김주연(manager+true).
- **clinic-operator, role 재배정 필요(직무 confirm)**: #3~#8 (백승민·김다인·정용현·정혜인·오세빈·박민지). admin 유지 시 진료관리 수정·운영최고권한 over-grant. 실직무를 reporter가 알려주면 적정 role(coordinator/therapist/manager/tm 등)+flag:false로 재배정.
- **system/test (admin 유지 = escape hatch)**: #10 김승현 대표, #11 테스트관리자, #12 dev-foot-test, (#9 이광현 — 메디빌더팀이면 유지). admin은 모든 게이트를 통과(시스템 슈퍼유저)하므로 lock-out 무관·재배정 불요.

## 3. lock-out 가드 (AC-4) 정합
- 게이트 predicate는 전부 `admin` escape 포함 → 현재 전원 admin 상태에서 **누구도 lock-out 안 됨**(문지은 포함). predicate는 inert.
- 역배정(#3~#8 admin→non-admin) apply 시점에 비로소 게이트가 실효. 그 전엔 무해.
- 따라서 적용 순서: ① 컬럼 마이그(supervisor DDL-diff) → ② #1·#2 flag/role(confirm) → ③ #3~#8 role 재배정(직무 confirm) → 게이트 자연 실효.

## 4. confirm 필요 항목 (reporter → planner relay)
1. #3~#8 6인의 실제 직무 → 적정 role 매핑.
2. #8 박민지·#9 이광현 운영최고권한(통계/매출/계정) 보유 여부.
3. #2 총괄 김주연 통계/매출 접근 유지 default OK 확인(open_detail).
