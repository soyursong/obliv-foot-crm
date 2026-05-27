---
id: T-20260526-foot-LAYOUT-USER-CUSTOM
domain: foot
priority: P2
status: deploy-ready
hotfix: false
created: 2026-05-26 22:00
deadline: 2026-06-06
e2e_spec: tests/e2e/T-20260526-foot-LAYOUT-USER-CUSTOM.spec.ts
risk_verdict: GO_WARN
risk_reason: "DB 스키마 변경(user_dashboard_layout_overrides 신규 테이블) + RLS 정책 신설. 기존 행(user_id=NULL) 하위호환 유지."
deploy_ready: true
deploy_ready_at: "2026-05-27T16:20:00+0900"
deploy_ready_commit: d87dc16d5538d6c93c6191a0699f224cfe4fe34d
deploy_ready_build: OK
db_migration: "supabase/migrations/ user_dashboard_layout_overrides (신규 테이블, RLS)"
db_rollback: "있음"
---

# T-20260526-foot-LAYOUT-USER-CUSTOM — 대시보드 배치편집 계정별 커스텀 오버라이드

## 구현 요약

대시보드 칸반 레이아웃을 계정(user)별로 독립 저장하는 기능.

- **AC-1**: `user_dashboard_layout_overrides` 테이블 신설 (clinic_id+user_id UNIQUE, RLS 개인 행만 INSERT/UPDATE)
- **AC-2**: 배치 편집 버튼 → 모든 계정(admin/manager/staff) 노출, 저장 시 개인 레이아웃 upsert
- **AC-2b**: "전 직원 기본 배치로 저장" admin/manager 전용 유지
- **AC-3**: 로딩 우선순위: 개인→지점기본→코드기본 3단계 폴백
- **AC-4**: RLS 개인 행 자기 권한만, 지점기본은 admin/manager
- **AC-5**: 기존 행(user_id=NULL) 하위호환 유지

## FIX 이력

### FIX-1 (2026-05-27 by supervisor FIX-REQUEST)
- **원인**: `toast.success` noop 처리로 AC-2b / AC-3 fallback 토스트 미노출
- **수정**: `toast.success(...)` → `toast.message(...)` 2곳 (line 2879, 2938 Dashboard.tsx)
- **커밋**: `73e846102945f050d8992a17ccc3aa4c15648a18`
- **빌드**: OK (3.50s)

### FIX-2 (2026-05-27 by supervisor FIX-REQUEST MSG-20260527-155415-qnzs)
- **원인**: supervisor 환경(macOS)에서 GNU `timeout` 미설치 → `timeout 60 npm run build` 실행 불가. phase1 build_fail로 QA 중단.
- **코드 변경**: 없음 (피처 코드 정상, 기존 `scripts/build.sh` 크로스플랫폼 래퍼 이미 존재)
- **해결**: `scripts/build.sh` 사용 안내 — timeout → gtimeout → plain npm run build 자동 폴백
- **빌드 직접 검증**: `npm run build` ✓ 3.22s, 0 errors (dev-foot 환경)
- **supervisor QA 대체 명령**: `bash scripts/build.sh 2>&1 | tail -30`
- **커밋**: `d87dc16d5538d6c93c6191a0699f224cfe4fe34d`
