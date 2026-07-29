---
id: T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: 8ff93685164c
deployed_at: 2026-07-29 (ticket branch pushed — origin/main merge = supervisor QA 게이트 대기)
bundle_hash: 로컬 build Assignments-Dm4U1s5q.js (npm run build ✓)
db_change: false
db_migration: none
db_gate: N/A — FE 표시/집계 레이어 전용. 신규 컬럼·테이블·enum 0. cancelled 배제 + customers.name live 소싱(기존 select 재사용). §S2.4 데이터 정책 자문 게이트 비해당(read-only 진단만 prod 접근).
build: pass (npm run build ✓ / tsc ✓)
scenario_count: 10 test (A 잔여면 취소배제 3 + B 잔여면 정본소싱 2 + 회귀 3 + 선행 sibling 8 병행 = 18 PASS)
e2e_spec: tests/e2e/T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE.spec.ts
spec: tests/e2e/T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE.spec.ts
diag_script: scripts/T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE_systemic.mjs (READ-ONLY)
related_fix: a7885a99 (T-20260729-foot-ASSIGN-POPUP-DUPASSIGN-NAMETRUNC — 선행 부분 fix, origin/main 배포됨)
red_line_touched: false (customers.assigned_* / assigned_consultant_id 무접촉)
created: 2026-07-29
completed: 2026-07-29
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (MSG-20260729-154832-klz1) / 현장 김주연 총괄
---

# T-20260729-foot-PATIENT-F5247-DUPASSIGN-NAME-TRUNCATE — 장홍석(F-5247) 중복배정 + 성 누락

## 착수 근거
planner NEW-TASK MSG-20260729-154832-klz1 (approved, P1). 현장 김주연 총괄 "중요한 사안".
repo=obliv-foot-crm.

## ⚠ 중복 티켓 관계 (중요)
본 티켓(15:48 KST 발행) 이전, 동일 F-5247 증상에 대해 별도 dev 세션이 **선행 fix `a7885a99`**
(`T-20260729-foot-ASSIGN-POPUP-DUPASSIGN-NAMETRUNC`, 15:57 KST 커밋)을 이미 수행 → **origin/main 머지 +
prod 배포 완료**(prod version.json commit=45931c67, built 2026-07-29T07:36:33Z = 16:36 KST).
즉 F-5247 는 배포 시점에 **누적/드릴 팝업(staffStats)** 에서 이미 해소됨.
본 티켓은 그 선행 fix 가 놓친 **잔여면(금일 배분 이력 표)** 을 닫는 델타 + 데이터 진단 결론이다.

## 진단 (diagnosis-first, prod READ-ONLY)
`scripts/..._systemic.mjs` + 선행 `..._diag.mjs`. 당월 non-deleted check_ins 435건 스캔.

### A. 중복배정 = 표시/쿼리 결함 (데이터 오염 아님 · RED LINE 무접촉)
- F-5247 = check_in 2건 공존: 최현희(consultant_id 9172beb7, **cancelled**, 06:41 UTC soft-hide됨) +
  강경민(6ab26d9f, **done**, active). = 취소 후 재방문 재배정의 **정상** 이력. 배정 row 2건이지만 활성은 1건.
- **systemic**: cancelled 제외 시 `[한 환자 → 활성 consultant ≥2]` = **0건**. 즉 데이터 불변식
  '1환자=1활성배정' 은 데이터 레벨에서 이미 성립 → **F-5247 row 정정·백필·불변식(DB) 신설 불요**.
  RED LINE(`customers.assigned_consultant_id`/`assigned_staff_id`) **무접촉**.
- 유령 원인 = 집계 소스가 `deleted_at IS NULL` 만 필터하고 `status='cancelled'` 를 배제 안 함.
  fix전 cancelled 포함 유령후보 = 5명(F-5247 포함). → 선행 a7885a99 가 staffStats 에서 해소.

### B. 성 누락 = 로컬 스냅샷 staleness (렌더 결함 아님)
- `customers.name`='장홍석'(정본) vs `check_ins.customer_name`='홍석'(등록시점 스냅샷). 팝업이 스냅샷을 읽음.
- 당월 불일치 = 3/435 ('홍석/장홍석', '박경숙/박경수', '김구엽⁰/김구엽') → 국소적 = 렌더 결함 아님.

## 본 티켓 델타 (선행 fix 가 놓친 잔여면)
`src/pages/Assignments.tsx` `todayDistribution`(금일 배분 이력 표)는 선행 fix 대상(staffStats) 밖 →
여전히 (A)cancelled 미배제 + (B)스냅샷 성함 사용. 당월 cancelled&non-soft-hide 9건이 이 표에 유령/성누락 잔존.
→ staffStats 와 **동일 가드 2건**을 이 표에도 일관 적용:
1. `if (ci.status === 'cancelled') continue;` (today-window skip 직후, push 이전)
2. `customerName: cust?.name ?? ci.customer_name ?? '—'` (정본 우선, 스냅샷 fallback)

## 배정 규칙 불변 (planner 요구)
배정 규칙·엔진 무변경. 표시 레이어에서 '취소=비활성 배정' 불변식만 일관 적용. RED LINE write 0.

## planner 보고 필요 (관찰, scope 밖)
- [랭킹] 탭 당일 배정건수 쿼리(`check_ins.consultant_id`, deleted_at null)는 cancelled 포함 집계 →
  취소 배정이 실장 당일 카운트에 소량 포함될 수 있음(중복 표시 아님·admin 전용·카운트 정확도 이슈).
  동일 불변식 적용 여부는 별 티켓 판단 요청(본 티켓 = 중복 표시면만).

## 게이트
1. ✅ diagnosis-first (prod READ-ONLY) — 데이터 오염 없음 확정, RED LINE 무접촉
2. ✅ 잔여면 fix + build ✓ + E2E 18 PASS
3. ⏳ supervisor QA → origin/main 머지 → CF Pages 배포
4. ⏳ 갤탭 실기기 field-soak 현장 confirm (풋 done 기준)
