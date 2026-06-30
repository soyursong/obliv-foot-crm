# T-20260630-foot-STAFF-AUTH-LINK-BACKFILL — DRY-RUN REPORT

- 실행: 2026-07-01, dev-foot
- 스크립트: `scripts/T-20260630-foot-STAFF-AUTH-LINK-BACKFILL_dryrun.mjs` (READ-ONLY, **prod write 0**)
- 산출 JSON: `scripts/T-20260630-foot-STAFF-AUTH-LINK-BACKFILL_dryrun.out.json`
- 게이트 단계: 가드1(dry-run) 완료 → **DA CONSULT(AC-2) 미선행 / 사람 confirm(AC-3) 미선행 / supervisor DB게이트 미선행 → apply 전면 보류**

## 결론 (한 줄)

**티켓 전제 무효 + AC-1 positive 증거 구조적 불가 → 자동 backfill 대상 0건. 전 44 미연결행 현장확인 분류. apply 보류, DA CONSULT + 현장확인 선행 필요.**

---

## 1. 티켓 전제 vs 실측 (divergence)

| 항목 | 티켓 전제 | 실측 (foot prod) |
|------|-----------|------------------|
| 대상 | "coordinator 7명 중 staff.user_id 미연결 5명" | staff 총 **67**, 미연결 **44** (전 역할 합산) |
| coordinator | 7 중 5 미연결 | coordinator **총12 / 연결3 / 미연결9** |
| "7"의 출처 | — | **user_profiles** coordinator = 7 (staff 쪽 아님). 전제가 두 테이블 수를 혼동한 것으로 추정 |

미연결 44건 역할분포: technician 25, coordinator 9, therapist 7, director 2, consultant 1.

## 2. 구조적 차단 사유 (왜 자동 backfill 0건인가)

### (A) staff 테이블에 email 컬럼이 없음 — AC-1 positive 증거 구조적 불가
- staff 컬럼: `id, clinic_id, name, role, active, created_at, user_id, updated_at`. **email 없음.**
- AC-1 positive 증거 = "이름+이메일 일치". staff 쪽 이메일이 부재해 **이메일 교차검증이 원천 불가** → 남는 키는 **이름 단독**.
- 이름 단독 매칭은 티켓 L43·L60·AC-1 이 명시적으로 금지한 "모호(이메일 부재)" 케이스 → 일괄 UPDATE 금지, 현장확인 대상.

### (B) 미연결 staff 다수가 비실인물 (장비/테스트/플레이스홀더) — user_id 부여 대상 아님
- **HOLD_NONPERSON 30건**: technician 25 (`테스트장비_1782…` 테스트 시드 7건 + `패디스캔/오니코/AF/아톰` 기기명), coordinator 4 (`데스크/전코디/송코디/홍코디` 플레이스홀더), therapist 1.
- CODY 선례의 "admin/director multi-clinic NULL = 의도된 정상 → backfill 금지" 와 동형. 장비 attribution용 pseudo-staff 는 auth 신원 부재가 정상.

### (C) 비활성 중복행 — 링크 시 1:1 / 多:1 위반(PHI 귀속 오염)
- **HOLD_OCCUPIED 4건**: 동명 user_profiles 가 **이미 다른(재직) staff.user_id 로 점유**됨.
- coordinator `장예지(inactive)`·`김지혜(inactive)` = 재직 동명행이 이미 LINKED. NULL 행은 stale 중복. 링크 시 동일 user_profiles 에 2개 staff 가 물려 **多:1 / 1:1 불변식 위반 → 발급자·시술담당 cross-contamination**.

## 3. 분류 집계 (전 44건, 자동 backfill 0)

| status | 건수 | 의미 |
|--------|------|------|
| HOLD_NONPERSON | 30 | 장비/테스트/플레이스홀더 — user_id 부여 대상 아님 |
| NO_MATCH | 6 | user_profiles 동명 없음 — 현장확인 |
| HOLD_OCCUPIED | 4 | 동명 profiles 이미 점유(중복행 추정) — 현장확인 |
| HOLD_NAME_ONLY | 4 | 이름 단독 단일후보, 이메일 부재로 AC-1 미충족 — 현장확인 |
| **backfill auto** | **0** | — |

### HOLD_NAME_ONLY 4건 (현장확인 시 1순위 검토 대상)

| 이름 | role | active | 단일 후보 user_profiles.id | 비고 |
|------|------|--------|---------------------------|------|
| 박민석 | coordinator | **true** | dad7dc00-dc99-41af-b5fc-42aa77a0bd9b | 유일한 재직 실인물 coordinator 후보. 이메일 교차검증만 되면 backfill 1순위 |
| 문지은 | director | true | d343769a-493a-49c9-b718-4c92c6f5db9a | **대표원장(의료 신원) — 민감**. 단일후보지만 이메일 부재, 현장 확인 필수 |
| 김민경 | coordinator | false | 77ef3500-f0c1-43de-9c3b-1072b7a2713c | 비활성(재직 동명 김민경은 별도 LINKED 존재) — 중복행 가능성 |
| 정혜인 | consultant | false | cbab05d7-1883-4afb-957a-bb6da1d69486 | 비활성 |

> 이 4건도 **자동 적용 안 함**(이메일 부재 = AC-1 모호). 현장(김주연) 동일 actor 확인 후에만 후보 채택.

## 4. AC 대비 현황

- **AC-1 (정확 매핑)**: positive 증거(이름+이메일) 구조적 불가 → 자동 1:1 확정 0건. 모호 전건 현장확인 분류. ✅ 추정 매핑 금지 준수.
- **AC-2 (DA CONSULT)**: 미선행 → 본 dry-run 결과 첨부해 CONSULT 요청(매칭 산식: 이메일 부재 시 대체 증거·중복행/장비행 처리 기준).
- **AC-3 (안전)**: apply 미실행. WHERE 가드/기대행수/rollback 은 대상 확정(현장확인 後) 시 구성. supervisor DB게이트 미진입.
- **AC-5 (non-blocking)**: 정규신원 마이그(GO)와 독립. 본건 미해소가 마이그·발급 차단 안 함 — 확인.

## 5. 다음 절차 (apply 전 게이트)

1. **DA CONSULT (AC-2)** — 본 dry-run 첨부. 질의: (a) staff.email 부재 환경에서 동일 actor 매칭 산식(대체 증거 = 활동 발자국 join? created_by/updated_by 역추적?), (b) 장비/플레이스홀더 staff 의 user_id 영구 NULL 허용 여부(계약 §2-2 정합), (c) 비활성 중복 staff 행 처리(링크 vs 정리). → CONSULT-REPLY GO 확보.
2. **현장확인 (AC-3, 김주연 총괄)** — HOLD_NAME_ONLY 4건(특히 박민석 재직 coordinator) 동일 actor 여부 + 문지은 의료신원 확인.
3. 확정 대상 발생 시: apply.sql(WHERE 삼중가드 `id IN(...)` + `user_id IS NULL` + role, 기대행수 박기) + rollback SQL → **supervisor DB 게이트** → 사후 검증(AC-4: created_by 적재 회복 + cross-contamination 0).

> apply 보류 사유: AC-2(DA) + AC-3(사람) 미충족 + 현 시점 positive 대상 0. 비파괴(prod write 0) 유지.
