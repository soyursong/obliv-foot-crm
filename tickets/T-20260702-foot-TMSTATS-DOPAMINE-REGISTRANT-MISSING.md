---
id: T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-07-02
completed: 2026-07-02
db_changed: false
e2e_spec: tests/e2e/T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING.spec.ts
risk_verdict: GO
risk_reason: "표시측 read-only fix. 통계 TM집계 '등록자' 라벨(tmCounselorLabel)에 registrar_name 축을 추가해 예약관리 페이지 '등록자'(reservations.registrar_name SSOT)와 동일하게 표시. 우선순위 (1)created_by→직원명(직접등록 불변, 회귀0) → (2)registrar_name(도파민/TM '진운선') → (3)dopamine provenance → (4)미지정. 스키마/RPC/migration 0. created_by/인센티브 산식 미승격(§416 이중계상 격리 유지). 빌드 OK, E2E 10/10 green(신규 6 + 기존 FOOTSTATS-COUNSELOR-NULL 4 무회귀)."
author: dev-foot
build_verified: "2026-07-02 — npm run build → ✓ built in 5.08s"
---

# T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING

## 현장 신고 (박민지 팀장, C0ATE5P6JTH)
통계대시보드 > TM집계에서 도파민 연동(source_system=TM) 예약건의 등록자 이름이 공란.
동일 예약이 예약관리 페이지에서는 등록자 '진운선'으로 정상 표시.

## 진단 (DIAGNOSE-FIRST, dev DB 실측)
도파민/TM 경로 예약 실측: `created_by=NULL`(firewall §416, 설계상 정상), `source_system='dopamine'`,
`visit_route='TM'`, `registrar_name='진운선'`(matched, registrar_id FK 존재) / 또는 `'[도파민TM] {name}'`.

- **예약관리(Reservations.tsx)** = `reservations.registrar_name` 스냅샷으로 '진운선' 표시 → **SSOT**.
- **TM집계(tmCounselorLabel/stats.ts)** = `created_by`→user_profiles 직원명 축만 조회 →
  created_by=NULL 이라 resolve 실패 → 실제 등록자('진운선')를 못 보고 provenance 라벨로 뭉갬.
- **RC** = 두 화면의 '등록자' 참조 축 불일치 (예약관리=registrar_name / TM집계=created_by).

## Fix (표시측, read-only)
`tmCounselorLabel`에 `registrar_name` 축 추가:
1. `created_by`→직원명 (직접등록 예약: 동작 불변, 회귀 0)
2. `registrar_name` (예약관리 '등록자'와 동일 SSOT → '진운선')
3. `source_system='dopamine'` + 스냅샷 없음 → provenance 라벨
4. 그 외 → 미지정

`stats.ts` fetchTmAggregate select에 `registrar_name` 추가. TmResRow 인터페이스 확장.

## 급소 가드 (§416)
registrar_name 은 **표시 전용** — created_by/집계 귀속/인센티브 산식으로 승격 금지.
라벨 함수는 순수(입력→문자열, side-effect 0). NULL created_by 유지 = 이중계상 방지 fail-closed.

## 핵심 AC
- [x] TM집계에서 도파민 연동 예약건도 등록자명('진운선') 정상 표시
- [x] 직접등록 예약 회귀 없음 (branch 1에서 직원명 우선, spec 검증)

## sibling 교차진단
T-20260702-foot-DOPAINGEST-PHONE-HOVER-MISSING 과 동일 클러스터(도파민→풋 TM예약 표시측 누락).
공통 원인축 = 도파민 ingest 예약의 created_by=NULL firewall + FE가 denorm/스냅샷 축을 안 읽음.
단, **다른 필드·다른 fix 위치**: phone(호버, reservations.customer_phone denormalize / ingest EF 측)
vs 본건 registrant(TM집계, registrar_name 표시축 / stats FE 측). 동일 조인결함의 단일 파생은 아님.

## 파일
- src/lib/stats.ts (TmResRow.registrar_name, resSelect, tmCounselorLabel)
- src/components/stats/TmAggregateSection.tsx (labelForRes → registrar_name 전달)
- tests/e2e/T-20260702-foot-TMSTATS-DOPAMINE-REGISTRANT-MISSING.spec.ts (신규)
