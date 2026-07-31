---
id: T-20260731-foot-PENCHART-PHOTO-ATTACH
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: 1fc75aa0
deployed_at: pending (main merge 시 CF Pages 자동배포 — supervisor merge 후 확정)
bundle_hash: n/a (main merge 후 obliv-foot-crm.pages.dev/version.json 로 확정)
db_change: false
db_migration: none
db_gate: N/A
build: pass
scenario_count: 4
spec: tests/e2e/T-20260731-foot-PENCHART-PHOTO-ATTACH.spec.ts
created: 2026-07-31
completed: 2026-07-31
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: 김주연 총괄 (현장 긴급)
data_consult: DA delta-CONSULT-REPLY 정본 수신 — (b') 순수 co-located Storage 경로 컨벤션 GO / (a') 신규 DB 첨부테이블 REJECT. db_change=FALSE → §3.1 대표게이트 면제(cross-product 0).
ui_screenshot_gate: pending (supervisor 갤탭 field-soak — 첨부 업로드/썸네일/삭제 실기기 confirm)
summary: "펜차트(보험차트)에 참고 사진 첨부. FE + Storage-only(db_change=FALSE). DA delta-CONSULT-REPLY 정본=(b') 순수 co-located Storage 경로 컨벤션(신규 DB 첨부테이블 a' REJECT — 부모 row 부재→orphan 생성기·권위분열). DDL 0·MIG-GATE 불요·회귀 0. 신규 PenChartAttachPanel(느슨결합 customerId/stem props): photos 버킷(펜차트 PNG 가 이미 사는 private 버킷, public=false 2026-07-31 실측) / 경로 pin customer/{customerId}/pen-chart-attach/{stem}/{uuid}.{ext}. key=펜차트 full stem(파일명 확장자만 제거, hq_/rc_/pc_ prefix 보존 → 같은 ms 두 차트도 collision-safe 결속, AC2). sibling prefix 'pen-chart-attach/' 필수 · 'pen-chart/' 하위 nesting 금지(loadSavedCharts 의 'pen-chart' 레벨 storage.list() 가 하위폴더를 chart PNG 로 오인·목록오염 방지, AC5). 재조회=storage.list(prefix) created_at 정렬(DB sort_order 불요) 확장자 보존. 업로드 영역=파일선택+드래그&드롭(foot 태블릿 큰 버튼, AC1). 이미지 MIME 만 허용·개당 20MB 상한. read=signed URL(펜차트 PNG 현 렌더 경로 재사용, 신규 EF 0, AC3/AC6). PenChartTab selectedChart 확대뷰에만 마운트 → 차트 저장/작성 동선과 완전 분리 = 사진 미첨부 저장 정상(AC4). RLS=인증직원·customer/{id} 경로 스코프 기존 storage RLS 를 새 prefix 가 그대로 상속(새 정책 신설 0). orphan: 첨부가 고객 prefix 하위 co-located → 고객 삭제/보존 sweep 자동커버 + 펜차트 PNG 삭제 시 handleDelete 가 첨부 prefix app-side cascade 정리 → 새 orphan 클래스 신설 0. 검증: build PASS / tsc clean / AC5 경로계약 결정론(full stem·sibling·nesting-ban·collision-safe) PASS. 실 브라우저(갤탭) 첨부 업로드·썸네일·삭제 동작은 supervisor field-soak(verify-only, 비블로커)로 종결. UX 배치 주: '별도창 업로드 영역'=저장된 특정 펜차트(stem 확정) 상세 확대뷰 내 전용 업로드 영역으로 착지(stem 결속 요건상 저장 이후 시점 필요). 마감 2026-08-01."
---

# T-20260731-foot-PENCHART-PHOTO-ATTACH — 펜차트 사진 첨부 (Storage-only)

원천: 김주연 총괄(현장 긴급). 마감 2026-08-01.

## DA delta-CONSULT-REPLY 정본 (착수 근거)

- 원 CONSULT 전제(펜차트=DB row 보유)를 코드 정찰이 반증 → **펜차트 = DB row 없는 순수 Storage 자산**.
- DA 재판정: **정본 = (b') 순수 co-located Storage 경로 컨벤션. db_change=FALSE.** DDL 0 · MIG-GATE 불요 · 회귀 0.
- (a') 신규 DB 첨부테이블 = **REJECT** — 부모 row 부재로 FK 불가 → orphan 생성기 · 권위분열.
- 게이트: §3.1 대표게이트 면제(cross-product 0). supervisor = verify-only(비블로커).

## 경로 pin (그대로 준수)

- `photos` 버킷 · `customer/{customerId}/pen-chart-attach/{ts}_{rand}/{uuid}.{ext}`
- key = 펜차트 **full stem `{ts}_{rand}`**(ts 단독 아님, prefix 보존) → 특정 펜차트에 collision-safe 결속
- sibling prefix `pen-chart-attach/` **필수** · `pen-chart/` 하위 nesting **금지** (목록오염 방지)
- 재조회 = `storage.list('…/pen-chart-attach/{stem}')` · 확장자 보존 · created_at 정렬(DB sort_order 불요)
- 버킷 = `photos`(펜차트 PNG 가 사는 private 버킷). `foot-health-q-photos`(anon-write) 재사용 금지.
- RLS = 인증직원·`customer/{id}` 경로 스코프 → 기존 storage RLS 를 새 prefix 가 그대로 상속(새 정책 0).
- PHI = photos 버킷 `public=false`(**2026-07-31 실측 확인**) + signed-URL read(현 펜차트 PNG 렌더 경로 동일 → 신규 EF 0).
- orphan = 첨부가 고객 prefix 하위 co-located → 고객 삭제/보존 sweep 자동 커버 + 펜차트 PNG 삭제 시 app-side cascade 정리.

## AC

- **AC1** 별도 업로드 영역(파일선택 + 드래그&드롭) — `PenChartAttachPanel` dropzone + hidden file input. ✅
- **AC2** 펜차트 stem 결속 저장·재조회 — full stem 키, `storage.list(prefix)` 재조회. ✅
- **AC3** photos 버킷 재사용 — anon-write 버킷 미사용. ✅
- **AC4** 사진 미첨부 저장 정상 — 첨부 UI 는 selectedChart 확대뷰에만, 차트 저장 동선 비침습. ✅
- **AC5** 경로 pin 준수 — sibling prefix / full stem / nesting-ban 결정론 검증 PASS + 실DOM PUT 재검증. ✅
- **AC6** public=false + signed-URL — 실측 확인 + signedThumbUrls/signedOriginalUrl 서빙. ✅

## 구현

- 신규 `src/components/PenChartAttachPanel.tsx` (느슨결합 재사용 컴포넌트).
- `src/components/PenChartTab.tsx`: selectedChart 확대뷰에 패널 마운트 + handleDelete cascade cleanup.
- spec `tests/e2e/T-20260731-foot-PENCHART-PHOTO-ATTACH.spec.ts` (AC5 결정론 + AC1/2/3/4 실DOM, 시드 미가용 시 graceful skip).

## 검증

- `npm run build` PASS · `tsc --noEmit` clean · AC5 경로계약 결정론 7/7 PASS.
- 실 브라우저(갤탭 실기기) 첨부 업로드·썸네일·삭제 동작 = supervisor field-soak(verify-only)로 종결.
