---
id: T-20260606-foot-THERAPIST-EVAL-VIEWER-ADMIN
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260606-foot-THERAPIST-EVAL-VIEWER-ADMIN.spec.ts
e2e_spec_exempt_reason: null
qa_result: pass
created: 2026-06-06
commit: ff141bd
component_note: "뷰어 특정=치료 테이블(src/pages/TreatmentTable.tsx, /admin/treatment-table, 치료사 뷰 포함). thread 추정 후보(SALES-TAB-RENAME-THERAPIST·SALES-STAFF-DEDUCT-BASIS)는 매출 정산 화면이라 '치료 들어가고 나오는 시간/어떤 치료' 의도와 불일치 → 실제 코드로 치료 테이블 확정."
---

# T-20260606-foot-THERAPIST-EVAL-VIEWER-ADMIN — 치료 테이블(치료사 평가 뷰어) 어드민 게이팅

## 요청
문지은 대표원장(C0ATE5P6JTH): "이 뷰어는 어드민 권한만. 아무나 보면 안 됨. 이걸 토대로 치료사 평가·어레인지. 지금 CRM에서 치료 들어가고 나오는 시간/어떤 치료 들어갔는지 다 파악되고 있지?"

## AC-0 조사 결과 (read-only)
1. **치료 인/아웃 시각** — check_ins.`checked_in_at`(접수), `called_at`(호출), `completed_at`(완료), `doctor_confirmed_at` 기록됨. 단 **상태전환별(치료실 입실↔퇴실) 타임라인은 미수집** — status 전환에 per-transition timestamp 없음(status_flag_history는 flag 변경만). 정밀 "치료 입실/퇴실 시각"은 부분 수집(접수·완료 시각 + laser_minutes 소요분).
2. **치료 종류** — 기록됨 ✓ : `treatment_kind`, `treatment_category`(발톱무좀/내성발톱), `treatment_contents[]`(가열/비가열/포돌로게/수액), `preconditioning_done`, `pododulle_done`, `laser_minutes`, `therapist_id`.
3. **뷰어 특정** — 치료 테이블(TreatmentTable.tsx, /admin/treatment-table). 치료사 뷰 탭 + 치료사 필터 + 접수시각/처치단계/관리메모. CSV 내보내기 포함.
4. **접근통제(수정 전)** — **완전 오픈**: 라우트 RoleGuard 없음(직접 URL 전원 접근) + 메뉴 roles 미지정(전원 노출).

⚠️ **데이터 토대 갭(후속 티켓 권고)**: 치료실 입실↔퇴실 정밀 시각(세션 시작/종료 timestamp)이 미수집이라, 치료사별 "치료 소요시간·동선 효율" 정량 평가는 현재 데이터로 한계. 접수~완료 시각 + laser_minutes로 근사만 가능. 정밀 평가지표 필요 시 status 전환 timestamp 적재(check_ins status history) 별도 후속 티켓 발번 권고 → planner.

## AC-1 구현
- App.tsx: treatment-table 라우트 `<RoleGuard roles={['admin','manager']}>` 적용 → 비-어드민 직접 URL 차단(Sales 매출집계와 동일 게이트).
- AdminLayout.tsx: treatment-table NAV_ITEM `roles:['admin','manager']` → 비-어드민 메뉴 숨김.
- 신규 role 미추가(기존 staff role 체계 재사용). lockout 방지(대표원장=admin 비잠금).
- E2E 2 시나리오: 시나리오1(비-어드민 차단, 정적 RoleGuard/NAV 양방향 검증 4건) / 시나리오2(어드민 정상접근, 브라우저 5건). 전건 pass.

build OK(3.51s). db_change=false. commit ff141bd → main(Vercel auto).

## QA 재검증 (FIX-REQUEST MSG-20260606-130457-24ne, phase2 insufficient_verification 대응)
원인: spec `BASE_URL` 기본값이 5173(이 레포 dev 포트 8089와 불일치)이라 시나리오2(브라우저)가 webServer 자동기동 환경에서 ERR_CONNECTION_REFUSED로 미실행. → 기본값 8089로 정렬.

1) **E2E 전건 pass** — `npx playwright test T-20260606-...spec.ts`: **8 passed (22.5s)**
   - 시나리오1(정적 RoleGuard/NAV 검증) 3건 pass
   - 시나리오2(어드민 브라우저: 직접URL 비리다이렉트·테이블 렌더·메뉴 노출·콘솔무에러) 4건 pass + auth setup 1건
2) **배포 URL 브라우저 시뮬레이션** (https://obliv-foot-crm.vercel.app):
   - shot1: 미로그인 → /admin/treatment-table 접근 시 **/login 으로 차단** (비-어드민 차단 실증)
   - shot2: admin 세션 → /admin/treatment-table **치료 현황 테이블 정상 렌더**(치료사 뷰 탭·CSV·사이드바 메뉴 노출)
   - 스크린샷: `_handoff/qa_screenshots/T-20260606-foot-THERAPIST-EVAL-VIEWER-ADMIN/{shot1_anon_blocked,shot2_admin_treatment_table}.png`
