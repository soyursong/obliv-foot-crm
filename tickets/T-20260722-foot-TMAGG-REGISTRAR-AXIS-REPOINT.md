---
id: T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-07-22
completed: 2026-07-22
db_changed: false
e2e_spec: tests/e2e/T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT.spec.ts
risk_verdict: GO
risk_reason: "§963⑩(a) invariant 집행(scalp2 Phase 0 foot 전파). verify-first: 소스+라이브 실측(60일 687건) 결과 TmAggregateSection 이 registrar_name 을 grouping key 374건·'TM팀만' inclusion 354건으로 read 하는 위반 확정 → 정규 귀속키(created_by 기반 tmAttributionKey)로 repoint. grouping = 직원명/'도파민 등록'(도파민-출처 단일 버킷)/'미지정'; 'TM팀만' = created_by→user_profiles.role='tm' 직접 판정; registrar_name = label-only(드릴다운 '등록자(예약)' 열에서만 표시, count 무영향). tmAttributionKey 시그니처에 registrarName 인자 부재 → 집계 구조적 inert(편집→count 불변). FE read-path·no-DDL·write 0·migration 0·신규 스키마 0 → 대표게이트 면제·§S2.4 CONSULT 비대상. 빌드 OK, 신규 spec 11 green(정적 불변식 7 + 집계-inert 수치 시뮬 3 + setup) + 기존 TM집계 spec 무회귀(헤더 '등록자'→'귀속' 명칭 정정에 따른 stale 라이브 assertion 2건 reconcile). 라이브 diag = scripts/T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT_diag.mjs(READ-ONLY)."
author: dev-foot
build_verified: "2026-07-22 — tsc --noEmit exit 0 + npm run build → ✓ built in ~5.4s"
---

# T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT

## 배경
DA scalp2 registrar_name CONSULT-REPLY §963⑩(a): TmAggregateSection 은 foot-상속 shipped 코드 →
foot 에도 동일 (a) 위반 개연. scalp2 Phase 0(TMAGG-REGISTRAR-AXIS-REPOINT)의 foot 전파.
기확립 invariant 집행 — CONVENE 불요. 백필 체인과 무게이트 병렬(foot=203건 백필 대상 아님, 독립).

## verify-first 결과
- **소스**: `tmStats` grouping = `labelForRes`(=`tmCounselorLabel` registrar_name 포함), `isTmLabel(labelForRes)` 필터 → registrar_name 이 grouping/filter 축. 위반.
- **라이브**(60일 687건): grouping 374건 / "TM팀만" inclusion 354건이 registrar_name 으로 좌우 → **무위반 아님**, repoint 진행.

## 조치 (FE read-path, no-DDL)
- `src/lib/stats.ts`: `tmAttributionKey`(정규 귀속키, registrar_name 무접촉) + `TM_DOPAMINE_BUCKET='도파민 등록'` 추가. `tmCounselorLabel` = label-only 표시 헬퍼로 가드 강화.
- `src/components/stats/TmAggregateSection.tsx`: grouping·"TM팀만"·totals·드릴다운 tm 컬럼 → 귀속키(attrKey/isTmRes). registrar_name 은 드릴다운 '등록자(예약)' 라벨 열에서만 표시. 헤더 '(등록자)'→'(귀속)'.

## 산출
- 코드: stats.ts / TmAggregateSection.tsx
- spec: tests/e2e/T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT.spec.ts (11 green)
- evidence: evidence/T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT.md
- diag(READ-ONLY): scripts/T-20260722-foot-TMAGG-REGISTRAR-AXIS-REPOINT_diag.mjs

## 게이트
- db_changed: false / DDL·migration·RPC·write 0 / 신규 스키마 0 → §S2.4 CONSULT 비대상.
- FE read-path only → 대표게이트 면제, supervisor DDL-diff only(diff 없음).
