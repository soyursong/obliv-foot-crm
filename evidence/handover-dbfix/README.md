# T-20260605-foot-HANDOVER-DBFIX — AC-3/AC-4 브라우저 UI 재현 증빙

supervisor FIX-REQUEST(phase1, insufficient_verification) 대응.
운영(https://obliv-foot-crm.vercel.app)에서 **실제 브라우저 UI 클릭**으로
AC-3(메모+체크리스트 저장)·AC-4(재진입 조회 영속)를 재현한 증빙.

## 검증 결과 (2026-06-05)

| 항목 | 계정/역할 | 결과 | schema-cache 에러 |
|------|-----------|------|-------------------|
| AC-3 저장(UI) + AC-4 재진입(UI) | test@medibuilder.com / **admin** | 🟢 PASS | 0 |
| AC-3 저장(UI) + AC-4 재진입(UI) | 임시 coordinator(비-admin 일반직원) | 🟢 PASS | 0 |

> handover route(`/admin/handover`)는 RoleGuard 없음 + RLS `authenticated`/`using(true)` →
> admin·coordinator 등 **역할 무관 동일 동작**. 두 역할 모두 브라우저 UI로 실증함.

## 스크린샷

### 관리자 계정 흐름
- `01-board-rendered.png` — 보드 렌더("직원 근무 캘린더", schema-cache 에러 0)
- `02-dialog-filled.png` — AC-3 작성 다이얼로그: 파트(치료사)+메모+체크리스트 2건 입력
- `03-saved-on-board.png` — 저장 직후 카드·배지 보드 반영(캘린더 반영)
- `04-reentry-board.png` — **전체 페이지 리로드 후** 보드에 카드 재조회(DB 영속)
- `05-reentry-dialog-persisted.png` — 카드 재오픈 다이얼로그
- `05b-reentry-dialog-zoom.png` — **(핵심)** 재오픈 다이얼로그 확대: 메모+체크리스트 2건 영속 확인

### 비-admin coordinator(일반직원) 흐름
- `coord-01-board.png` ~ `coord-04-reentry.png` — 동일 4단계
- `handover-ui-coordinator.webm` — 전체 영상

### 영상
- `handover-ui-flow.webm` — 관리자 계정 전체 UI 흐름 녹화
- `handover-ui-coordinator.webm` — coordinator 계정 전체 UI 흐름 녹화

## supervisor 직접 재현 방법 (Option 1)

`obliv-foot-crm` 레포 루트에서 (.env에 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 필요):

```bash
# 관리자 계정 UI 재현 (스크린샷 자동 생성)
node scripts/evidence_handover_ui_prod.mjs

# 비-admin 일반직원(coordinator) UI 재현 (임시계정 생성→삭제, SERVICE_ROLE_KEY 필요)
node scripts/evidence_handover_ui_coordinator.mjs
```

- **QA 계정**: `test@medibuilder.com` / `$TEST_PASSWORD` (role=admin, 종로 풋센터)
- 스크립트가 로그인 세션을 주입하므로 supervisor는 별도 storageState 없이 즉시 실행 가능.
- 모든 검증 데이터·임시계정은 종료 시 자동 삭제(실데이터 0건 유지).

## 데이터 레이어 동반 증빙
- `scripts/verify_handover_ac34_prod.mjs` — node-pg(테이블/RLS/8정책/트리거) + authenticated 라운드트립 + 비-admin coordinator 라운드트립.
