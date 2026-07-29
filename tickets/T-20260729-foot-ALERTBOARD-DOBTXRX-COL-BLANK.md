---
id: T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
assignee: dev-foot
reporter: planner
created: 2026-07-29
build: pass (npm run build ✓ built in 6.44s / tsc -p tsconfig.app.json --noEmit ✓)
db_change: false
db_migration: none
db_gate: N/A — read-only 조회 결선만. 신규 컬럼·테이블·enum·RLS 0. 기존 테이블(customers/package_sessions/check_in_services) 기존 컬럼 select 재사용. §S2.4 데이터 정책 자문 게이트 비해당(prod read-only 진단만).
risk_verdict: GO
risk_reason: "ADDITIVE-read. 변경 격리 = src/lib/format.ts(birthYearAgeDisplay 8자리 흡수, 6자리 경로 불변) + src/lib/opinionRequest.ts(useQueueVisitProcedureRx 신규, 방문 check_in_id 스코프) + src/components/doctor/DocRequestQueue.tsx(3컬럼 소스 재결선) + e2e spec + probe. write/DDL 0. row별 check_in_id 스코프 → 타 환자 유입 배제. 롤백 = 브랜치 미머지(origin/main 무접촉)."
scenario_count: 6 (시나리오A 처리대기 / 시나리오B 서류완료 과거일 / S1 생년 포맷 매트릭스 / S2 오늘시술 session_type / S3 처방 category / S4 스코프 무결) — 6 passed. 회귀 JINRYO-ALIMPAN 10 + DOCREQ-TABLEVIEW 병행 20 passed.
e2e_spec: tests/e2e/T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK.spec.ts
spec: tests/e2e/T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK.spec.ts
diag_script: scripts/T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK_probe.mjs (READ-ONLY)
commit: 로컬 브랜치 T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK (origin push 완료) — origin/main merge = supervisor QA 게이트 대기
deployed_at: 미배포 (self-deploy 금지 — §11 의료화면 confirm 게이트)
bundle_hash: 로컬 build (npm run build ✓)
medical_confirm_gate: required
confirm_status: pending — 진료 대시보드(의사 영역) 화면. deploy-ready GO but self-deploy 금지. 문지은 대표원장(U0ALGAAAJAV) direct confirm = planner→responder 라우팅. 선례 DOCFORM-AUTOFILL 동일.
summary: 진료 알림판 소견서·진단서 목록(처리대기+서류완료) 생년(만나이)·오늘시술·처방내역 3컬럼 전행 공란 → 각 행 방문(check_in_id) 스코프로 read-only 재결선.
---

# T-20260729-foot-ALERTBOARD-DOBTXRX-COL-BLANK

**화면**: 진료 대시보드 > 진료 알림판 > 진료부 통합 대시보드 > 소견서·진단서 목록 (처리대기 + 서류완료)

## 원인 진단 (RC — 런타임 재현 scripts/T-20260729-...-COL-BLANK_probe.mjs)

선례 JINRYO-ALIMPAN-3COL(07-29 머지) 배선이 실 데이터 없는 소스를 봐 3컬럼 전행 공란:

1. **생년(만나이)** — 소스 미결선이 아니라 **표기 함수** `birthYearAgeDisplay` 가 6자리 YYMMDD 만 파싱.
   실 소스가 만드는 8자리(live ISO `1994-05-30` / 스냅샷 `1994년 05월 30일`)를 slice(0,2)=`19`, slice(2,4)=`94`(월>12) → 무효 → 전행 공란.
2. **오늘시술** — `check_ins.treatment_kind`(prod 전행 NULL) + '글로벌 오늘(KST)' 스코프. 서류완료(과거일) 행은 today 필터로 전면 배제 → 공란.
3. **처방내역** — 소스(check_in_services 처방약)는 **데이터 존재**(바르토벤/터미졸크림 등). 그러나 today-글로벌 check_ins 로만 조회 → 과거일(서류완료) 행 미조회 → 공란.

공통 = 현행 훅이 각 행의 `check_in_id` 앵커가 아니라 "글로벌 오늘 check_ins"를 읽어 처리대기·서류완료 대부분이 공란. → DOCFORM(loadOpinionAutofillRef) 의 check_in_id-스코프 소스 해석을 목록 컬럼에 재사용.

## 처방 소스 판정 (AC-3 feasibility 게이트)

가용성 진단 결과 **결선 가능** — 실 데이터 보유처 = `check_in_services`(category_label='처방약'). PMW settle 시 처방약 라인아이템이 여기로 영속됨(런타임 확인: 바르토벤외용액/터미졸크림/한미유리아크림 등). 펜차트/결제미니창 별도 처방 테이블 불요. 억지 결선 없음.

## 수정 (read-only, DDL/write 0)

- `src/lib/format.ts` — `birthYearAgeDisplay` 8자리 정년(앞 4자리=year) 흡수. 6자리 경로 불변(회귀 0). `ageSuffix` 추출.
- `src/lib/opinionRequest.ts` — `useQueueVisitProcedureRx(clinicId, checkInIds)` 신규:
  - 오늘시술 = 그 방문 `package_sessions.session_type`(=차트2 티켓 차감/패키지 회차 차감) → `sessionTypeLabel` 간략형(레이저비가열/가열/발톱교정/각질…). 차감 없으면 공란.
  - 처방내역 = 그 방문 `check_in_services` 처방약(`extractRxDrugNames` 재사용).
- `src/components/doctor/DocRequestQueue.tsx` — 3컬럼 소스를 방문(check_in_id) 앵커로 교체. 처리대기+서류완료 양쪽 동일.

## 제약 준수
- read-only 조회만 — write/DDL/스키마 변경 0. row별 check_in_id/customer_id 스코프.
- **self-deploy 금지** (§11 의료화면 confirm 게이트) — 브랜치 push 완료, origin/main 미머지. 문지은 대표원장 direct confirm 후 supervisor 머지.
