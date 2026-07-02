# T-20260702-foot-CODY-ALL-PKG-PERM — REPRODUCE-FIRST 진단 결과 (AC1)

**결론: 유효(approved+active+clinic-matched) coordinator 에게는 "단건 결제 → 패키지 생성" 경로에 코드/RLS/FE blocker 가 없다. first-failing-link = 없음(코드). 실 blocker = 계정 승인상태(approval/activation) = 데이터/운영 액션.**

진단 방식: prod pg_policy 실측(Management API, read-only) + insert-chain 코드 추적 + FE 게이트 정독.
스크립트: `scripts/T-20260702-foot-CODY-ALL-PKG-PERM_repro_diag.mjs` (SELECT/카탈로그 only, write 0).

---

## insert-chain 전 링크 실측 (prod, 2026-07-02)

"단건 결제 → 패키지 생성"(PaymentDialog `paymentMode='package'`) write 순서 = packages → (회수1: payments / 회수≥2: package_payments) → check_ins.update(package_id).

| 링크 | prod 정책 | coordinator 허용 | clinic predicate | 판정 |
|------|----------|:---:|:---:|------|
| `packages` INSERT | `packages_staff_unlock_6menu`, `packages_insert` | ✅ | ❌ 없음 | 통과 |
| `payments` INSERT (회수1·단건) | `payments_coord_insert`, `payments_insert` | ✅ (payment_type='payment') | ✅ `clinic_id=current_user_clinic_id()` | 통과(clinic 일치 시) |
| `package_payments` INSERT (회수≥2) | `package_payments_staff_unlock_6menu` + consult_insert | ✅ | ❌ | 통과 (R2 旣확인) |
| `check_ins` UPDATE (package_id 링크) | `check_ins_update_privileged` | ✅ | ✅ clinic | 통과 |
| FE 게이트 | `canShowPackageMode`(=`!checkIn.package_id`, role 무관) / PaymentDialog `profile`=로깅 전용 | ✅ 게이트 없음 | — | 통과 |
| `packages` NOT NULL(`consultation_fee` 등) | 전 역할 공통(admin 정상 생성 → default 존재) | — | — | coordinator-특이 아님 |

- `is_coordinator_or_above()` = `is_approved_user() AND role IN (admin,manager,director,coordinator)`.
- `payments_coord_insert` 는 `is_coordinator_or_above()` 예속 → **미승인 coordinator 는 payments INSERT 거부**. 단 `payments_insert`(role 배열, is_approved 미포함)가 clinic 일치 시 별도 통과 → 승인여부와 무관히 단건 payments 는 이 정책으로도 열림. 그러나 조회(SELECT)·다수 write 는 `is_approved_user()` 예속이라 미승인 계정은 앱이 사실상 비동작.

## coordinator 계정 실측 (7건)

| 이름 | email | approved | active | clinic | 패키지 생성 |
|------|-------|:---:|:---:|--------|:---:|
| 김민경 | alsrud102938@naver.com | ✅ | ✅ | jongno-foot | **가능(코드상)** |
| 김지혜 | wlgp3907@naver.com | ✅ | ✅ | jongno-foot | 가능 |
| 박민석 | jungs5322@naver.com | ✅ | ✅ | jongno-foot | 가능 |
| 장예지 | jangyeji1242@naver.com | ✅ | ✅ | jongno-foot | 가능 |
| 김연희 | kyh3858@hanmail.net | ❌ | ❌ | jongno-foot | **불가(미승인)** |
| 김은지 | kim@oblivseoul.kr | ❌ | ❌ | jongno-foot | **불가(미승인)** |
| 송지현 | marissong@oblivseoul.kr | ❌ | ❌ | jongno-foot | **불가(미승인)** |

- 최근 14일 check_ins 41건 전부 jongno-foot → 유효 coordinator 4명은 clinic predicate 도 일치. clinic mismatch 가설 기각.
- **7명 중 3명(김연희·김은지·송지현)이 approved=false + active=false** → 이들은 패키지 생성뿐 아니라 앱 대부분 기능이 정상적으로 차단됨(is_approved_user 게이트). 만약 현장이 이 계정들로 시도했다면 "코디팀 전체 안 됨" 체감과 정합.

## 김민경 불일치 해소

김민경(alsrud102938) 은 approved+active+clinic-matched = 코드상 정상 생성 가능. 현장의 "김민경도 안 됨" 은:
(a) 클라이언트 세션 stale(role/승인 캐시 미갱신), (b) 실제 실패 계정이 이 김민경이 아님(동명이인/타계정), (c) 화면·오류 미확보 로 인한 오귀인 — 중 하나일 확률이 높음. **코드로 재현 불가.** ticket 명시 contingency("재현 안 되면 대상 계정 재특정") 발동.

## 조치

- ❌ **ADDITIVE 코드/RLS fix 미적용.** 유효 coordinator 는 이미 전 링크 통과 → 추가 개방은 blanket-open(AC4 위반) + 4차 ping-pong. 열 대상 없음.
- ✅ **first-failing-link = 계정 승인상태**(3계정 미승인) = 운영/데이터 액션(승인·활성화). 코드 아님. 부모 티켓 CODY-PKG-CREATE-PERM 의 human_pending(김연희 승인/백필) 과 동일 축.
- → planner FOLLOWUP + responder 현장 정밀 repro(정확 계정·화면·오류문구) 요청. deploy-ready 미마킹(배포할 코드 fix 없음 = false signal 금지).
