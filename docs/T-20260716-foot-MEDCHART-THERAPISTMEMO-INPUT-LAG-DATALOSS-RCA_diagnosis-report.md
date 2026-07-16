# RCA — 치료사 메모 입력 렉 + 데이터 유실

- **티켓**: T-20260716-foot-MEDCHART-THERAPISTMEMO-INPUT-LAG-DATALOSS-RCA (RCA 진단 전용)
- **reporter**: 김주연 총괄 (풋센터)
- **작성**: dev-foot / 2026-07-16
- **증거**: `~/file_inbox/20260716/075422_F0BHL4MJQR2_IMG_8231.MOV` (11초, 2fps 22프레임 분석)
- **대상 코드(원본/HEAD 기준)**: `src/pages/CustomerChartPage.tsx` (10,771줄, useState 201개)
- **성격**: 코드/데이터 변경·배포 없음. 원인 규명 + 유실 경로 특정 + 복구 판정만.

---

## 0. 영상으로 확정한 재현 동작 (추정 아님)

- 화면 = 고객차트(`SMART DOCTOR — 고객정보`), Edge 팝업창(`/chart/:id`), 태블릿/노트북.
- 우측 메모 패널에 **`새 메모 추가` textarea + `메모 추가` 버튼**, 저장 진행 중 버튼 라벨이 **`저장 중…`** 로 바뀜, 하단 `메모 이력`.
- **영상의 `저장 중…` = autosave가 아니라 `메모 추가` 버튼 클릭 후 INSERT await 동안의 버튼 라벨.** (코드 `{savingNewMemo ? '저장 중…' : '메모 추가'}` 로 확정) → **autosave 자체가 없음.**

---

## 1. 증상 (a) 입력 렉 — 근본원인 (확정, 고신뢰)

**god-component 부모 상태에 입력값이 있어 키 입력마다 10,771줄 부모 전체가 재렌더된다.**

- 치료메모 입력 상태 `newMemoText` 가 **부모 `CustomerChartPage`(201 useState)** 에 존재
  (`CustomerChartPage.tsx:2711` — `const [newMemoText, setNewMemoText] = useState('')`).
- textarea 가 부모 상태를 직접 바인딩: `value={newMemoText} onChange={(e)=>setNewMemoText(e.target.value)}` (원본 `:8591`).
- ⇒ **키 한 자 = `setNewMemoText` = 부모 함수 본문 전체 재실행**(201 useState + 파생 배열연산 다수 `.map/.filter/.sort` 재계산 + 자식 트리 재조정).
- 한글 IME 조합은 자모마다 change 이벤트가 발생 → 재렌더 폭증. 태블릿/Edge 저사양에서 체감 렉 극대화.
- **확산**: 상담메모·예약메모도 동일 노출. `useMemoHistory` 훅(`:193`)의 `newText/editingText` useState가 **부모 CustomerChartPage 렌더 안에서 실행**(`:2862` 예약, `:2878` 상담) → 커스텀 훅은 컴포넌트 경계를 만들지 않으므로 이들 입력도 키 입력 시 부모를 재렌더. **치료/상담/예약 3종 메모 입력이 같은 뿌리를 공유**(reporter가 특정한 것은 치료메모).

---

## 2. 증상 (b) 데이터 유실 — 유실 경로 특정

### 후보 매트릭스 (요청된 경로 전수 대조)

| 경로 | 판정 | 근거 |
|------|------|------|
| autosave race | **해당 없음** | autosave 미존재. INSERT는 `메모 추가` 명시 클릭에서만 발생(`saveNewTreatmentMemo`, `:4364`). |
| 저장 전 언마운트 flush 누락 (= 임시버퍼 부재) | **주원인** | `newMemoText`는 순수 React state, **어떤 영속(localStorage/sessionStorage/draft)도 없음**. 팝업창 닫기·새로고침·(훅형 메모는) 고객 전환 시 소멸 → 무흔적 유실. |
| stale value commit | 해당 없음 | 저장 함수가 매 렌더 재생성, 클릭 시점 최신값 참조. |
| 에러 swallow (신규입력) | 해당 없음 | INSERT 실패는 `toast.error` 노출 + 텍스트 유지(`setNewMemoText('')`는 성공시에만). **조용한 유실 아님.** |
| 저장 성공 후 잔여 입력 폐기 | **부차 원인** | 성공 시 `setNewMemoText('')` 무조건 실행 → INSERT await 창(렉으로 길어짐) 동안 추가 입력한 글자가 폐기됨. |
| **수정(edit) 경로 silent 0-row** | **부차 원인(2차)** | `saveTreatmentMemoEdit`이 `.update().eq('id',…)` 에 **`.select()` 없음**. 타인/이전기록(`created_by=null`) 메모를 비-admin이 수정하면 RLS `USING` 미매치 → **0행·에러없음** → FE는 낙관적으로 저장 성공 표시 → 새로고침 시 수정 증발. |

### DB read-only 대조 (SELECT only, 무변경)

- `customer_treatment_memos` **총 136행**, 최근 INSERT 2026-07-15 다수(임별/박소예/최민지/…) → **INSERT 경로 정상, 전역 조용한 쓰기실패 아님.**
- **soft-deleted 0행** → 확정 저장된 메모의 삭제/파괴 흔적 없음. **커밋된 기록은 온전.**
- `created_by=null`(= `(이전 기록)` lazy-migration) **28행** → 위 edit-silent-fail 위험 대상(비-admin이 수정 불가·무통보).

**결론**: reporter가 본 "유실" = **저장 클릭 전 작성 중(미커밋) 텍스트의 소멸**(임시버퍼 부재 + 렉으로 인한 이탈/새로고침/창닫기) 이 주경로. 부차로 (i) 저장 직후 잔여입력 폐기, (ii) 이전기록 메모 수정 silent 0-row. **DB에 커밋된 메모의 유실·파괴는 없음.**

---

## 3. 기존 유실 범위 + 복구 가능성

- **미커밋 작성중 텍스트**: 원본 코드에 어떤 영속도 없어 흔적 미존재 → **개별 건 열거 불가, 복구 불가**(애초에 어디에도 기록된 적 없음).
- **커밋된 메모**: soft-delete 0건, 파괴 0건 → **전량 온전, 복구 대상 없음.**
- **edit silent-fail 로 사라진 수정**: DB에 애초 기록되지 않음 → 복구 불가. 단 **원본 content는 DB에 그대로 보존**(수정이 반영 안 됐을 뿐, 원본 손실 아님).
- ⇒ **데이터 백필/복구 티켓 불필요.** 복구 flag: **없음(복구할 데이터 자체가 없음).**

---

## 4. FIX 티켓용 권고 (구현은 별도 티켓 — 본 RCA 범위 밖)

1. **입력 상태를 memoized 자식으로 격리** → 키 입력 시 부모 무재렌더 (렉 해소). **치료메모 뿐 아니라 상담·예약메모(useMemoHistory 훅형)도 동일 뿌리 → 3종 일괄 검토 권고.**
2. **작성중 텍스트 임시버퍼(고객별 key)** → 창닫기·새로고침·이탈에도 복원. PHI 잔류 방지 위해 sessionStorage(탭 종료 소멸) 권장.
3. **저장 성공 초기화는 "저장된 텍스트가 여전히 화면값과 동일할 때만"** → 잔여입력 폐기 방지.
4. **edit 경로 `.update().select()` + 0-row 감지** → silent-fail을 에러로 표면화(특히 `created_by=null` 이전기록/타인 메모).
5. **§11 게이트 재평가**: 치료메모=치료사(비의사) 대상이나 CustomerChartPage 공용 surface에 위치 → planner가 FIX 티켓에서 §11 진료관리 컨펌게이트 적용 여부 + db_change 여부 확정.

---

## 5. ⚠ 작업트리 위생 경보 (planner/supervisor 조치 필요)

현재 레포 작업트리에 **이 티켓의 FIX가 이미 미커밋 상태로 존재**하며, **다른 티켓 브랜치(`ticket/T-20260716-foot-EXPPASS-TREATTYPE-CHECK-EXPAND`) 위에 얹혀 있음**:

- `?? src/components/TreatmentMemoComposer.tsx` (신규, 미추적) — 위 권고 1·2·3 구현체
- ` M src/pages/CustomerChartPage.tsx` (수정, +53/-94) — 위 컴포넌트로 치료메모 입력 대체
- `?? tests/e2e/T-20260716-foot-MEDCHART-THERAPISTMEMO-INPUT-LAG-DATALOSS-RCA.spec.ts`

**주의**: 이 변경분은 치료메모만 다루고 상담·예약메모(§4-1)는 미포함일 수 있음(부분 FIX). **본 RCA는 진단 전용이라 커밋/배포하지 않았고 작업트리도 건드리지 않음.** EXPPASS 브랜치 커밋 시 혼입 위험 → FIX 티켓 분리 시 이 파일들을 정본으로 회수·검토할 것.
