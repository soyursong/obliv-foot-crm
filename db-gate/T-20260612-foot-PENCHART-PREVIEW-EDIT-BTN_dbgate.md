# T-20260612-foot-PENCHART-PREVIEW-EDIT-BTN — AC-1 diff-first 결과 + DB게이트 승격

작성: dev-foot · 2026-06-12 · repo: obliv-foot-crm
상태: **BLOCKED — supervisor DB게이트 + planner 스펙 결정 대기** (코드 미커밋)

---

## 0. 요청 요약
펜차트 미리보기 창(2번 차트 펜차트 탭)에 '수정' 버튼 추가.
- AC-2 버튼 추가 / AC-3 기존 기입 그대로 재오픈 / AC-4 지우고 재작성(양식 구조 불변)
- AC-5 저장 = 기존 레코드 덮어쓰기(update), 미리보기 1건만(신규 row 누적 금지)
- AC-6 노출 권한 = 기존 삭제/내려받기 게이트 재사용
- **AC-1(diff-first 의무): 저장이 update인지 insert인지 먼저 확인. update 경로 부재면 DB게이트 승격, 임의 신규 row 생성 금지.**

---

## 1. AC-1 diff-first 분석 (코드 근거)

### 1-1. 펜차트 "레코드"의 실체 = Storage 파일 (DB 테이블 아님)
- 미리보기 목록(`savedCharts`)은 **DB 조회가 아니라 `supabase.storage.list()`** 결과다.
  `PenChartTab.tsx:904 loadSavedCharts()` → `storage.from('photos').list(storagePath)`.
- `storagePath = customer/${customerId}/pen-chart` (L869).
- `SavedChart = { name, url, uploadedAt }` (L76) — `uploadedAt`은 파일명 앞 timestamp 파싱(L915).
- **펜차트 1건 = storage PNG 파일 1개.** 펜차트 전용 DB 테이블 없음.

### 1-2. 저장 = 항상 신규 파일 업로드 (update 경로 0)
- `PenChartTab.tsx:2245` `fileName = ${prefix}${Date.now()}_${random}.png` → **매 저장마다 유니크 파일명**.
- `L2247` `storage.upload(path, blob, { upsert: false })` → **항상 새 파일**. 덮어쓰기/update 경로 **부재**.
- 결론: **미리보기 레코드(storage)에 update 경로 없음.** 현 동선에서 '수정 후 저장'은 2번째 파일을 만들어
  **미리보기 2건 누적**을 일으킨다 → AC-5 위반.

### 1-3. form_submissions 연동 = insert 전용 (DB row)
- 양식형 차트(발건강질문지 HQ / 환불동의서 RC / 개인정보·체크리스트 PCL)만 `L2277`
  `supabase.from('form_submissions').insert(submissionPayload)` 실행. `canvas_file: fileName` 로 storage 파일 참조.
- **순수 펜차트(`form_key='pen_chart'`)는 form_submissions 미생성** — storage 파일만.
- update 경로 **부재** — 매 저장 insert. 수정 후 저장 시 **form_submissions row 중복 생성** = AC-1 "임의 신규 row 생성" 금지 대상.

### 1-4. 삭제 = 순수 storage remove
- `L2318 handleDelete` → `storage.remove([path])`. DB 무관.

---

## 2. AC-1 판정

| 대상 | update 경로 | 수정-저장 시 현 동선 결과 | 게이트 |
|------|------------|--------------------------|--------|
| 미리보기(storage PNG) | **없음** (upsert:false, 유니크 파일명) | 파일 2개 누적 (AC-5 위반) | storage 처리로 해소 가능 (원본 delete) — **DB게이트 불요** |
| form_submissions(양식형) | **없음** (insert 전용) | row 중복 생성 (AC-1 금지) | **supervisor DB게이트 필요** |

→ **AC-1 명령대로 supervisor DB게이트 승격.** 임의 신규/중복 row 생성 코드 미작성.

---

## 3. 추가 블로커 (planner 스펙 결정 필요)

### B-1. AC-3/AC-4 "기존 기입 그대로 재오픈 + 지우고 재작성" — 아키텍처 제약
저장 PNG는 **배경(양식 템플릿) + 드로잉 레이어가 1장으로 평면 합성**된 결과다(`L2210~2232` tempCanvas 합성).
드로잉 레이어가 **별도 저장되지 않음**. 따라서 "기존 기입만 분리해 편집"은 현 구조로 직접 불가.
가능한 옵션(스펙 결정 요):
- (A) 저장 PNG를 **드로잉 레이어로 로드** + 빈 템플릿을 bg로 → 지우개로 합성내용 제거·재작성 가능.
  (템플릿 선이 bg/draw 중복되나 정렬 시 시각 무해). bg 파이프라인(블랙스크린 하드닝 영역) 미접촉 → 상대적 저위험.
- (B) 저장 PNG를 bg로 로드 → 지우개 무효(bg 보존 설계), 화이트툴 덮기만 가능 → AC-4 "지우고 재작성" 부분 충족.
- (C) 펜차트 저장 구조를 드로잉 레이어 별도 보관으로 변경 → 설계 변경(범위 큼).
**reporter 'AC-4 지우고 재작성 가능 + 양식 구조 불변' 충족엔 (A) 권장. planner 확정 요청.**

### B-2. 파일 동시수정 충돌 (티켓 명시 충돌 1건)
- `T-20260612-foot-PENCHART-PHRASE-INSERT-PINGPONG5`(in_progress)가 **같은 `PenChartTab.tsx`를 미커밋 WIP로 수정 중**
  (working tree에 uncommitted diff 67줄: initCanvas→initCanvasGraphics/resetDrawSession 분리).
- 본 작업도 동일 파일을 만져야 함 → **PINGPONG5 WIP 위에 커밋하면 두 작업이 엉킴.**
- → **PINGPONG5 커밋·머지 완료 후** 본 작업 착수가 안전. 머지 순서 조정 필요.

---

## 4. dev-foot 권고 (게이트 통과 시 구현안)
1. **순수 펜차트(pen_chart)**: 전 AC를 **storage-only**로 구현 가능 — 옵션(A) 재오픈 + 저장 시 원본 파일 delete(1건 유지). DB게이트 불요.
2. **양식형(HQ/RC/PCL)**: 수정-저장 시 form_submissions를 (a) 기존 row UPDATE(saved_at/canvas_file 갱신) 또는 (b) edit 시 insert 스킵 중 택1. **둘 다 DB 쓰기 동선 → supervisor 승인 후 진행.**
3. AC-6: 기존 삭제/내려받기 노출 게이트(미리보기 카드 권한) 재사용 — FE-only.

## 5. 결정 요청
- **supervisor**: 양식형 수정-저장의 form_submissions 처리 방식(UPDATE vs insert-skip) DB게이트 승인.
- **planner**: B-1 재오픈 방식(A/B/C) 확정 + B-2 PINGPONG5 머지 순서 조정.
- 확정 전 코드 미커밋(false deploy-ready 방지).
