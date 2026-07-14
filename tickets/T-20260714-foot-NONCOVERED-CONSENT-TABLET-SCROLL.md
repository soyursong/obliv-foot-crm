---
id: T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL
domain: foot
priority: P1
hotfix: false
status: deploy-ready
qa_result: pending (supervisor QA/bundle 검증 대기)
db_change: false
db_migration: none
db_gate: N/A — CSS 한정(className만 변경). 신규 컬럼·테이블·enum 0, data-write 0 → DA CONSULT 불요.
build: pass (npm run build ✓ built in 5.39s)
scenario_count: 3 (S1 태블릿 정상동선 AC-1/AC-2 + 旧구조 대조) + 1 (S2 PC 회귀 AC-3) + 3 (소스 정적 가드) = 7 PASS
e2e_spec: tests/e2e/T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL.spec.ts
spec: tests/e2e/T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL.spec.ts
deploy_commit: aff7f140
deployed_at: n/a (NOT yet deployed — supervisor QA/운영 번들 검증 대기)
bundle_hash: ConsentFormDialog → CustomerChartPage / CheckInDetailSheet 청크에 인라인 (supervisor 운영배포 후 재검증)
created: 2026-07-14
completed: 2026-07-14
assignee: dev-foot
reporter: planner (MSG-20260714-111411-1qwc)
---

# T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL

## 증상
비급여동의서 서명 화면에서 **태블릿 스크롤 불가** → 하단 내용·[서명 완료] 버튼 미노출.
- PC 정상 / 태블릿(iPad 768×1024, 가로·세로) 재현. 운영 중 서명 프로세스 직접 영향.
- 화면 경로: 동의서 목록 → "비급여동의서" 클릭 → 서명 뷰 (`ConsentFormDialog`, formType=`non_covered`)

## 원인 (실측 확인)
`ConsentFormDialog` 의 `DialogContent` 가 `-translate-y-1/2` 중앙정렬 fixed 팝업에
`max-h-[90vh]` + **팝업 전체 단일 `overflow-y-auto`** 를 사용.
태블릿 브라우저는 크롬(주소창 등)을 포함해 `vh` 를 과대계산 → 90vh 박스가 가시 뷰포트를
초과 → 중앙정렬 특성상 푸터([서명 완료])가 화면 밖(하단)으로 밀려 접근 불가.
PC 는 `vh`==가시영역이라 정상.

## 픽스 (CSS 한정)
`src/components/ConsentFormDialog.tsx` DialogContent 구조만 변경:
1. `max-h-[90vh]` → `max-h-[90dvh]` — 동적 뷰포트(가시영역) 기준. 데스크톱에선 `dvh==vh` → **PC 회귀 0**.
2. flex 컬럼 구조 — 헤더/푸터 `shrink-0`, 본문만 `flex-1 min-h-0 overflow-y-auto`.
   → 본문이 아무리 길어도 [서명 완료] 푸터는 박스 하단에 **항상 고정 노출**.
- 로직·data-testid·저장 경로 전부 불변. DB/스키마 무변경.

## AC 충족
1. ✅ 태블릿에서 전체 내용 스크롤 가능 (본문 `flex-1 min-h-0 overflow-y-auto` + `90dvh` 캡)
2. ✅ [서명 완료] 버튼이 내용 아래 정상 위치 고정 노출·동작 (`shrink-0` 푸터)
3. ✅ PC 동작·레이아웃 회귀 0 (`dvh==vh` on desktop)

## E2E
`tests/e2e/T-20260714-foot-NONCOVERED-CONSENT-TABLET-SCROLL.spec.ts` (unit 프로젝트, **7 PASS**)
- S1 태블릿 768×1024: 본문 스크롤 + 푸터 항상 노출 (`page.setContent` 실 DOM 측정)
- S2 PC 1280×800: 레이아웃/푸터 회귀 0
- 旧 90vh 단일-스크롤 구조 대조(초기 렌더 푸터 폴드 아래 밀림 → 픽스 당위 재현)
- `ConsentFormDialog.tsx` 소스 정적 가드 (dvh + flex 컬럼 + shrink-0 푸터 채택, 旧 90vh 제거)

## 리스크
GO — CSS 한정, DB변경 없음. 데스크톱 `dvh==vh` 로 PC 회귀 없음.

## commit
- `aff7f140` fix(foot): 비급여동의서 서명 뷰 태블릿 스크롤 불가 픽스 (vh→dvh + flex 컬럼)
