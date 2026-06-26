// ForeignInfoSection.tsx — 외국인 정보(국적/여권 영문명/여권번호/외국인등록번호/만료일)
// T-20260625-foot-PASSPORT-PORT (이식 출처: obliv-derm-crm NewCustomerFormModal.tsx 384~940/1824~1960)
//
// 신규/수정 고객 폼 공용. 2열 그리드 평탄화·상시 노출(아코디언/토글 없음 — DA 게이트 UI 스펙).
//  - 국적: nationalities 마스터 셀렉트 + 국기 아이콘(FE asset, countryCodeToFlag).
//  - 여권 영문 성(Surname)/이름(Given names), 여권번호, 외국인등록번호, 만료일.
//  - PHI 게이트(canEdit=canEditSensitive): 여권번호·외국인등록번호는 RRN 동급 → 열람 전용 처리.
//  - 여권 OCR 스캔은 본 티켓 범위 제외(PASSPORT-SCAN 별도 게이트).
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { countryCodeToFlag } from '@/lib/flag';
import { useNationalities } from '@/hooks/useNationalities';
import { LANGUAGE_OPTIONS, nationalityCodeToLanguage } from '@/lib/foreign';

const NONE = '__none__';
const LANG_NONE = '__none__';

export interface ForeignInfoValue {
  /** nationalities.id (문자열, 미선택은 빈 문자열) */
  nationalityId: string;
  /** 환자 선호 언어 — BCP-47 코드(ko/en/ja/zh-CN/zh-TW …), 미선택은 빈 문자열. customers.language 에 저장. */
  language: string;
  /** 여권 영문 성(Surname) */
  passportLastName: string;
  /** 여권 영문 이름(Given names) */
  passportFirstName: string;
  /** 여권번호 */
  passportNumber: string;
  /** 외국인등록번호 (RRN 동급 PHI) */
  foreignerRegNumber: string;
  /** 여권/체류 만료일 (ISO yyyy-mm-dd) */
  docExpiry: string;
}

interface Props {
  value: ForeignInfoValue;
  onChange: (next: Partial<ForeignInfoValue>) => void;
  /** 민감정보(여권번호·외국인등록번호) 수정 권한. false면 열람 전용. 기본 true. */
  canEdit?: boolean;
}

export default function ForeignInfoSection({ value, onChange, canEdit = true }: Props) {
  const nationalities = useNationalities();

  return (
    <div className="space-y-3 rounded-md border border-input p-3" data-testid="foreign-info-section">
      <div className="text-sm font-semibold text-foreground">외국인 정보</div>

      {/* 국적 — nationalities 마스터 + 국기 아이콘 */}
      <div className="space-y-1.5">
        <Label>국적</Label>
        <Select
          value={value.nationalityId || NONE}
          onValueChange={(v) => {
            const nextId = v === NONE ? '' : v;
            const patch: Partial<ForeignInfoValue> = { nationalityId: nextId };
            // T-20260625-foot-FOREIGN-LANG-SAVE: 국적 선택 시 언어 '제안'.
            //   DA(MSG-...-2prw): 초기/NULL일 때만 채우는 default. 수동 입력값은 last-write-wins로 유지(덮어쓰기 금지).
            if (nextId && !value.language) {
              const nat = nationalities.find((n) => String(n.id) === nextId);
              const lang = nationalityCodeToLanguage(nat?.code);
              if (lang) patch.language = lang;
            }
            onChange(patch);
          }}
        >
          <SelectTrigger data-testid="foreign-nationality">
            <SelectValue placeholder="국적 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>선택 안 함</SelectItem>
            {nationalities.map((n) => {
              const flag = countryCodeToFlag(n.code);
              return (
                <SelectItem key={n.id} value={String(n.id)}>
                  {flag ? `${flag} ${n.name}` : n.name}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* 언어 — 국적 선택 시 자동 제안(수동 변경 우선). customers.language(BCP-47) 저장 */}
      <div className="space-y-1.5">
        <Label>언어</Label>
        <Select
          value={value.language || LANG_NONE}
          onValueChange={(v) => onChange({ language: v === LANG_NONE ? '' : v })}
        >
          <SelectTrigger data-testid="foreign-language">
            <SelectValue placeholder="언어 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LANG_NONE}>선택 안 함</SelectItem>
            {LANGUAGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 여권 영문 성/이름 — 2열 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="foreign-passport-last">여권 영문 - 성(Surname)</Label>
          <Input
            id="foreign-passport-last"
            value={value.passportLastName}
            onChange={(e) => onChange({ passportLastName: e.target.value.toUpperCase() })}
            placeholder="예: HONG"
            className="font-mono"
            data-testid="foreign-passport-last"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="foreign-passport-first">여권 영문 - 이름(Given names)</Label>
          <Input
            id="foreign-passport-first"
            value={value.passportFirstName}
            onChange={(e) => onChange({ passportFirstName: e.target.value.toUpperCase() })}
            placeholder="예: GILDONG"
            className="font-mono"
            data-testid="foreign-passport-first"
          />
        </div>
      </div>

      {/* 여권번호 / 만료일 — 2열 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="foreign-passport-no">
            여권번호{!canEdit && <span className="text-xs text-muted-foreground font-normal"> — 열람 전용</span>}
          </Label>
          {canEdit ? (
            <Input
              id="foreign-passport-no"
              value={value.passportNumber}
              onChange={(e) => onChange({ passportNumber: e.target.value.toUpperCase() })}
              placeholder="예: M12345678"
              className="font-mono"
              data-testid="foreign-passport-no"
            />
          ) : (
            <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground font-mono select-all">
              {value.passportNumber || '—'}
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="foreign-doc-expiry">만료일 <span className="text-xs text-muted-foreground font-normal">(여권·체류)</span></Label>
          <Input
            id="foreign-doc-expiry"
            type="date"
            value={value.docExpiry}
            onChange={(e) => onChange({ docExpiry: e.target.value })}
            data-testid="foreign-doc-expiry"
          />
        </div>
      </div>

      {/* 외국인등록번호 — RRN 동급 PHI, canEdit 게이트 */}
      <div className="space-y-1.5">
        <Label htmlFor="foreign-reg-no">
          외국인등록번호{!canEdit && <span className="text-xs text-muted-foreground font-normal"> — 열람 전용</span>}
        </Label>
        {canEdit ? (
          <Input
            id="foreign-reg-no"
            value={value.foreignerRegNumber}
            onChange={(e) => onChange({ foreignerRegNumber: e.target.value })}
            placeholder="예: 123456-7890123"
            className="font-mono"
            data-testid="foreign-reg-no"
          />
        ) : (
          <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground font-mono select-all">
            {value.foreignerRegNumber || '—'}
          </div>
        )}
      </div>
    </div>
  );
}
