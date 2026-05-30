---
id: T-20260522-foot-RESV-PKG-HISTORY
title: "재진 예약 팝업 구매패키지 시술내역 표시 + 치료사 컬럼 추가"
status: deploy-ready
deploy-ready: true
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-05-28
completed_at: 2026-05-31
commit_sha: be5c89b
build_ok: true
build_verified_at: 2026-05-31
db_changed: false
spec_file: tests/e2e/T-20260522-foot-RESV-PKG-HISTORY.spec.ts
risk: GO
assignee: dev-foot
source: planner MSG-20260524-194804-8wf8
reporter: 김주연 총괄 (U0ATDB587PV)
fix_request: MSG-20260531-064903-8tt6
---

# T-20260522-foot-RESV-PKG-HISTORY

재진 예약 등록 팝업에서 고객 선택 시 구매패키지 시술내역(패키지명·회차·치료명·치료사·시술일) 5컬럼 표시.

## AC 체크리스트

- [x] AC-1: 고객 선택 시 시술내역 영역 즉시 표시 (신규 등록 시 미표시)
- [x] AC-2: 패키지명|회차(N/M)|치료명|시술일 컬럼. 시술일 내림차순. 최근 10건+더보기
- [x] AC-3: 기존 시술내역과 동일 소스 (package_sessions + packages 재사용)
- [x] AC-4: 로딩 스피너 + 이력 없음 안내 문구
- [x] AC-5: 예약 저장·초진/재진 토글·예약메모 회귀 없음
- [x] AC-R1: 시술내역 5컬럼 — 패키지명/회차/치료명/**치료사**/시술일. 치료사 없으면 "—" fallback

## 구현 내역

### 초기 구현 (878c79b / 066310d)
- `Reservations.tsx` TreatHistoryRow interface + treatHistory state
- package_sessions + packages 조인 쿼리 (4컬럼)
- 빈 이력: "시술 이력이 없습니다" 안내

### AC-R1 FIX (bb44f1c — T-20260524-foot-RESV-TREAT-REFORMAT)
- TreatHistoryRow에 `therapist_name: string` 필드 추가
- package_sessions 쿼리에 `performed_by, staff:performed_by(name)` JOIN 추가
- 그리드 4컬럼 → 5컬럼: `grid-cols-[2fr_1fr_1fr_1fr_1.2fr]`
- 치료사 셀: `row.therapist_name` 렌더, performed_by null → "—" fallback
- E2E spec: S1 헤더 체크 + S4 AC-R1 치료사 컬럼 전용 시나리오 추가

## 빌드 환경 이슈 (FIX-REQUEST MSG-20260527-183946-j649)

### 현상
`timeout 60 npm run build 2>&1 | tail -30` → `EINTR: process.cwd failed (uv_cwd)` 실패

### 원인
macOS/macstudio 환경에서 GNU `timeout` 명령이 SIGALRM을 사용함.
libuv의 `uv_cwd()` (내부 `getcwd()` syscall)는 signal-safe하지 않아 EINTR로 실패.

### 코드 변경 없음
피처 코드(Reservations.tsx, E2E spec) 변경 없음. 빌드 자체는 정상:
```
npm run build → ✓ built in 3.23s (exit 0)
bash scripts/build.sh → ✓ built (exit 0)  # SIGALRM 없는 watchdog 방식
```

### 올바른 빌드 명령 (supervisor QA용)
```bash
# ✅ 권장 (scripts/build.sh watchdog — SIGALRM 없음)
bash scripts/build.sh 2>&1 | tail -20
npm run build:verify 2>&1 | tail -30

# ✅ 직접 실행
npm run build 2>&1 | tail -30

# ❌ macOS에서 사용 금지
timeout 60 npm run build  # SIGALRM → uv_cwd EINTR
```

빌드 재검증: 2026-05-27 `npm run build` → 3.23s OK, 0 errors.
