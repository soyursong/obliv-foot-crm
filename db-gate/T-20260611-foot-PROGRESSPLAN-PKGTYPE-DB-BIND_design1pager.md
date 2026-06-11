# T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND — 개선방향 1-pager (AC-0 design-first 게이트)

> 상태: **현장 confirm 대기** (김주연 총괄). confirm 전 DB 마이그 apply 금지.
> 작성: dev-foot / 2026-06-11 · 근거: prod READ-ONLY 진단 (`scripts/T-20260611-foot-PROGRESSPLAN-PKGTYPE_diag.mjs`)

## 0. 한 줄 요약
경과분석 플랜이 레거시 타입(package1/blelabel/special)으로만 설정돼 **실사용 패키지 환자 0명에게 발동**(현재 `progress_check_required=true` 예약 = **0건**). 근본 수선하려면 플랜을 **회차수(total_sessions) 기준**으로 재설계하는 것이 가장 robust(권고 C). 단순 string 정렬(B)은 즉효지만 신규 템플릿마다 재발 여지.

## 1. 진단 근거 (prod 실측, 2026-06-11)

### packages.package_type 분포 (active)
| package_type | active 패키지 | template_id 보유 | 비고 |
|---|---|---|---|
| **preset_12** | **255** | **0** | 압도적 다수(72%). 12회 프리셋. 템플릿 미연결 |
| 12회권 | 28 | 28 | template '12회권' |
| custom | 20 | 0 | 커스텀, 템플릿 미연결 |
| 24회권 | 13 | 13 | template '24회권' |
| 체험권 | 12 | 14 | 1회 체험 |
| 36회권 | 7 | 7 | template '36회권' |
| template | 4 | 0 | 문자열 그대로 "template" |
| 48회권 | 4 | 4 | template '48회권' |
| package1 | 2 | 0 | 레거시 |
| 1만원체험권 / PD 10회권 | 2 / 2 | 보유 | (is_active=false 템플릿) |
| blelabel / laser | 1 / 1 | 0 | 레거시 / 단발 |

→ **전체 356 패키지 중 template_id 보유 72건(20%), 미보유 284건(80%).** preset_12·custom·template 등 다수가 템플릿 미연결.

### 현 플랜 ↔ 패키지 매칭 실태 (`plans.package_type === packages.package_type`)
- 매칭 로직: `Reservations.tsx:2088` — 문자열 동일 + `session_milestone === 사용회차+1`.
- 교집합: blelabel↔1pkg, package1↔3pkg, special↔**0pkg**.
- 결과: **progress_check_required=true 예약 = 0건** (핵심 기능 구조적 미작동 확정).

### 레거시 10건 (package_progress_plans)
| package_type | milestones | 최종라벨 | 데이터 근거 매핑 |
|---|---|---|---|
| package1 (2건) | 6, 12 | "12회 최종 경과분석" | → **12회 tier** (preset_12 255 + 12회권 28 = ~283 active) |
| blelabel (6건) | 6,12,18,24,30,36 | "36회 최종 경과분석" | → **36회 tier** (36회권 7 active) |
| special (2건) | 6, 12 | "12회 최종 경과분석" | → 실사용 **0 패키지** = **dead record, 폐기** |

## 2. 데이터모델 방향 비교 (AC-0 a)

### Option A — `package_type` → `package_templates.id` FK 재설계
- 장점: 참조무결성, 템플릿 변경 시 플랜 자동 동기.
- **치명 단점: 매칭 모집단 붕괴.** 매칭을 packages.template_id 경유로 바꿔야 하는데 **284/356(80%)이 template_id 없음** — 특히 **preset_12 255건 전부 미보유**. 즉 FK로 가면 다수 환자에게 **여전히 미발동**. preset_12를 살리려면 packages.template_id 대량 backfill(255건+)이 선행돼야 함(별 리스크).
- 판정: **단독으로는 근본해결 아님** (다수 미연결 패키지 사각).

### Option B — 현행 string 매핑만 보정
- plans.package_type 값을 실사용 값(preset_12/12회권/24회권/36회권 …)으로 정렬. 코드는 string 매칭 유지.
- 장점: 경량·즉효. preset_12 다수 즉시 커버.
- 단점: 신규 템플릿/프리셋 추가 시 plans 수기 추가 필요(재발 여지). "template"/"custom" 같은 비표준 string도 개별 등록 필요.

### Option C (권고) — **회차수(total_sessions) tier 기준 재설계**
- plans를 `total_sessions` 정수 tier로 키잉(예: tier=12 → milestone 6/12, tier=36 → 6·12·18·24·30·36). 매칭: `package.total_sessions == plan.session_count_tier && milestone == 사용회차+1`.
- UI는 **package_templates를 동적 조회해 선택**(템플릿 고르면 total_sessions 자동 채움) + 직접 회차수 입력 허용.
- 장점:
  - **이름·template_id와 무관하게 동작** → preset_12·custom·template·12회권 등 **12회짜리 전부**가 단 하나의 12-tier 플랜으로 커버(가장 robust, "제역할 하는 형태").
  - 신규 템플릿 추가돼도 회차수만 같으면 자동 적용(재발 0).
- 단점: 코드 매칭 로직 1곳 변경(`Reservations.tsx`) + 컬럼 1개 추가(`session_count_tier int`). package_type 컬럼은 호환 위해 유지하다 단계 폐기.
- **권고 근거**: 다수 모집단(preset_12 255)이 template_id·표준명 둘 다 없음 → 이름/FK 기반(A·B)은 사각 발생, 회차수 기반(C)만 전수 커버.

## 3. 트리거 발동 영향 (AC-0 c, before/after)
- **BEFORE: 0건** (실측, 위 §1).
- **AFTER (권고 C 적용 시 모집단)**: 12-tier ~283 + 24-tier 13 + 36-tier 7 + 48-tier 4 ≈ **active 패키지 307건이 경과분석 대상 모집단**으로 진입. 실제 flag는 향후 예약이 해당 회차(6/12/18/24/30/36)에 도달할 때 건별 발동(대량 일괄 발동 아님 — 신규 예약 생성 시점 계산이므로 폭주 없음).
- 회귀검증 계획: 마이그 후 dry-run으로 "각 tier별 향후 milestone 도달 예상 예약 수" 카운트 + 의도치 않은 과발동 0 확인.

## 4. UI 변경 요약 (AC-0 d)
- `ProgressPlansTab.tsx` `PACKAGE_TYPE_OPTIONS` 하드코딩 제거 → `package_templates`(is_active) 동적 조회.
- 플랜 작성 시 **템플릿 선택 = 회차수 자동 채움**(C) / 또는 회차수 직접 입력.
- 그룹 헤더·뱃지 라벨을 회차수 tier(또는 템플릿명)로 표기.
- 경과분석 캘린더(AUTOLINK T-20260611-foot-PROGRESS-CAL-SESSION-AUTOLINK)의 '자동연동 표기'는 본 정합 후 비로소 정확해짐(선행 의존).

## 5. 김주연 총괄 confirm 필요 항목
1. **데이터모델: A / B / C 중 택1** (dev 권고 = **C 회차수 tier**).
2. **레거시 매핑 확정**: package1→12회 tier, blelabel→36회 tier, **special 2건 폐기(drop)** — 동의?
3. **누락 tier 신규 생성**: 현재 플랜 없는 **24회권·48회권**에도 경과분석 플랜 만들지? (예: 24→6/12/18/24, 48→6/12/…/48) 만들면 milestone 어떻게?
4. **체험권/Re:Born(0회)** 은 경과분석 대상 제외로 처리(동의?).

→ 위 confirm 수령 후에만 AC-1~5(DB 마이그·코드) 착수. confirm 없이 apply 금지.
