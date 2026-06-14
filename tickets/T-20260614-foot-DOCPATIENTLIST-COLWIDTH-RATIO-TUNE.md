---
id: T-20260614-foot-DOCPATIENTLIST-COLWIDTH-RATIO-TUNE
title: "[진료환자목록] 테이블 4컬럼 비율 축소 — 방·상태 ×0.75 / 이름·처방 ×0.5, 해방분 임상경과 재분배"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 8d804dc
impl_commit: 8d804dc
created: 2026-06-14
assignee: dev-foot
reporter: 문지은(대표원장)
source_msg: MSG-20260614-235155-toa0
needs_field_confirm: true
supersedes:
  - T-20260614-foot-LISTCOL-WIDTH-SHRINK
related_tickets:
  - T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT
  - T-20260613-foot-DOCDASH-CALLUX-3FIX
---

# T-20260614-foot-DOCPATIENTLIST-COLWIDTH-RATIO-TUNE

## 신고

진료환자목록 테이블(`DoctorCallDashboard`)의 식별/보조 컬럼이 과폭 → 본문(임상경과) 협소.
LISTCOL-WIDTH-SHRINK(취소)의 canonical 대체. EXPAND-QUICKEDIT 배포본(commit f8ad7a9,
bundle DoctorTools-DJDZh6-y.js) 기준 4개 컬럼 비율 축소.

## AC

- **AC-1** 비율 축소(두 테이블 colgroup 모두): 방 ×0.75 · 상태 ×0.75 · 이름 ×0.50 · 처방 ×0.50.
  - feed(10컬럼): 방 5→4 · 상태 9→7 · 이름 11→6 · 처방 24→12.
  - completed(9컬럼): 방 5→4 · 상태 10→8 · 이름 12→6 · 처방 25→13.
- **AC-2** table-fixed 합 100% hard 제약 — 해방된 ~20%p(feed) / ~21%p(completed)를 임상경과 본문에 재분배.
  - feed 임상경과 14→34, completed 임상경과 16→37. 나머지 컬럼(생년·차트번호·오늘시술·차트·시간) 불변.
- **AC-3** 신규 컴포넌트 생성 금지 — colgroup `<col className="w-[..]">` 값만 조정(CSS-only).
- **AC-4** 부모 AC-2 컬럼앵커 드롭다운(처방/임상경과 전문 팝오버)·AC-3 빠른수정 회귀 0. DoctorCallListBar.tsx 미터치.

## 구현

- `src/components/doctor/DoctorCallDashboard.tsx` — feed/completed 두 colgroup w-[..] 값만 조정.
  - feed:      `4·7·6·9·8·9·6·12·34·5` (합 100)
  - completed: `4·8·6·9·8·9·6·13·37`   (합 100)
- DB 변경 없음. CSS-only. 신규 컴포넌트 0.

## 검증

- `npm run build` ✓
- `tests/e2e/T-20260614-foot-DOCPATIENTLIST-COLWIDTH-RATIO-TUNE.spec.ts` — 6 case 전부 통과.
  - S1 호출 테이블 비율 축소 + 합 100
  - S2 완료 테이블 비율 축소 + 합 100
  - S3 임상경과 본문 우선 재분배(축소분=증가분, 불변 컬럼 보존) + AC-2 팝오버 회귀 0 + AC-3 빠른수정 회귀 0
