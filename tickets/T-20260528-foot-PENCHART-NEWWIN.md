---
id: T-20260528-foot-PENCHART-NEWWIN
title: "[새 펜차트 작성] window.open 별도 창 전환 + 보험차트 명칭 잔여 점검"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: TBD
created: 2026-05-28
deadline: 2026-06-03
assignee: dev-foot
reporter: 김주연 총괄
source_msg: MSG-20260528-094032-oh5e
related_tickets:
  - T-20260520-foot-PENCHART-FULLSCREEN
  - T-20260523-foot-PENCHART-INSURANCE
risk_verdict: GO
---

# T-20260528-foot-PENCHART-NEWWIN — 펜차트 [새 차트 작성] → window.open 별도 창

## 배경

김주연 총괄 요청. fullscreen modal(PENCHART-FULLSCREEN) 방식에서 window.open 별도 브라우저 창으로 전환.
고객이 뒤로가기 시 차트 내용 노출 우려 해소.

## 구현 내역

### AC-1: window.open 별도 창 전환

#### 새 파일
- `src/pages/PenChartEditorPage.tsx` — 팝업 전용 펜차트 편집 페이지
  - URL: `/penchart-editor?customerId=...&clinicId=...&checkInId=...`
  - Supabase에서 고객 정보(이름/생년월일/차트번호/주민번호) 직접 로드
  - `<PenChartTab popupMode />` 렌더
  - 저장 후: `BroadcastChannel('penchart-update')` 브로드캐스트 + `window.close()`

#### App.tsx
- `PenChartEditorPage` lazy import 추가
- `/penchart-editor` 라우트 등록 (ProtectedRoute 래핑)

#### PenChartTab.tsx 변경
- `popupMode?: boolean` prop 추가 (기본값 false)
- 초기 모드: `popupMode ? 'select' : 'list'`
- BroadcastChannel 리스너 useEffect: `penchart-update` 수신 → `loadSavedCharts()` (부모 창 목록 갱신)
- "새 차트 작성" 버튼: `window.open('/penchart-editor?...', 'penchart-{id}', 'width=1200,height=900,...')`
  - 팝업 차단(iPad Safari) 시 fallback: `setMode('select')` (기존 fullscreen modal)
- 저장 완료 후 popupMode: BroadcastChannel 브로드캐스트 + `setTimeout(window.close, 150)`
- "목록으로" 버튼(select 모드): `popupMode ? window.close() : setMode('list')`, 라벨도 "닫기"로 전환
- "취소" 버튼(draw 모드): `popupMode ? window.close() : setMode('list')`
- FullscreenFormWrapper onOpenChange: `popupMode ? window.close() : setMode('list')`

### AC-2: "펜 차트 양식" / "펜차트 양식" 잔여 UI 텍스트 점검

grep 결과:
- `CheckInDetailSheet.tsx` 1146·1610줄: 코드 주석 (UI 미노출)
- `PenChartTab.tsx` 138줄: 코드 주석 (UI 미노출)
- `supabase/migrations/*.sql`: SQL 주석·rollback 템플릿 (UI 미노출)

→ **사용자에게 노출되는 UI 텍스트 없음 → PASS**

## AC 체크

- [x] AC-1: [새 차트 작성] → window.open 별도 창. 저장 후 부모 창 펜차트 목록 BroadcastChannel 반영
- [x] AC-1-팝업차단: iPad Safari 팝업 차단 시 setMode('select') fallback
- [x] AC-1-뒤로가기: 팝업 창에서 "닫기/취소/ESC" → window.close()
- [x] AC-2: "펜 차트 양식" 잔여 UI 텍스트 없음 (주석만 존재) → PASS
- [x] 빌드 OK (3.59s, TypeScript 오류 없음)
- [x] E2E spec 추가 (`tests/e2e/T-20260528-foot-PENCHART-NEWWIN.spec.ts`)

## DB 변경

없음 (FE 라우팅 + 컴포넌트 로직 변경만)

## 빌드

`npm run build` ✓ 3.59s
