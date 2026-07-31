---
id: T-20260731-foot-FOOTQST-POPUPWIN-BROKEN
domain: foot
priority: P1
type: BUG
status: deploy-ready
deploy-ready: true
assignee: dev-foot
reporter: 김주연 총괄 (U0ATDB587PV, C0ATE5P6JTH thread 1785470002.958289, 재현 스샷 20260731_131240.png / F0BM6G46WLC)
created: 2026-07-31
build: pass (npm run build ✓ built in 6.58s)
db_change: false
db_migration: none
db_gate: N/A — FE-only 함수 1개(openHealthQDocumentWindow) 오픈 로직 수정. 신규 컬럼·테이블·enum·RLS 0. health_q_results 조회(read-only)만, 저장/조회 쿼리 무변경 → §S2.4 데이터 정책 자문 게이트 비해당.
risk_verdict: GO
risk_reason: "FE-only, 저장/조회 로직 무변경. 변경 격리 = src/lib/healthQDocument.ts openHealthQDocumentWindow() 1함수. 근본원인=window.open features 문자열의 'noopener' → HTML 사양상 window.open()이 항상 null 반환 → document.write 정상경로 사장·blob fallback만 실행(갤탭서 빈화면/차단). 수정=noopener 제거해 반환 핸들로 직접 document.write, 핸들 실패 시에만 blob URL+anchor-click fallback. onClick은 이미 동기 컨텍스트(async 뒤 호출 아님)라 팝업차단 우회 유지. 두 호출부(CustomerChartPage L7913·L10097) 공통 함수라 단일 수정으로 전건 커버. read/DDL/supabase write 0. 롤백=브랜치 미머지(origin/main 무접촉)."
scenario_count: 6 (AC-1 별도창 정상오픈 document.write 실행·HTML기록 / AC-2 팝업차단 핸들null→blob fallback / AC-2b 완전차단→anchor-click 최후fallback / AC-3 소스 noopener 재유입 금지 회귀가드 / AC-4 read-only DB write 경로 부재) — 6 passed.
e2e_spec: tests/e2e/T-20260731-foot-FOOTQST-POPUPWIN-BROKEN.spec.ts
spec: tests/e2e/T-20260731-foot-FOOTQST-POPUPWIN-BROKEN.spec.ts
commit: b93d8c41f56258c142d111b9bdb11c6757a918dd (branch fix/T-20260731-foot-FOOTQST-POPUPWIN-BROKEN, origin push 완료) — origin/main merge = supervisor QA 게이트 대기
deployed_at: 미배포 (self-deploy 금지 — supervisor QA/배포 게이트). 배포 후 pages.dev/version.json commit == origin/main HEAD 확인.
bundle_hash: 로컬 build (npm run build ✓)
medical_confirm_gate: N/A — 자가작성 발건강질문지 뷰어([별도창] 버튼, 2번차트 상담내역). 진료대시보드·진료관리(의사 영역) 무접점 → §11 컨펌 게이트 비대상. (진료의 문진이 아닌 고객 셀프접수 제출물 열람)
summary: 발건강 질문지 [별도창] 버튼 클릭해도 별도창(팝업/새 탭) 미오픈. 근본원인=window.open features의 noopener가 반환핸들을 null로 만들어 document.write 정상경로 사장. noopener 제거+fallback 강건화로 복구. FE-only, db_change=false.
---

# T-20260731-foot-FOOTQST-POPUPWIN-BROKEN — 발건강질문지 [별도창] 버튼 미오픈 버그

## 증상
발건강 질문지 화면(2번차트 상담내역)에서 '별도창 보기' 버튼 클릭해도 별도창(팝업/새 탭)이 안 열림. 현장 사용 불가.
- reporter: 김주연 총괄(U0ATDB587PV), 채널 C0ATE5P6JTH, thread 1785470002.958289
- 재현 스샷: 20260731_131240.png (F0BM6G46WLC)

## 근본원인 (진단 순서 힌트 대조)
1. 버튼 onClick 미연결/JS 에러 → **아님**. onClick={() => openHealthQDocumentWindow(...)} 정상 연결·동기 컨텍스트.
2. window.open URL 오류(빈값·404·라우팅) → **아님**. 라우트 URL이 아니라 document.write 문서 렌더 방식.
3. 팝업 차단(async 후 호출) → **부분 연관**. 그러나 onClick은 이미 동기. 진짜 원인은 아래 4.
4. 라벨티켓 diff → 무관(HealthQMobilePage만 건드림).

**★확정 근본원인**: `openHealthQDocumentWindow()` 가
`window.open('', '_blank', 'width=900,height=1000,noopener')` 로 호출.
HTML 사양상 features(3번째 인자) 문자열에 `noopener` 가 있으면 `window.open()` 은 **항상 `null`** 반환.
→ 반환 핸들 `win` 이 언제나 null → `win.document.write(html)` 정상 경로가 **절대 실행 안 됨** → blob fallback만 타게 되고, 갤탭 브라우저에서 blob 새탭이 빈화면/차단으로 "별도창이 안 열림" 관측.

## 수정 (src/lib/healthQDocument.ts)
- features 문자열에서 `noopener` 제거 → 반환된 `win` 핸들에 직접 `document.write` (가장 신뢰도 높은 경로).
- 핸들 확보 실패(진짜 팝업차단) 시에만 blob URL 새 탭 → 그것도 실패 시 동기 유저제스처 내 anchor-click 최후 fallback로 강건화.
- read-only 유지 — 문서 HTML write만, health_q_results 조회 외 저장/변형 경로 없음.

## AC 대조
- [x] 버튼 클릭 시 별도창 정상 오픈 (document.write 경로 실행 — AC-1)
- [x] 질문지 내용 렌더(빈화면/404 아님) — HTML write 확인 (AC-1)
- [x] 팝업차단 환경서도 오픈 (blob + anchor fallback — AC-2/AC-2b)
- [x] 저장/조회 로직 무변경 (read-only 가드 — AC-4)
- [x] noopener 재유입 회귀 가드 (소스 레벨 — AC-3)

## 검증
- `npm run build` ✓ (6.58s)
- e2e: tests/e2e/T-20260731-foot-FOOTQST-POPUPWIN-BROKEN.spec.ts 6 passed
- 회귀: sibling T-20260606-foot-CHART2-FOOTQ-VIEWER.spec.ts 7 passed

## 배포
- branch: fix/T-20260731-foot-FOOTQST-POPUPWIN-BROKEN (push 완료)
- commit: b93d8c41f56258c142d111b9bdb11c6757a918dd
- origin/main merge + CF Pages 배포 = supervisor QA 게이트 (self-deploy 금지)
