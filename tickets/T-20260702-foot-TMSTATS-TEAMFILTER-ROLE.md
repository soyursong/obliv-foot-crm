---
id: T-20260702-foot-TMSTATS-TEAMFILTER-ROLE
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-07-02
completed: 2026-07-02
db_changed: false
e2e_spec: tests/e2e/T-20260702-foot-TMSTATS-TEAMFILTER-ROLE.spec.ts
risk_verdict: GO
risk_reason: "표시/필터측 read-only fix. 통계 TM집계 'TM팀만' 필터 판정축을 created_by(단일 uid) → 집계 표시 라벨(tmCounselorLabel 결과)로 통일. lib/stats.tmRoleNames(staffMap)로 계정관리 role='tm' 계정명 집합을 만들고 표시 라벨(직원명·registrar_name)이 그 집합에 들면 TM 판정 → 필터·결과·집계 3자 일치. 기존 created_by 단일축은 풋 TM팀이 registrar_name 경로로 귀속(created_by=데스크 admin/coordinator)돼 TM 전건 누락+데스크 잔존 = 오집계였음. role 소스=user_profiles.role(계약 §2-3 enum 'tm'; user_roles flip 은 게이트 SEQUENCED, 현행 소스 유지). 스키마/RPC/migration 0. 어떤 값도 write/승격 없음(순수 read-only). 빌드 OK, spec 11 green(순수 규칙 9 + E2E 토글 2), 기존 TM집계 spec 20 무회귀."
author: dev-foot
build_verified: "2026-07-02 — npm run build → ✓ built in 5.26s"
---

# T-20260702-foot-TMSTATS-TEAMFILTER-ROLE

## 화면 / 현상
- 화면: obliv-foot-crm 통계대시보드 > TM집계 페이지
- 현상: "TM팀만" 필터 클릭 시 role='TM'이 아닌 계정도 포함됨
- 요구: "TM팀만" = 계정관리 role='TM'인 계정만 필터 대상/결과/집계에 표시

## 진단 (dev DB 실측)
- 계정관리 role='tm' 계정 = **진운선 / 이수빈 / 김효신** (전부 active). role enum 값 소문자 `'tm'`.
- 풋 TM팀 예약 귀속축 = `reservations.registrar_name` (실제 `created_by` 는 데스크 admin/coordinator).
- 기존 "TM팀만" 필터 = `isTm(created_by)` **단일축** 판정.
  - 집계 표시축은 이미 `registrar_name`-aware 라벨(`tmCounselorLabel`, T-20260702-DOPAMINE-REGISTRANT 반영)인데
    **필터축만 created_by 로 남아** 두 축이 불일치.
  - 결과: TM팀 예약 전건 누락(created_by=데스크라 role≠tm) + 데스크 계정이 그대로 집계에 잔존 = 오집계.
- **RC = 필터 판정축(created_by) ↔ 집계 표시축(registrar_name-aware 라벨) 불일치.**

## Fix (read-only)
- `lib/stats.ts`: `tmRoleNames(staffMap)` 순수 함수 신설 — staffMap 에서 `role==='tm'` 계정명 집합 반환(SSOT).
- `TmAggregateSection.tsx`: "TM팀만" 판정을 `isTmLabel(label)=tmRoleNames(staffMap).has(label)` 로 교체.
  필터·결과·집계 3자 모두 동일 표시 라벨 기준 → 항상 일치.
- created_by 단일축 판정(`isTm`/`tmOfRes`) 제거.
- role 소스 = `user_profiles.role` (계약 v1.0 §2-3 enum `'tm'`). user_roles flip 은 게이트 SEQUENCED → 현행 소스 유지.

## AC 검증
- **AC1** role='tm' 계정(진운선/이수빈/김효신)만 필터에 표시 — ✅ (spec 순수규칙, 실측 시뮬 NEW=진운선만 통과)
- **AC2** role≠'tm' 계정(admin 김주연·coordinator 박민석) 제외, 현상 재현 계정 사라짐 — ✅
- **AC3** 필터 해제 시 전체 계정 정상 표시(회귀 없음) — ✅ (OFF=230건 전건, onlyTmRole=false 판정 미개입)
- **AC4** 집계 수치도 TM role 계정 기준으로만 산출 — ✅ (KPI/테이블 tmFiltered* 파생)

## 배포 / 게이트
- 배포: **FE-only** (`lib/stats.ts` + `TmAggregateSection.tsx`) → Vercel 자동배포 대상 (EF 배포 불요).
- §11 의료게이트: 통계 TM집계 = 비의료 화면 = **비대상**.
- §S2.4 데이터정책게이트: 신규 컬럼/테이블/enum **0** (role 컬럼 read-only) = DA CONSULT **면제**. risk_verdict=GO.
- DB 변경: **없음**.

## 검증
- `npm run build` → ✓ built in 5.26s
- E2E `tests/e2e/T-20260702-foot-TMSTATS-TEAMFILTER-ROLE.spec.ts` — 11 PASS (순수 규칙 9 + 렌더 토글 2)
- 회귀: 기존 TM집계 spec 20 PASS (DOPAMINE-REGISTRANT / STATS-TM-AGGREGATE-TAB / FOOTSTATS-COUNSELOR-NULL)
- commit `9be6a20f` (main)

## supervisor QA 요망
- 실 계정 로그인 → 통계 > TM집계 → "TM팀만" ON: 진운선/이수빈/김효신(role=tm)만 집계 표시,
  데스크(김주연 등) 사라짐 / OFF: 전건 복귀 — 갤탭 실기기 confirm.
