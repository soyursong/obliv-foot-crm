---
id: T-20260603-foot-DOCTOR-CALL-DEFAULT-MEDTAB
domain: foot
priority: P1
hotfix: false
status: deploy-ready
deploy-ready: true
created: 2026-06-04
updated: 2026-06-04
implemented-by: dev-foot
reviewed-by: ~
build-ok: true
db-change: false
spec-file: tests/e2e/T-20260603-foot-DOCTOR-CALL-DEFAULT-MEDTAB.spec.ts
commit: d2ea1e1
repo-path: ~/Documents/GitHub/obliv-foot-crm (github.com/soyursong/obliv-foot-crm, branch main)
---

# T-20260603-foot-DOCTOR-CALL-DEFAULT-MEDTAB
## 진료알림판 환자 서랍 기본 진입 '기본차트' → '진료차트'

**요청자**: planner NEW-TASK (MSG-20260603-234922-guma)

### 배경
진료알림판(진료콜 명단 팝업, `DoctorCallListBar` / DOCTOR-CALL-POPUP-RELOC)에서
환자 이름을 클릭하면 `Dashboard.handleOpenChartFromList` → `ctxOpenChart`로
**'기본차트'(2번차트 서랍 = 펜차트)** 가 열렸다. 그러나 렌더 주석(#2)의 의도와
원장이 진료알림판에서 기대하는 첫 화면은 진단/경과/처방을 보는 **'진료차트'(MedicalChartPanel)** 였다.
DoctorCallDashboard는 이미 FOLLOWUP3 C-1에서 동일하게 정정되었고, 본 팝업 경로만 누락되어 있었음.

### 변경
- `src/pages/Dashboard.tsx`
  - `handleOpenChartFromList`: `ctxOpenChart(기본차트 서랍)` → `openMedicalChartById(진료차트)` 직접 오픈.
  - `openMedicalChartById` 헬퍼 추가 — 경쟁 시트(CheckInDetailSheet/CustomerChartSheet) 닫고
    MedicalChartPanel 단독 표시 (CHART-ROUTE-FIX AC-1 패턴 재사용).
  - customer_id 미연결 시 동일 클리닉·동일 이름 1건 자동 매칭 + check_in 연결 fallback **보존**.

### AC
- **AC-1**: 진료알림판 이름 클릭 → 진료차트(MedicalChartPanel) 기본 오픈.
- **AC-2**: customer_id 미연결 — 동명 1건 자동 매칭 → 진료차트 + check_in 연결. 2건↑/0건은 안내(회귀 방지).
- **AC-3**: 다른 진입점(고객관리·체크인 상세·카드 클릭 = `ctxOpenChart`)의 기본차트 서랍 기본탭(펜차트) **그대로 유지(회귀 0)**.

### 검증
- 신규 E2E `tests/e2e/T-20260603-foot-DOCTOR-CALL-DEFAULT-MEDTAB.spec.ts` — 6 케이스 pass (라우팅 정본 모사).
- `npm run build` PASS (✓ 3.58s, tsc 통과 — 다른 dev WIP는 stash 후 클린 베이스라인 검증).
- pre-push 차트 접근 심볼 가드 PASS.
- commit **d2ea1e1** push (27e553c..d2ea1e1 origin/main, Vercel 자동배포).
- db-change: false. 검증 URL: https://obliv-foot-crm.vercel.app
