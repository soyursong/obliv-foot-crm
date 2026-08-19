// T-20260818-foot-PENCHART-AUTORECORD-CRMDATA-DOCFORM-AUTOFILL
// 고객상세 2번차트 [펜차트 자동기록용] 위치 — CRM 데이터(처방약·상병코드) 화면 진입 시 자동 생성/표시.
//
// 배치·자동생성 방식 = 펜차트 자동기록 계보(T-20260808/10/11 PENCHART-AUTORECORD-*) 재사용:
//   [펜차트양식] 기본 틀(neutral white-card: rounded-lg border bg-white) 그대로 재사용하고,
//   그 틀 안에 CRM 추출 데이터(처방약 rx_items·상병코드 dx_items)가 자동으로 채워져 표시된다.
//   손글씨/편집 없이 read-only 자동 생성(수기작성 불필요) — 펜차트 자동기록과 동일 동작 방식(AC-1).
//
// 데이터소스 정본(AC-2) = PaymentMiniWindow 저장 form_submissions(rx_standard). 상위(CustomerChartPage)가
//   이미 로드한 rxRes(form_key='rx_standard') 행을 buildAutoRxDxRecords 로 투영해 records 로 주입 —
//   신규 쿼리 0. PaymentDialog(비도달 표면) 참조 아님.
//
// AC-3: records 비면(미결제·미입력) 에러 없이 '기록 없음' 안내(빈 배열 방어).
// AC-4: 처방약은 구조화 rx_items(수량 total_qty) 우선, 폴백 시 fromHtml 배지로 육안검증.
// db_change=false·비파괴·read-only. 기존 펜차트/자동기록 흐름 회귀 없음(additive sibling, AC-5).

import { deriveGenderFromRRN } from '@/lib/rrn';
import { maskRrnForPrint } from '@/lib/autoVisitLog';
import {
  formatAutoRxMedication,
  formatAutoDxCode,
  type AutoRxDxRecord,
} from '@/lib/autoRxDxRecord';

type Props = {
  records: AutoRxDxRecord[];
  loading?: boolean;
  customerName: string;
  customerChartNumber?: string | null;
  /** 인메모리 canonical RRN — 마스킹/성별 파생 전용(raw 미노출). */
  customerRrn?: string | null;
};

export function AutoRxDxRecordBox({
  records,
  loading,
  customerName,
  customerChartNumber,
  customerRrn,
}: Props) {
  // 표준 차트헤더(성명·성별·차트번호·주민번호 마스킹) — [펜차트양식] identity 계승. raw RRN 미노출.
  const genderLabel = deriveGenderFromRRN(customerRrn);
  const maskedRrn = maskRrnForPrint(customerRrn);
  const hasHtmlFallback = records.some((r) => r.medicationsFromHtml);

  return (
    <div className="rounded-lg border bg-white p-3 text-xs" data-testid="auto-rxdx-record-box">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 font-bold text-neutral-800">
          <span className="h-2 w-2 rounded-full bg-neutral-500" />
          펜차트(자동기록용) · 처방약·상병코드
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            CRM 데이터 자동 생성 · 결제 미니창 저장값 기준
          </span>
        </span>
      </div>

      {/* 표준 차트헤더 — [펜차트양식] identity 계승. raw RRN 미노출(마스킹 렌더). */}
      <div
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-b pb-2 text-[11px] text-neutral-700"
        data-testid="auto-rxdx-record-header"
      >
        <span>성명: <b className="text-neutral-900">{customerName}</b>{genderLabel ? <span className="text-muted-foreground"> ({genderLabel})</span> : null}</span>
        {customerChartNumber ? <span>차트번호: {customerChartNumber}</span> : null}
        <span>주민등록번호: {maskedRrn}</span>
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full border-collapse" data-testid="auto-rxdx-record-table">
          <thead>
            <tr className="bg-neutral-100 text-neutral-800">
              <th className="text-left px-2 py-1.5 font-medium border-b whitespace-nowrap">교부일</th>
              <th className="text-left px-2 py-1.5 font-medium border-b whitespace-nowrap">상병코드</th>
              <th className="text-left px-2 py-1.5 font-medium border-b whitespace-nowrap">처방약</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-muted-foreground" data-testid="auto-rxdx-record-loading">
                  불러오는 중…
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-muted-foreground" data-testid="auto-rxdx-record-empty">
                  처방약·상병코드 기록 없음
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.key} className="border-b align-top" data-testid="auto-rxdx-record-row">
                  <td className="px-2 py-1.5 whitespace-nowrap text-neutral-700">
                    {r.issuedAt ?? '-'}
                    {r.issueNo ? <div className="text-[10px] text-muted-foreground">교부 {r.issueNo}</div> : null}
                  </td>
                  <td className="px-2 py-1.5" data-testid="auto-rxdx-record-dx">
                    {r.diagnoses.length === 0 ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {r.diagnoses.map((d, i) => (
                          <li key={i}>{formatAutoDxCode(d)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-2 py-1.5" data-testid="auto-rxdx-record-rx">
                    {r.medications.length === 0 ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {r.medications.map((m, i) => (
                          <li key={i}>{formatAutoRxMedication(m)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {hasHtmlFallback && (
        <div className="mt-1.5 text-[10px] text-amber-600" data-testid="auto-rxdx-record-htmlfallback">
          일부 처방약은 구조화 수량 정보가 없어 약품명만 표시됩니다(과거 발행분).
        </div>
      )}
    </div>
  );
}
