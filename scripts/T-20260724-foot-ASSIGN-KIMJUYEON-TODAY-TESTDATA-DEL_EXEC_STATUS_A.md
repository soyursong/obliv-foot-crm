# (A) 박민석 F-4790 취소 배정 삭제 — 실행 상태 (PARTIAL / 확장승인 대기)

- ticket: T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL
- planner GO: MSG-20260724-214047-n10w ((A) GO / (B) HOLD)
- 실행 시각: 2026-07-24 KST

## 실행 결과 요약
| 단계 | 대상 | freeze | rows-affected | 상태 |
|---|---|---|---|---|
| freeze 재검증 | check_ins 4 (박민석 F-4790, 전부 cancelled) | 4 | — | ✅ 일치 (drift 0) |
| freeze 재검증 | assignment_actions 4 (→김주연 consult) | 4 | — | ✅ 일치 (drift 0) |
| ledger 재확인 | payments/service_charges/package_sessions | — | 0 | ✅ clean (gate 조건 충족) |
| archive-first | 삭제직전 원값 스냅샷 | — | — | ✅ _EXEC_ARCHIVE_A.json |
| **DELETE** | **assignment_actions** | **4** | **4/4** | ✅ **삭제 완료** |
| DELETE | check_ins | 4 | 0 | ⛔ **ABORT** — FK 자식 잔존 |

## ABORT 사유 — dry-run FK-closure 과소열거
check_ins DELETE 시 `form_submissions_check_in_id_fkey` FK 위반. 전수 FK 자식 재탐색(OpenAPI 29개 check_in_id 보유 테이블 probe) 결과, dry-run 이 누락한 자식 3종 발견:

| 테이블 | 건수 | 금액성 | 성격 | 판정 |
|---|---|---|---|---|
| status_transitions | 7 | 없음 | 상태전이 audit | 체크인 내재 데이터 |
| form_submissions | 6 | 없음 | 체크리스트/동의서/서류 제출 | 체크인 내재 데이터 |
| **check_in_services** | **27** | **price/original_price** | 서비스 카트(가격 표기, is_package_session flag 3건) | ⚠️ **가격·패키지 인접** |

- 3종 전부 박민석 4 check_in 에만 bind (외부 참조 0). 손자 FK 0 (아무 테이블도 이 3종 id 미참조).
- check_in_services: price 합계 827,720. **단, package_session_id 전건 NULL / seller_staff_id 전건 없음 / 실 package_sessions=0** → 실 매출원장(payments·service_charges) 아님, 취소 테스트건의 미결제 카트.

## 미실행 이유 (dev 임의 확대 금지 준수)
planner GO 는 freeze-set(check_ins 4 + assignment_actions 4) + "payments/service_charges/package_sessions 무접점" 전제로 부여됨. 발견된 3종(특히 check_in_services 의 price/is_package_session)은 **동결 스코프 외 + (B) HOLD 를 유발한 매출명세·패키지 인접 surface** 와 동류 → dev 단독 파괴 삭제 금지. planner 확장승인 필요.

## 현재 DB 상태 (정합 유지, 복구 가능)
- assignment_actions 4건 삭제됨 (approved freeze 내, GO 하 실행). check_ins 는 자기 assignment audit 만 소거된 상태 — **FK 위반·orphan 없음, 정합 정상**.
- 복구경로: `_EXEC_ARCHIVE_A.json`(check_ins+assignment_actions 원값) + `_FREEZE_A_EXTENDED.json`(3종 자식 원값·id).

## 확장승인 시 재개 절차 (준비 완료)
freeze id 는 `_FREEZE_A_EXTENDED.json` 에 동결됨. FK-safe 순서:
`check_in_services(27) → form_submissions(6) → status_transitions(7) → check_ins(4)`
각 단계 rows-affected = freeze count 정확 일치 검증. 필터 재실행 금지, id 명시 삭제.

## 산출물
- `_execute_A.mjs` (재검증+archive-first+FK-safe DELETE 러너, --execute 게이트)
- `_EXEC_ARCHIVE_A.json` (삭제직전 원값)
- `_FREEZE_A_EXTENDED.json` (누락 자식 3종 확장동결)
- `_freeze_A_extended.mjs` (READ-ONLY 확장동결 러너)
