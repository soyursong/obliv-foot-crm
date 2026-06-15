---
ticket_id: T-20260615-foot-CRM-FONT-PRETENDARD-GLOBAL
domain: foot
priority: P2
status: deploy-ready
block_reason: ''
requester: 김주연 총괄
risk: GO
owner: agent-fdd-dev-foot
approved_by: planner NEW-TASK MSG-20260615-101157-g0iz
stage_done: [firsthand-root-cause, code-verify, color-token-guard, AC5-admin-fullrender]
stage_pending: [supervisor-QA]
deploy-ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-15
db-change: false
build: pass
spec: tests/e2e/T-20260615-foot-CRM-FONT-PRETENDARD-GLOBAL.spec.ts (desktop-chrome 5 AC pass — :root 토큰=Pretendard·Geist 0·셀프접수 소스/색토큰/펜차트 Canvas폰트 무손상 + /admin 인증 실렌더 html·body=Pretendard)
qa_result: self-pass-pending-supervisor
---

# T-20260615-foot-CRM-FONT-PRETENDARD-GLOBAL — CRM 전역 폰트를 셀프접수(Pretendard)로 통일

## 요청 (김주연 총괄)
"추가로 CRM 전체 폰트 셀프접수에 적용했던 폰트로 변경해줘"

## firsthand 조사 — 티켓 가정 정정 (중요)
티켓 원안은 "src/index.css L11 `.theme { --font-sans }` 한 줄만 Geist→Pretendard로 바꾸면 전역 반영"이라 했으나, 실렌더 검증 결과 **그 경로는 admin에 전혀 적용되지 않았다**:

1. `.theme { --font-sans }` 토큰 — 마크업 어디에도 `.theme` 클래스가 부여된 적이 없음(App.tsx는 셀프접수용 `.theme-brown`만 사용). → Geist도 실제로는 admin에 적용 안 됨, Pretendard로 바꿔도 무효.
2. `html { @apply font-sans }` — Tailwind 기본 sans 리터럴(`ui-sans-serif, system-ui…`)을 굽어 `:root`의 `--font-sans` 토큰을 참조하지 않음. /admin 실측 body font = `ui-sans-serif…` (Geist도 Pretendard도 아니었음).

→ 실제 전역 적용을 위해 메커니즘 자체를 고침.

## 변경 (src/index.css만, db_changed=false)
1. `:root`에 `--font-sans: 'Pretendard', sans-serif;` + `--font-heading: var(--font-sans);` **재정의** (전역 스코프 — 실제 적용 지점).
2. `html` 규칙에 `font-family: var(--font-sans);` 직접 지정(`@apply font-sans` 후행 override) — 유틸리티가 굽는 기본 리터럴 대신 토큰을 실제 사용하게 강제.
3. `.theme { --font-sans }` 토큰값도 Pretendard로 정합(향후 `.theme` 적용 대비 일관성).
4. 참조처 사라진 `@import "@fontsource-variable/geist"`(dead) 제거.
   - npm 패키지 `@fontsource-variable/geist`는 package.json에 보존(의존성 제거는 별도 범위, 무해 dead-dep).
   - Pretendard는 index.html 전역 CDN 旣로드 → 추가 @import/패키지 0.

색/레이아웃/간격 토큰 변경 0 (THEME-WHITE-RESTORE / THEME-MONOCHROME-RECOLOR 작업분 무손상).

## AC 검증
| AC | 내용 | 결과 |
|----|------|------|
| 1 | 어드민 전 화면 본문·헤딩 Pretendard 렌더 (Geist 대체), 셀프접수와 동일 서체 | PASS — /admin 인증 실렌더 html·body=`Pretendard, sans-serif` |
| 2 | 셀프접수 화면 회귀 0 | PASS — index.html Pretendard CDN + `.theme-brown` 테마 무손상. (실 셀프접수는 별도 프로젝트 foot-checkin.pages.dev; 본 레포 /checkin은 deprecated 외부 리다이렉트 스텁 → 영향권 밖) |
| 3 | 펜차트 Canvas 자동삽입 성명(`ctx.font … "Malgun Gothic"`)은 명시 지정 → 영향 없음 | PASS — PenChartTab.tsx ctx.font 명시 지정 보존, .tsx 무변경 |
| 4 | 색 토큰(WHITE-RESTORE/MONOCHROME-RECOLOR) 무손상 | PASS — `--background/--card: oklch(1 0 0)` 등 색 토큰 미변경 |
| 5 | iPad Safari + Galaxy Tab 동일 렌더, 웹폰트 실패 시 sans-serif fallback | 토큰값 `'Pretendard', sans-serif` — fallback 내장. 실기기 육안은 field-soak |

## 테스트
- 빌드: `npm run build` PASS
- E2E: `tests/e2e/T-20260615-foot-CRM-FONT-PRETENDARD-GLOBAL.spec.ts` — desktop-chrome 5 AC PASS
- 회귀: THEME-WHITE-RESTORE / THEME-MONOCHROME-RECOLOR / SELFCHECKIN-FONT 동시 실행 26 pass.
  - SELFCHECKIN-FONT AC-3 1건 실패 = `/checkin/jongno-foot` 외부 리다이렉트(CHECKIN-OLDURL-DEPRECATE) 영향 — **본 변경 stash 제거 baseline에서도 동일 실패 재현 → 본 폰트 변경의 회귀 아님 확정.**
- 증적: `evidence/T-20260615-foot-CRM-FONT-PRETENDARD-GLOBAL_admin-render.png` (어드민 대시보드 Pretendard 실렌더, 색/레이아웃 무손상)

## 현장 확인 가이드 (field-soak)
- 어드민(대시보드/예약/고객/패키지/통계 등) 글씨체가 셀프접수와 같은 둥근 고딕(Pretendard)으로 보이는지.
- 색·버튼·표 위치·간격은 그대로(폰트만 바뀜)인지.
- 갤럭시탭 + 아이패드에서 동일하게 보이는지.
