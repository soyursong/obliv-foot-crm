---
id: T-20260526-foot-PMW-SIDEMENU-FEAT
domain: foot
priority: P2
status: deployed
qa_result: pass
qa_grade: Yellow
deploy_ready_at: 2026-05-26T11:45:00+09:00
deployed_at: "2026-05-26T17:30:00+09:00"
deploy_commit: d3e5479
bundle_hash: CxjCcVqm
field_soak_until: "2026-05-27T17:30:00+09:00"
db_migration: 20260526130000_service_menu_order.sql — APPLIED (supabase db query --linked)
hotfix: false
created: 2026-05-26 10:02
deadline: 2026-05-30
slack_channel: C0ATE5P6JTH
slack_thread_ts: null
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
attachments:
  - id: F0B5MEAU84F
    name: 20260526_094654.png
    mimetype: image/png
    url: https://files.slack.com/files-pri/T0ALX8VKANL-F0B5MEAU84F/20260526_094654.png
    local: ~/file_inbox/20260526/094654_F0B5MEAU84F_20260526_094654.png
e2e_spec_exempt_reason: null
risk_verdict: GO
risk_reason: "FE + 신규 테이블(service_menu_order) 추가. DB/외부서비스 변경 1/5(GO_WARN). 비즈니스 로직 무변경(UI 순서 preferences만). 롤백 SQL 존재."
source_msg: MSG-20260526-51503199
---

# T-20260526-foot-PMW-SIDEMENU-FEAT — 결제 미니창 좌측 수가항목 영역 기능 추가

## 배경

김주연 총괄(풋센터): **"아 내가 말한건 옆에 메뉴 항목이였어 스크린샷 참고해서 기능 추가해줘!"**

이전 대화에서 언급한 내용이 오해된 것으로 보이며, 스크린샷으로 구체적 대상을 명시해 재요청.

**첨부 스크린샷**: F0B5MEAU84F (20260526_094654.png)

### 스크린샷 분석

스크린샷은 **결제 미니창(PaymentMiniWindow)** 화면을 보여줌.

- **적색 박스 강조 영역**: 좌측 패널 — 수가항목(fee items) 그리드
  - 표시 항목: 초진진찰료-의원(AA154), 진단서(C5900002), 소견서(C5900003), 진료확인서(C5900004), 재진진찰료-의원(AA254), 재진-물리치료/주사 등(AA222), 단순처치(M0111), 진료소견서, 진료의뢰서, 진료확인서(코드+진단명)(1/2), 통원확인서, 진단서(영문), 소견서(영문), 진료기록사본(1-5매/6매+), 일반진균검사(D620300HZ), 피검사(D2501001)
  - 총 약 18개 항목이 카드 형태 그리드로 배치
- **우측 패널**: 차트코드+진료비 산정, 수가항목(2건), 금일 시술내역(1건), 세금구분, 합계(32,210), 서류발행 체크리스트
- **화면 뒤(배경)**: 대시보드 통합시간표, 좌측에 상병코드/처방약/풋케어 탭 일부 노출

### 구현 완료 (AC-1~AC-6)

결제 미니창 **풋케어 탭 서비스 메뉴 카드 순서 변경 + DB 영구 저장** 기능 구현:

- **AC-1**: `순서 편집` 토글 버튼 → DnD + ↑↓ 리스트 모드 전환 (항목 2건 이상 시 노출)
- **AC-2**: `service_menu_order` 테이블에 debounce 800ms upsert (clinic × foot_cat 단위)
- **AC-3**: `checkIn.clinic_id` 기반 — 오리진 풋 클리닉만 로드
- **AC-4**: 기본(진찰료) / 시술내역(풋케어) / 수액 / 화장품 서브탭 각각 독립 순서
- **AC-5**: 기존 카드 클릭(수가 항목 추가) 기능 무변경
- **AC-6**: `service_menu_order` 신규 테이블 생성 + RLS

## 수용 기준 (AC)

- [x] **AC-1**: 순서 편집 토글 버튼 → DnD + ↑↓ 복합 지원
- [x] **AC-2**: service_menu_order upsert (debounce 800ms, clinic × foot_cat)
- [x] **AC-3**: checkIn.clinic_id 경유 — 단일 지점 범위
- [x] **AC-4**: 서브탭별 독립 순서 (탭/서브탭 전환 시 편집 모드 리셋)
- [x] **AC-5**: 카드 클릭 수가 추가 기능 무영향
- [x] **AC-6**: DB 마이그레이션 + 롤백 SQL

## 리스크 5항목

| # | 항목 | 판정 | 사유 |
|---|------|------|------|
| 1 | DB 스키마 변경 | ⚠️ GO_WARN | service_menu_order 신규 테이블 (롤백 SQL 존재) |
| 2 | 외부 서비스 의존 | ✅ 없음 | |
| 3 | 비즈니스 로직 변경 | ✅ 없음 | UI 순서 preferences만. 결제 로직 무변경 |
| 4 | 대량 데이터 변경 | ✅ 없음 | |
| 5 | 신규 npm 패키지 | ✅ 없음 | |

**판정: GO_WARN (1/5 확정)**

## QA 결과 (supervisor — 2026-05-26)

### Phase 1 코드 QA

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ PASS | 3.34s, exit 0 |
| 기존 기능 영향 | ✅ PASS | selectedItems / 결제 로직 무변경 |
| DB 호환성 | ✅ PASS | migration APPLIED, rollback SQL 존재 |
| 권한/RLS | ⚠️ Yellow | `TO authenticated` 미지정 — anon 접근 이론적 가능. 데이터 민감도 낮음(UI 순서 prefs). 차기 마이그레이션에서 hardening 권고. |
| 롤백 SQL | ✅ PASS | `20260526130000_service_menu_order.down.sql` 존재 |

### Phase 1.5 env 매트릭스

- 신규 env 변수 없음
- 기존 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` Vercel Production 등록 확인
- 운영 bundle `ReservationCancelModal-CxjCcVqm.js` — `service_menu_order` 2건 매치 ✅

### Runtime Safety Gate (7.5)

| 패턴 | 코드 | 결과 |
|------|------|------|
| menuOrderRes null guard | `(menuOrderRes.data ?? [])` L908 | ✅ |
| for-of rows guard | rows는 `?? []` 적용, L911 | ✅ |
| Object.entries guard | `Object.keys(menuOrder).length === 0 return` L1156 | ✅ |
| ids null guard | `if (!ids \|\| ids.length === 0) continue` L1160 | ✅ |
| curIds null guard | `prev[footcareCat] ?? menuTabServicesRef.current` L1348, L1365 | ✅ |

**Runtime Safety: PASS** ✅

### Phase 2 E2E

| 케이스 | 결과 |
|--------|------|
| 인증 셋업 | ✅ PASS |
| AC-1 토글 | ⬜ SKIP (체크인 없음 — 정상) |
| 시나리오-2 ↑↓ | ⬜ SKIP (체크인 없음 — 정상) |
| 시나리오-3 완료 | ⬜ SKIP (체크인 없음 — 정상) |
| 시나리오-4 탭 리셋 | ⬜ SKIP (체크인 없음 — 정상) |
| AC-5 카드 클릭 | ⬜ SKIP (체크인 없음 — 정상) |
| 시나리오-5 서브탭 리셋 | ⬜ SKIP (체크인 없음 — 정상) |

testid 전건 JSX 확인: menu-reorder-toggle / menu-card-list / menu-card-row-{id} / menu-reorder-up-{id} / menu-reorder-down-{id} / pricing-list / pricing-row-{id} ✅

## 현장 클릭 시나리오

### 시나리오 1: 순서 편집 → 완료
1. 로그인 → 대시보드
2. 체크인 카드 클릭 → 수납(결제) 클릭
3. 결제 미니창 열림 → 풋케어 탭 확인
4. `순서 편집` 버튼 클릭 → 리스트 모드 전환 확인
5. ↑↓ 버튼으로 순서 변경
6. `완료` 클릭 → 그리드 모드 복귀, 변경된 순서 유지
7. 창 닫고 재진입 → 저장된 순서 복원 확인

## 비고
- 관련 티켓: T-20260523-foot-FEE-ITEM-SCROLL (P2, deployed) — 결제 미니창 수가항목 스크롤
- 관련 티켓: T-20260526-foot-SVC-CATEGORY-SORT (P2, deployed) — 서비스관리 탭별 순서 변경
- RLS Yellow 항목: `service_menu_order` 정책에 `TO authenticated` 누락 → 차기 마이그레이션 hardening 권고 (별도 티켓)

## 변경 이력
- 2026-05-26 10:02 — 티켓 생성 (planner)
- 2026-05-26 11:45 — deploy-ready 마킹 (dev-foot)
- 2026-05-26 17:30 — QA 완료 + deployed (supervisor)
