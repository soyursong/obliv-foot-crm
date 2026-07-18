# T-20260718-foot-RX-DUR-INTEGRATION-SCOPE — Phase 1 (read-only) 조사 결과

- 성격: read-only 코드/설정 조사 (⛔ 코드 변경·배포·DB 변경 없음)
- 지시: MSG-20260718-152637-na9m (planner PUSH, 총괄 MSG-4jw8 authorize)
- 조사자: dev-foot / 조사일: 2026-07-18

## 결론 요약

| 항목 | 판정 |
|------|------|
| 처방 발행 flow(handlePrint)에 심평원/DUR/전자처방전 벤더 API·EDI 호출 | **없음(無)** |
| 처방전 외부 전송 경로 | **없음** — 로컬 PDF 인쇄물 출력만 |
| 14자리 교부번호 ↔ DUR 처방전번호 규격 정합 | **미검증/미보장** (자릿수 lock 대기) |

## 1. 처방 발행 flow — 벤더 API/EDI/DUR 호출 有/無 → **無**

`handlePrint` (src/components/DocumentPrintPanel.tsx:2644~):
- 처방전(isRx) 발행 시 수행: `supabase.rpc('issue_foot_rx_issue_no', ...)` 로 당일 순번 채번 → `buildIssueNo()` 로 교부번호 조립 → `field_data.issue_no` persist → PDF 생성 → Supabase storage 업로드.
- 외부 의료망(심평원/DUR/전자처방전 중계벤더) 으로의 outbound 호출 **전무**.
- flow 내 `fetch()` 2건(:1234, :2614)은 Supabase storage PDF blob 로딩일 뿐 전송 아님.
- `issue_foot_rx_issue_no` RPC(supabase/migrations/20260718170000_foot_rx_issue_no_daily_counter.sql)
  = per-(clinic_id, issue_date) 로컬 카운터 테이블 upsert. 네트워크/외부 호출 0.

전방위 스윕(src + supabase/functions + env):
- DUR / 전자처방전 / 처방전송 관련 벤더 API·EDI·env·엔드포인트 **0건**.
- env 변수 = VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_DISABLE_AUTH_LOCK /
  VITE_RX_ALLOWLIST_ENFORCEMENT 뿐. 벤더 API 키·심평원/DUR 엔드포인트 secret 없음.

## 2. 전송 경로 → **없음 (심평원 직접 EDI ✗ / 중계 벤더 ✗)**

- 처방전: 전송 미구현. 인쇄물(PDF) 출력 전용.
- 청구명세서 EDI: `useEdiExport.ts` / `ediExport.ts` / EdiExport.tsx = **파일 export(logical 산출)** 만.
  `markExported()` 는 edi_submissions.export_status='exported' 까지만 기록, **transmitted 자동전이 명시 차단(D2 가드)**.
  → 이것도 실시간 전송이 아니며, 애초에 처방전이 아닌 요양급여 청구명세서 축.
- 유일한 외부 의료 API = `supabase/functions/nhis-lookup` = 건보공단 **수진자 자격조회**
  (등급·본인부담율 확인, NHIS_API_URL/NHIS_API_KEY/NHIS_FACILITY_CODE secret).
  → **자격조회일 뿐 DUR(의약품 점검)도 처방전 전송도 아님.** 처방 발행 flow와 무관.

## 3. 14자리 교부번호 ↔ DUR 처방전번호 규격 정합 → **미검증**

`src/lib/docSerial.ts`:
- 현재 교부번호 = `YYYYMMDD(8) + 당일순번 zero-pad(N)`, `ISSUE_NO_SEQ_WIDTH = 6` → **총 14자리** (예 20260718000025).
- 코드 주석(:93~104)에 규격 논쟁 명시:
  - 총괄 확정(MSG-a2zc) = N=6 → 14자리 (**잠정**)
  - 심평원 실무 안내(약업신문 게재 규격) = N=5 → **13자리** (예 2026071800025)
- 자릿수는 파라미터화됨(CEO n7ip: 하드코딩 금지) — N lock 시 상수 1줄 flip. length CHECK/정규식 고정 금지.
- 즉 **DUR/심평원 요구 처방전번호 규격과의 정합은 현재 코드상 확정·검증되지 않음.**
  확정 검증 경로(주석 명시): (a) 「요양급여비용 청구방법·명세서서식·작성요령」 law.go.kr admRulSeq=2000000081143,
  (b) 반려 약국 실무검증(본 티켓 AC6 자릿수/형식 확인).

## 근거 코드/설정 위치

- src/components/DocumentPrintPanel.tsx : handlePrint(:2644) / issue_no 채번(:2724~2755)
- src/lib/docSerial.ts : buildIssueNo / ISSUE_NO_SEQ_WIDTH(:104) / 규격 주석(:93~104)
- supabase/migrations/20260718170000_foot_rx_issue_no_daily_counter.sql : 당일 카운터 RPC(로컬)
- src/hooks/useEdiExport.ts / src/lib/ediExport.ts : 청구 EDI export(파일, transmitted 차단)
- supabase/functions/nhis-lookup/index.ts : 건보 자격조회(DUR 아님)
