---
id: T-20260615-foot-DOCDASH-COLGROUP-E2E-STALE-RECONCILE
title: "[진료알림판] DoctorCallDashboard(B) colgroup 폭/합100 stale E2E 6건 정합(가설A)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 8c80e02d
impl_commit: 8c80e02d
created: 2026-06-16
assignee: dev-foot
reporter: planner
source_msg: MSG-20260615-191122-ui00
needs_field_confirm: false
related_tickets:
  - T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN
  - T-20260614-foot-DOCPATIENTLIST-COLWIDTH-RATIO-TUNE
  - T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT
  - T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP
---

# T-20260615-foot-DOCDASH-COLGROUP-E2E-STALE-RECONCILE

## 배경

DASHCOL-REALIGN 작업 중 발견(FOLLOWUP MSG-20260615-190607-s4dk). DoctorCallDashboard(B)
colgroup 폭/합100 검증 E2E 6건이 pre-existing stale 로 실패:
- COLWIDTH-RATIO-TUNE 4건 (S1 feed / S2 completed / S3 임상경과 재분배 / AC-3 provenance-count)
- COLWIDTH-EXPAND-QUICKEDIT 2건 (AC-1 대기·완료 colgroup)

## 진단 (맹목 spec 갱신 금지 가드 준수)

배포 정본(commit aa2e7819) B colgroup 실측:
- feed     = `[4, 8, 7, 9, 8, 9, 18, 32, 5]` (9칼럼) → 합 **100**
- completed = `[4, 8, 7, 9, 8, 9, 18, 32, 5]` (9칼럼) → 합 **100** (feed 와 글자그대로 동일)

순서: 방·상태·이름·생년(만나이)·차트번호·오늘시술·처방·임상경과·시간.

**합==100 & 시각정상 → 가설A** 채택. 6건 실패 원인은 spec 기대값이 5개 후속 티켓으로
'합법' supersede 된 과거 모델을 인코딩하고 있던 것:

```
EXPAND-QUICKEDIT([5,9,11,9,8,9,6,24,14,5]/[5,10,12,9,8,9,6,25,16])
 → RATIO-TUNE([4,7,6,9,8,9,6,12,34,5], ×0.75/×0.50)
 → STATNAME-WIDEN-CENTER(상태7→8·이름6→7·임상경과34→32)
 → WAITDONE-ALIGN(완료=대기 글자그대로 동일 colgroup)
 → NAME-EMOJI-CLINICAL-3FIX item2('차트' 칼럼 6% 제거: 10칼럼→9칼럼, 임상경과 32→38)
 → RX-DISPLAY-REVAMP item3(처방 12→18 ×1.5, 임상경과 38→32)
```

가설B(합100 복구)는 불필요 — 현 정본이 이미 합100·시각정상.

## 조치 (spec-only, src/DB 무변경)

1. 기대 colgroup 배열을 deployed truth `[4,8,7,9,8,9,18,32,5]` 로 갱신
   (baseline commit aa2e7819 + 측정근거 + supersede chain 주석 명기).
2. supersede 된 단언 제거: RATIO-TUNE ×0.75/×0.50 비율식, idx8 임상경과(10칼럼 인덱싱), '처방 최대'.
3. 유지한 불변 invariant: 합100 / 임상경과(idx7) 본문우선 최대폭 / 식별군 5칸 ≤50% / 완료==대기 정합.
4. AC-3 provenance-count(`COLWIDTH-RATIO-TUNE`==2) brittle 단언 → `≥1`(이력 보존)으로 완화
   (완료 colgroup 주석이 WAITDONE-ALIGN 으로 재작성되며 1곳만 잔존).
5. AC-2/AC-3 구조 회귀 가드(ColumnExpandPopover·formatRxItemToken·QuickRxBar split)는 무변경 — 기존 PASS 보존.

DoctorPatientList(A) 변경 0.

## 검증

- `T-20260614-foot-DOCPATIENTLIST-COLWIDTH-RATIO-TUNE.spec.ts` + `...-EXPAND-QUICKEDIT.spec.ts`: **16/16 PASS** (이전 10P/6F).
- DASHCOL-REALIGN spec 9/9 PASS (precondition 확인, FIX 완료).
- src/DB 무변경 → main 빌드 상태 불변(spec-only).

## commit

- 8c80e02d — test(foot): stale E2E 6건 정합(가설A)
