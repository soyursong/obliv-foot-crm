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

---

## 6. DA CONSULT-REPLY 반영 (2026-07-01, MSG-20260701-034334-qxef) — AC-2 ✅

**판정: 수정(reframe) + 부분-GO(현장확인 링크 한정).** dry-run 분석(4분류·자동 0건·전제 무효)을 DA가 전부 인정. AC-2 게이트 통과.

- **대전제 확정**: `staff.user_id` = 편의 join 키 ❌ → auth 신원(PHI 귀속·감사) 링크. 오링크 1건 = PHI 귀속 오염. 매칭 바 = **결정적 2-factor OR 권위 현장확인**. 이름단독/속성추정 자동 backfill = 금지.
- **reframe**: 'bulk backfill' → **'감독형 신원 정합(supervised identity reconciliation)'** — 소수 N·건별 증거.
- **자동 알고리즘 backfill 순증 0 = 확정** → 자동 apply 경로 **영구 보류**.

### Q1 — staff.email 부재 시 대체 positive 증거 (추정 0 유지)
- 이름 단독 = 불충분(금지). name+clinic+role 삼중 = 여전히 속성추정 → '자동 링크' 증거 불인정, candidate 플래그까지만.
- 인정하는 결정적 2-factor (name 일치 + 택1): **(a) 활동 수렴**(동일 operational 레코드가 staff_id actor 와 그 레코드 auth 소유 user_profiles.id 를 동시 보유 — 단, staff 프로비저닝이 단일 auth 신원에 결정적으로 묶일 때만; created_by/updated_by 역추적 단독 불가) / **(b) 권위 현장확인(Q4)**.
- 둘 다 없으면 NULL 유지. 추론으로 채우지 말 것.

### 클래스별 처분 (Q2/Q3/Q4)
| class | 건수 | 처분 |
|-------|------|------|
| NONPERSON | 30 | **scope-out**. expected-NULL = 설계상 정상(결함 아님). 일일 정합성 감사 gap 재플래그 금지. CODY 'admin multi-clinic NULL=정상' 동형. (권고: staff.is_system/placeholder ADDITIVE 플래그 별 티켓 — 비차단) |
| OCCUPIED | 4 | 링크 금지. 활성 staff 가 user_profiles 점유 → 비활성 중복행 링크 = stale grant/PHI 귀속 오염. **별도 dedup/비활성정리 티켓 분리**, NULL 유지·carve-out |
| NAME_ONLY 비활성(김민경/정혜인) | 2 | dedup 경로. 이름일치만으로 링크 금지. '비활성행이 canonical/재활성' 명시 확인 시에만 예외 |
| NAME_ONLY 활성 **박민석** | 1 | **부분-GO**. 김주연 confirm 시 링크 GO |
| NAME_ONLY 활성 **문지은(대표원장)** | 1 | **부분-GO(민감)**. confirm + director급 인지(면허/매출귀속 영향) 동반 후 단건 |
| NO_MATCH | 6 | NULL 유지 |
| **auto backfill** | **0** | 순증 0 확정 |

### Q4 — 허용 apply 조건 (현장확인 = email 보다 강한 positive 증거)
- **증거 기록 의무**: 확인자(김주연)·일시·매핑(staff_id→user_profiles.id) **건별 기록** → targeted 단건 UPDATE(룰 일괄 금지).
- 박민석(활성) → 김주연 confirm 시 GO. 문지은(대표원장) → confirm + director급 인지 후 단건.

### 현재 게이트 / 다음 절차 (갱신)
1. AC-2 DA CONSULT ✅ 완료(부분-GO).
2. **apply 대기 = 현장확인 증거(김주연 confirm: 확인자·일시·매핑) 미확보** → 단건 apply 0 → prod write 0 유지.
3. 증거 확보 시: apply.sql 쌍별 단건 UPDATE → supervisor DB 게이트 → 사후검증(AC-4). non-blocking P2.
4. OCCUPIED 4 + 비활성 NAME_ONLY 2 = 별도 dedup 티켓으로 분리 요청(planner).

### 계약 반영 (DA)
§2-1 'staff.user_id 신원-링크 표준' 명문화 fold: (i) 비-로그인/NONPERSON staff = expected-NULL(gap 아님) (ii) 신원-링크 backfill = 결정적 2-factor 또는 권위 현장확인 필수, 이름단독/속성추정 금지(CODY 선례 일반화). body/derm/scalp staff 공통 — planner 인지.
