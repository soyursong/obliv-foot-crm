---
id: T-20260526-foot-PROGRESS-CHECKPOINT
domain: foot
priority: P2
status: deploy-ready
hotfix: false
created: 2026-05-26 11:14
deadline: 2026-06-06
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1779758034.025549"
reporter: 문지은 원장님
reporter_slack_id: U0A3SFLPAD6
attachments: []
e2e_spec: tests/e2e/T-20260526-foot-PROGRESS-CHECKPOINT.spec.ts
e2e_spec_exempt_reason:
risk_verdict: GO_WARN
risk_reason: "DB 스키마 변경(치료플랜 테이블 신규) + 비즈니스 로직 변경(예약 시 알림 트리거). 환자별 세팅이므로 신중 설계 필요."
source_msg: MSG-20260526-61086279
design_status: completed
design_msg: MSG-20260526-131357-wjgv
deploy_ready: true
build_ok: true
build_verify_cmd: "bash scripts/build.sh 2>&1 | tail -30"
db_migration: "supabase/migrations/20260526170000_progress_plans.sql + 20260527000000_progress_check_resv.sql"
deploy_ready_at: "2026-05-27T17:00:00+0900"
deploy_ready_commit: 57998c0eb74a3ef5e746b1e855f62422b80741b6
---

# T-20260526-foot-PROGRESS-CHECKPOINT — 경과분석지 플랜 세팅 (n회차 체크포인트 + 예약 시 알림)

## 구현 요약

### 완료된 AC 항목

#### AC-1: 치료 플랜 DB (package_progress_plans)
- `supabase/migrations/20260526170000_progress_plans.sql` — `package_progress_plans` 테이블 신규
  - `clinic_id`, `package_type`, `session_milestone`, `label`, `notify_staff`, `notify_patient`, `is_active`
  - UNIQUE (clinic_id, package_type, session_milestone)
  - RLS: admin/manager/director 쓰기, 인증 사용자 읽기
  - 종로 풋센터 시드 데이터 10건 (package1·blelabel·special)
  - Rollback SQL: `20260526170000_progress_plans.rollback.sql`
- `supabase/migrations/20260527000000_progress_check_resv.sql` — `reservations` 컬럼 추가
  - `progress_check_required BOOLEAN NOT NULL DEFAULT FALSE`
  - `progress_check_label TEXT`
  - INDEX: idx_reservations_progress_check (clinic_id, reservation_date WHERE progress_check_required = TRUE)
  - Rollback SQL: `20260527000000_progress_check_resv.rollback.sql`

#### AC-2: 경과분석 플랜 어드민 UI (ProgressPlansTab)
- `src/components/admin/ProgressPlansTab.tsx` 신규
  - 패키지 타입별 그룹(접기/펼치기) + 회차 CRUD
  - 신규 추가 / 수정 / 활성토글 / 삭제
  - 회차 입력 시 레이블 자동완성
  - `src/pages/DoctorTools.tsx` — "경과분석 플랜" 탭 추가

#### AC-3: 예약 생성 시 체크포인트 자동 감지
- `src/pages/Reservations.tsx` `ReservationEditor` 업데이트:
  - **패키지 연결 드롭다운** — 기존 고객 신규 예약 시 active 패키지 목록 표시
  - **anticipated_session_number 자동 계산** — 완료 회차 + 1 표시
  - **경과분석 감지 배너** — 체크포인트 매칭 시 teal 배너 표시
  - **저장 시 자동 태그** — `progress_check_required` + `progress_check_label` 저장
  - **토스트 알림** — `🔔 경과분석 필요 — {label}` (6초)

#### AC-4: 대시보드 경과분석 태그 필터
- 예약현황 필터 바에 "경과분석" 토글 버튼 추가
- 예약 카드 경과분석 배지 표시 (`bg-teal-100 text-teal-700`)
- `filterProgress ON` 시 progress_check_required=TRUE 예약만 표시

### E2E 스펙
- `tests/e2e/T-20260526-foot-PROGRESS-CHECKPOINT.spec.ts`
  - T1: 경과분석 플랜 탭 진입 + 시드 그룹 렌더
  - T2: 신규 체크포인트 추가 → 목록 반영
  - T3: 체크포인트 수정 다이얼로그
  - T4: 활성/비활성 토글 왕복
  - T5: 필수값 미입력 저장 방어
  - T6: 예약현황 경과분석 필터 버튼 + ON/OFF 토글
  - T7: 패키지 미연결 시 배너 미표시 (시나리오 4)

## DB 마이그레이션 주의사항

1. **선행 의존**: T-20260525-foot-MESSAGING-V1 DB migration 적용 필요 (notification_logs 테이블)
2. **적용 순서**: 20260526170000 → 20260527000000
3. **Supervisor QA 시 적용** — 현장 운영 DB에는 supervisor 검토 후 적용

---

*dev-foot 구현 완료: 2026-05-27*
*빌드: ✓ (npm run build 3.58s, 0 errors)*

### FIX (2026-05-27 by supervisor FIX-REQUEST MSG-20260527-160709-6znf)
- **원인**: supervisor 환경(macOS)에서 GNU `timeout` 미설치 → `timeout 60 npm run build` 실행 불가. phase1 build_fail로 QA 중단.
- **코드 변경**: 없음 (피처 코드 정상, `scripts/build.sh` 크로스플랫폼 래퍼 이미 존재)
- **해결**: `scripts/build.sh` 사용 안내 — timeout → gtimeout → plain npm run build 자동 폴백
- **빌드 직접 검증**: `npm run build:verify` ✓ 3.26s, 0 errors (dev-foot 환경)
- **supervisor QA 대체 명령**: `bash scripts/build.sh 2>&1 | tail -30`
- **커밋**: `57998c0eb74a3ef5e746b1e855f62422b80741b6`
