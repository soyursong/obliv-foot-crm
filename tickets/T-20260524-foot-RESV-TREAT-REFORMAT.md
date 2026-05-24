---
id: T-20260524-foot-RESV-TREAT-REFORMAT
domain: foot
priority: P2
status: deployed
deploy_ready_at: 2026-05-24 21:16
commit_sha: bb44f1c
db_migration: false
e2e_spec: tests/e2e/T-20260524-foot-RESV-TREAT-REFORMAT.spec.ts
build_result: OK
hotfix: false
created: 2026-05-24 19:20
deadline: 2026-06-07
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779618025.105529
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
attachments: []
e2e_spec_exempt_reason: null
risk_verdict: GO
risk_reason: "0/5 — FE 표시 컬럼 재편성만. DB 변경 없음. 기존 RESV-TREAT-HISTORY(878c79b)/RESV-TREAT-UX(be37e18) 코드 수정."
ref:
  - T-20260522-foot-RESV-TREAT-UX (deployed, be37e18 — 시술내역 1건+스타일 배포)
  - RESV-TREAT-HISTORY (878c79b — 시술내역 표시 원본)
created_by: ops-planner
qa_result: pass
qa_grade: Green
deployed_at: 2026-05-24T22:57:00+09:00
deploy_commit: bb44f1c
bundle_hash: Reservations-CP3atCbY
precheck_pass: true
precheck_at: 2026-05-24T22:55:00+09:00
field_soak_until: 2026-05-25T22:57:00+09:00
---

# T-20260524-foot-RESV-TREAT-REFORMAT — 재진 예약 시술내역 패키지 구성 재편성

## 배경

김주연 총괄 원문 (2026-05-24, C0ATE5P6JTH):
> 2) 재진 예약 시 하단 시술내역에 패키지명/회차/치료명/치료사/시술일 -> 해당 구성으로 재편성해줘

**컨텍스트**: RESV-TREAT-UX(be37e18, deployed 5/22)에서 시술내역 표시 1건 + 회차 빨간색 + 치료명 한글 매핑 배포 완료.
현장에서 컬럼 구성 자체를 변경 요청: 기존 표시 → **패키지명 / 회차 / 치료명 / 치료사 / 시술일** 5컬럼 구성으로 재편성.

## 수용 기준 (AC)

### AC-1: 시술내역 5컬럼 구성 재편성
- 재진 예약 팝업 하단 시술내역 섹션을 다음 5컬럼으로 재편성:
  1. **패키지명** — package_sessions.packages.name (패키지 테이블 JOIN)
  2. **회차** — session_number / total_sessions (기존 빨간색+굵게 유지)
  3. **치료명** — session_type 한글 매핑 (기존 TREAT_KO 매핑 유지)
  4. **치료사** — performed_by staff 이름 (staff 테이블 JOIN)
  5. **시술일** — performed_at 날짜 (YYYY-MM-DD 또는 MM/DD 형식)

### AC-2: 데이터 소스
- 기존 RESV-TREAT-HISTORY(878c79b) 쿼리 확장 (packages JOIN + staff JOIN 추가)
- `package_sessions` → `packages` (패키지명)
- `package_sessions` → `staff` (performed_by → staff.name, 치료사)
- 기존 `session_number`, `total_sessions`, `session_type`, `performed_at` 유지

### AC-3: 최신 1건 표시 유지
- RESV-TREAT-UX(be37e18) AC-1에서 확정한 최신 1건 표시 규칙 유지
- 컬럼 구성만 변경

### AC-4: 데이터 없는 컬럼 fallback
- 패키지명 미연결: "—" 표시
- 치료사 미배정: "—" 표시
- 시술일 미기록: "—" 표시

### AC-5: 기존 기능 회귀 없음
- 초진/신규 고객: "이력 없음" 안내 유지
- 회차 빨간색+굵게 스타일 유지
- 치료명 한글 매핑 유지

## 현장 클릭 시나리오 (E2E 변환 가이드)

### 시나리오 1: 정상 — 5컬럼 시술내역 표시
1. 로그인 → 대시보드
2. 재진 예약(시술 이력 있는 고객) 슬롯 클릭 → 예약 팝업
3. 하단 시술내역 섹션 확인:
   - 패키지명: "종합 발건강 패키지" (예시)
   - 회차: **3/10** (빨간색+굵게)
   - 치료명: "비가열" (한글)
   - 치료사: "김OO"
   - 시술일: "05/20"

### 시나리오 2: 부분 데이터 — fallback 표시
1. 패키지 미연결 시술 이력이 있는 고객 예약 팝업
2. 패키지명: "—" / 치료사: "—" 등 fallback 확인

### 시나리오 3: 이력 없는 고객
1. 신규 고객 예약 팝업
2. "이력 없음" 안내 표시 확인

## 리스크 5항목

| # | 항목 | 해당 | 비고 |
|---|------|------|------|
| 1 | DB 스키마 변경 | No | 기존 테이블 JOIN만 추가 |
| 2 | 외부 서비스 의존 | No | - |
| 3 | 비즈니스 로직 변경 | No | 표시 로직만 (데이터 write 없음) |
| 4 | 대량 데이터 변경 | No | - |
| 5 | 신규 npm 패키지 | No | - |

> **risk_verdict: GO (0/5)** — FE 표시 컬럼 재편성만. DB 변경·BL 변경 없음.

## 변경 파일
- `src/pages/Reservations.tsx` — 시술내역 섹션 5컬럼 재편성 + staff JOIN 쿼리 확장
- `src/pages/CustomerChartPage.tsx` — stray code 제거 + unused state(designatedTherapistSaved) 정리
- `tests/e2e/T-20260524-foot-RESV-TREAT-REFORMAT.spec.ts` — E2E spec 14건 추가
- `playwright.config.ts` — 2 lines

## update_log
- 2026-05-24 19:20 planner — 신규 생성 (MSG-20260524-25105529 #2). RESV-TREAT-UX 후속. P2, approved, GO(0/5).
- 2026-05-24 19:28 planner — slack_thread_ts 보강(1779618025.105529). MSG-20260524-192321-4wiq #3에서 포맷 재편성 재확인.
- 2026-05-24 21:16 dev-foot — commit bb44f1c. TreatHistoryRow therapist_name 추가. staff:performed_by(name) JOIN. 5컬럼 그리드 grid-cols-[2fr_1fr_1fr_1fr_1.2fr]. fallback "—". 빌드 OK. E2E 14건 PASS.
- 2026-05-24 22:57 supervisor — QA PASS (Green). 전 항목 PASS → deployed.

## QA 결과 (supervisor, 2026-05-24T22:57:00+09:00)

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ PASS | 3.20s, exit 0 |
| 기존 기능 회귀 | ✅ PASS | slice(0,1)·TREAT_KO·빨간+굵게·testid 전량 유지 |
| DB 호환성 | ✅ N/A | db_migration: false, DB 변경 없음 |
| 권한/RLS | ✅ N/A | DB 변경 없으므로 RLS 변경 없음 |
| 롤백 SQL | ✅ N/A | DB 변경 없으므로 불필요 |
| env 매트릭스 (C1) | ✅ PASS | VITE_SUPABASE_URL·ANON_KEY 2종. 신규 env 없음. bundle grep 1건 ✅ |
| Runtime Safety (§7.5) | ✅ PASS | `(sessData ?? []).map()` null 가드 ✅ / `staffObj?.name ?? '—'` optional chain ✅ / Object.values/for-of 없음 |
| E2E spec | ✅ 29/29 | unit + desktop-chrome 프로젝트 전량 PASS (8.1s) |
| 브라우저 QA | ✅ PASS | qa_runner.sh 3/3. 운영 URL 접속 OK. 스크린샷 저장. |
| 운영 번들 grep | ✅ PASS | Reservations-CP3atCbY.js — therapist_name/치료사/performed_by 1건 매치 |

**qa_grade: Green** — FE-only, DB 변경 없음, 0/5 리스크. 전 항목 PASS.

Vercel 배포 상태: last-modified Sun, 24 May 2026 13:54:43 GMT (22:54 KST) > commit 21:16 KST → 반영 확인.
bundle_hash: Reservations-CP3atCbY (etag: b6f8efebd0400b4d52e59ddacb1dd5e0)
