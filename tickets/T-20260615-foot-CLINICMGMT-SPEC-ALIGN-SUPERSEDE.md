---
id: T-20260615-foot-CLINICMGMT-SPEC-ALIGN-SUPERSEDE
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT.spec.ts, tests/e2e/T-20260525-foot-FEE-SET-TEMPLATE.spec.ts, tests/e2e/T-20260607-foot-DXTOOL-MENU-REORG.spec.ts
e2e_spec_exempt_reason: spec-정합 티켓 — 신규 spec 없음. 배포본(7fed414 STAFF-OPEN / 67ab9ad PHRASEMGMT-SUBTAB-SPLIT / KOH-REPORT-TAB)에 맞춰 기존 영향 spec 3건의 stale 단언을 갱신·락인.
created: 2026-06-15
assignee: dev-foot
reporter: planner (MSG-20260615-013400-pk6g, GO 판단 회신 — FOLLOWUP MSG-20260615-013005-jgc3)
slack_channel: C0ATE5P6JTH
slack_thread_ts: null
reporter_slack_id: U0ATDB587PV
deploy_commit: 131322c
qa_result: pass
commit: 131322c
supersedes: T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT AC-3 (director-gating) ← T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN(7fed414) STAFF-OPEN
---

# T-20260615-foot-CLINICMGMT-SPEC-ALIGN-SUPERSEDE — 진료관리 STAFF-OPEN canon 정합

## 배경

진료관리(ClinicManagement) 가시성 축은 T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN(deployed 7fed414,
reporter 김주연 총괄 명시권위, umbrella RLS-MENU-ROLE-PARITY-POLICY `open-all-except-3` 정합)으로 이미
**전 직원 개방**으로 수렴 종결됨. 라이브 canon = `Services.tsx:236 canViewClinicMgmt = !!profile?.role`.
본 티켓은 그 종결 모델에 잔존한 stale 산출물(spec·레거시 라우트·설명문)을 사후 정합한다. FE-only canon maintenance,
의사결정·데이터 변경 없음. (planner GO 판단: 추가 현장/대표 게이트 불요.)

## AC

- **AC-1 (RXTOOL spec AC-3 supersession)**: `T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT.spec.ts` AC-3 단언을
  director-gating → STAFF-OPEN 모델(`canViewClinicMgmt=!!profile?.role`)로 갱신. 주석에 `superseded by 7fed414` 명기.
  → RXTOOL 티켓에 SUPERSESSION 기록 append (planner 측 처리 완료).
- **AC-2 (App.tsx 레거시 라우트 이중성 해소)**: `/admin/clinic-management` RoleGuard를 services 진입 role ∪ director 로 확대
  (`admin/manager/director/consultant/coordinator/therapist`). 서브탭은 전직원 열렸는데 직접 라우트만 차단되던 불일치 제거
  (MedicalChartPanel '관리 화면으로' → 이 라우트 탐 → therapist 실영향). L58·L212 stale director-only 주석 갱신.
  ⚠ FE 가시성/라우트 게이트만 — 진료관리 내부 패널의 데이터 RLS/WRITE 권한 불변(umbrella Phase2 RLS 트랙 소관).
- **AC-3 (FEE-SET spec AC-4a 라우트 정합)**: `T-20260525-foot-FEE-SET-TEMPLATE.spec.ts` AC-4a 인라인 라우트를
  `/admin/clinic-management` → `/admin/services?tab=fee_set_templates` 로 정합(PHRASEMGMT-SUBTAB-SPLIT 67ab9ad 배포본).
- **AC-4 (RXTOOL AC-4 설명문 + DXTOOL spec 정합)**: RXTOOL AC-4 DoctorTools 설명문/탭 구성 단언을 배포본 정합
  (KOH-REPORT-TAB 반영). DXTOOL spec(`T-20260607-foot-DXTOOL-MENU-REORG.spec.ts`)은 PHRASEMGMT-SUBTAB-SPLIT
  drift-fix(상용구·수가세트 → 서비스관리 서브탭 이전, ClinicManagement 부재 락인)로 검증 — **숨은 cross-ticket locked AC 역전 없음**
  (묶음처방 영구보존 Stage C 락인 불변, 8/8 green).
- **AC-5 (무회귀)**: e2e green / admin·manager·director 동작 무변경(role set 확대일 뿐 축소 없음) / DB변경 0 확인 후 deploy-ready.

## 검증 (2026-06-15)

- `npm run build` PASS (3.79s)
- e2e green:
  - RXTOOL-INJURY-MENU-SPLIT: 8 passed (AC-2 라우트보존 + AC-3 STAFF-OPEN 가시성·라우트가드 parity + MedicalChartPanel 라우팅 연동)
  - FEE-SET-TEMPLATE: 6 passed / 1 skipped (AC-4a 서비스관리 서브탭 딥링크 + AC-4b 진료세트 regression)
  - DXTOOL-MENU-REORG: 8 passed (상용구·수가세트 이전 락인 + Stage C 묶음처방 영구보존 락인 무변경)
- 소스 정합 확인: ClinicManagement.tsx 에 `value="phrases"`·`value="fee_set_templates"` 부재(0) / Services.tsx 에 서브탭 딥링크 존재
- **DB변경: 없음** — FE 게이트·spec 정합 한정, 신규 컬럼/테이블/enum 0 → data-architect CONSULT §S2.4·supervisor DDL-diff·DB게이트 모두 불요
- commit **131322c** push→main (Vercel 자동)
