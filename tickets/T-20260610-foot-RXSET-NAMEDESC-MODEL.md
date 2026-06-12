---
id: T-20260610-foot-RXSET-NAMEDESC-MODEL
title: "[처방세트] 2필드 모델([이름+용량]/[설명]) + 기존 19세트 약이름 자동이관"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: true
spec-added: true
spec-exempt: false
rollback-sql: migration_packages/T-20260610-foot-RXSET-NAMEDESC-MODEL/rollback.sql
commit_sha: 8db6350
created: 2026-06-12
assignee: dev-foot
reporter: 현장(문지은 대표원장) ESCALATE
source_msg: MSG-20260612-164915-6tk7
needs_field_confirm: true
data_consult: not-required（기존 JSONB 컬럼 데이터 정규화·신규 컬럼/테이블/enum 없음）
risk_verdict: BLOCK-supervisor-db-gate
related_tickets:
  - T-20260610-foot-RXSET-DRUGNAME-DISPLAY
superseded_policies:
  - RX-SET-FIELD-SCHEMA
  - RX-DOSAGE-3FIELD
---

# T-20260610-foot-RXSET-NAMEDESC-MODEL — 처방세트 2필드 모델 + 19세트 자동이관

## DECISION LOCK (dl53 Q1/Q2/Q3 해소)
- **Q1**: 처방세트 항목 = **[이름+용량] / [설명] 2칸**. route·용법·횟수·일수·용량 입력칸 세트등록 화면에서 제거(값 보존·숨김, 손실0). 용법(1/3/2)은 묶음·빠른처방 **불러올 때** 입력(비우면 빈칸).
- **Q2**: 설명(notes) 노출 = **세트관리·입력 상세화면 限**. 공식문서(처방전/타임라인)·미니멀목록 절대 미노출.
- **Q3 = A-1 자동이관**: `set.name`(약이름+용량) → `items[0].name`, 기존 `items[0].name`(분류) → `items[0].notes`(설명). 데이터손실0.

## 산출 (dev-foot)
### FE (순수 데이터 표시·입력, build OK)
- `PrescriptionSetsTab.tsx` ItemRow → [이름+용량](name, 마스터검색 유지) / [설명](notes) **2칸**. dosage/route/frequency/count/days 입력칸 제거(값 보존·EMPTY_ITEM 기본값 캐리). RxCountInput import 제거.
- 세트관리 카드 미리보기 → [이름+용량] + [설명]만(메타 제거, Q2).
- **MedicalChartPanel 미변경**: #2 용법 토큰(1/3/2) 인라인 편집표(L2920~) 기존 충족 = 불러올 때 입력(비우면 빈칸). RX-TOKEN-FORMAT 공존. 타임라인(L2677,2698)=약명+용량만(Q2 surface gate 충족).

### 마이그 (supervisor DB 게이트 · GO 전 파괴적 write 0)
- `migration_packages/T-20260610-foot-RXSET-NAMEDESC-MODEL/{datafix.sql, rollback.sql, dry_run_report.md}`
- `scripts/T-20260610-foot-RXSET-NAMEDESC_{stage0_readonly,dryrun}.mjs`
- Stage0 예외 0건 · DRY-RUN 19/19 migrated_ok·mismatch0 · 멱등+충돌가드+STEP0백업+rollback.

## 동반 해소
- **Bug A (T-20260610-foot-RXSET-DRUGNAME-DISPLAY)**: 본 자동이관이 실해소(별도 작업 불요). 시나리오 `에스로반연고(무피로신)10g` 세트 불러오기 → 약이름이 항목명으로 표시(분류/route 아님). dry-run id=12 표본 확인.

## 게이트
- **supervisor**: dryrun.mjs(19 확인) → 김주연/대표 제시 → GO 후 datafix → 검증 → FE merge 동반.
- **opt-out**: 현장 "자동이관 진행, 직접 재입력 원하면 회신" 통지 중. 회신 시 planner 전달 → A-1 보류.

## 검증
- build OK. spec `tests/e2e/T-20260610-foot-RXSET-NAMEDESC-MODEL.spec.ts`(정적 단언 Q1/Q2/#2/Q3 + GUARD) 단언 문자열 전수 grep 대조 통과.
