"use client";

import { useActionState, useState } from "react";

import { saveProfile, type SaveState } from "@/app/profile/actions";
import {
  BIRTH_YEAR_MIN,
  BUSINESS_STATUSES,
  GENDERS,
  HOUSEHOLDS,
  INCOME_BRACKETS,
  INCOME_BRACKET_RATIOS,
  MEDIAN_INCOME_MONTHLY,
  MEDIAN_INCOME_SOURCE,
  MEDIAN_INCOME_YEAR,
  SIDO_OPTIONS,
  SIGUNGU_OPTIONS,
  SITUATIONS,
  type Option,
} from "@/lib/profile/schema";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/sources/category";

/**
 * 고를 수 있는 출생년도. 올해부터 거꾸로 내려가고 범위는 서버 검증과 같다(`saveProfile`) —
 * 목록에 없는 값은 애초에 고를 수 없어야 두 쪽이 어긋나지 않는다.
 */
const THIS_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: THIS_YEAR - BIRTH_YEAR_MIN + 1 }, (_, i) => THIS_YEAR - i);

/** `profiles` 한 행 중 폼이 그리는 칸 (§2.2). 프로필이 없으면 `null`이 온다. */
export type ProfileValues = {
  birth_year: number | null;
  gender: string | null;
  region_sido: string | null;
  region_sigungu: string | null;
  income_bracket: string | null;
  situations: string[];
  household: string[];
  business_status: string | null;
  interests: string[];
};

/**
 * 프로필 폼 (ARCHITECTURE §6.3)
 *
 * **모든 항목이 선택이다.** 안 채운 항목은 게이트가 건너뛴다 — "모르면 통과" (§5.0).
 * 그래서 어떤 필드에도 `required`를 걸지 않는다. 생년만 채워도 저장된다.
 *
 * 시도·시군구만 상태를 쓴다(시군구 목록이 시도에 딸려 있다). 나머지는 비제어 입력이라
 * 저장 실패로 다시 그려져도 사용자가 고른 값이 그대로 남는다.
 */
export function ProfileForm({ initial }: { initial: ProfileValues | null }) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveProfile, null);
  const [sido, setSido] = useState(initial?.region_sido ?? "");
  const [sigungu, setSigungu] = useState(initial?.region_sigungu ?? "");
  // 소득 구간은 **비제어인 채로 둔다** — 이 상태는 저장값이 아니라 옆에 적을 금액을 고르는 데만 쓴다
  const [income, setIncome] = useState(initial?.income_bracket ?? "");

  // 프로필이 없는 첫 방문은 DB 기본값과 같은 상태로 시작한다 (§2.2)
  const interests = initial?.interests ?? ["job", "housing"];

  return (
    <form action={formAction} className="mt-6 space-y-7">
      <Section legend="출생년도">
        {/* **목록에서 고른다.** 숫자 입력의 화살표는 한 번에 1년씩 움직여 28년생을 찾는 데 쓸 수 없고,
            직접 치면 오타가 그대로 조건이 된다 — 목록은 있는 값만 고르게 한다 (DESIGN.md §5.3).
            내림차순이라 여는 순간 올해가 맨 위다. 다른 select와 같이 '선택 안 함'이 첫 칸인
            이유는 **출생년도도 선택 사항이기 때문이다** — 올해가 기본으로 잡혀 있으면 손대지 않은
            사용자가 0살로 저장되어 나이 조건이 목록을 통째로 비운다.

            `size`가 있어 펼쳐진 목록이 아니라 **네 줄짜리 스크롤 상자**다 — 1900년까지 100개가 넘는
            항목이 드롭다운으로 열리면 화면을 통째로 덮는다. 브라우저가 고른 값을 보이는 데까지
            스크롤해 주므로 저장된 연도는 열자마자 보인다. */}
        <select
          name="birth_year"
          defaultValue={initial?.birth_year ?? ""}
          size={4}
          aria-label="출생년도"
          className="input w-auto"
        >
          <option value="">선택 안 함</option>
          {BIRTH_YEARS.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <Hint>연도만 받습니다. 나이 조건은 앞뒤로 1년 여유를 두고 봅니다.</Hint>
      </Section>

      <Section legend="성별">
        <Radios name="gender" options={GENDERS} value={initial?.gender} />
      </Section>

      <Section legend="사는 곳">
        <div className="flex flex-wrap gap-2">
          <select
            name="region_sido"
            value={sido}
            onChange={(e) => {
              setSido(e.target.value);
              setSigungu(""); // 시도가 바뀌면 이전 시군구는 그 시도에 없다
            }}
            aria-label="시도"
            className="input w-auto"
          >
            <option value="">선택 안 함</option>
            {SIDO_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            name="region_sigungu"
            value={sigungu}
            onChange={(e) => setSigungu(e.target.value)}
            disabled={sido === ""}
            aria-label="시군구"
            className="input w-auto disabled:opacity-45"
          >
            <option value="">시군구 선택 안 함</option>
            {(SIGUNGU_OPTIONS[sido] ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <Hint>
          지금은 서울·인천·경기만 지원합니다. 시군구는 골라도 되고 안 골라도 됩니다 — 고르면 그 구 전용
          정책이 더 정확해지고, 안 골라도 시도 전체 정책은 그대로 보입니다.
        </Hint>
      </Section>

      <Section legend="소득 구간">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <select
            name="income_bracket"
            defaultValue={initial?.income_bracket ?? ""}
            onChange={(e) => setIncome(e.target.value)}
            aria-label="소득 구간"
            className="input w-auto"
          >
            <option value="">선택 안 함</option>
            {INCOME_BRACKETS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
          <MedianIncomeNote code={income} />
        </div>
      </Section>

      <Section legend="개인 상황">
        <Checks name="situations" options={SITUATIONS} values={initial?.situations} />
        {/* 게이트가 코드로 '아님'을 확정하는 항목이라 안내를 강하게 쓴다 (gate.ts 주석 참고) */}
        <Hint>
          <strong>해당되는 것을 빠짐없이 골라주세요.</strong> 장애인·대학생·보훈대상자·질병처럼 그 대상만
          신청할 수 있는 정책은, 체크하지 않으면 조건이 어긋난 것으로 보고 &apos;아님&apos;으로 접힙니다.
        </Hint>
      </Section>

      <Section legend="가구 상황">
        <Checks name="household" options={HOUSEHOLDS} values={initial?.household} />
        <Hint>
          이 항목으로는 정책을 걸러내지 않습니다. 1인가구와 무주택세대가 서로 배타적인 조건이 아니라서,
          코드로 단정하지 않고 AI 판정의 참고 자료로만 씁니다.
        </Hint>
      </Section>

      <Section legend="사업자 상황">
        <Radios name="business_status" options={BUSINESS_STATUSES} value={initial?.business_status} />
      </Section>

      <Section legend="관심 분야">
        <Checks
          name="interests"
          options={CATEGORIES.filter((c) => c !== "etc").map((c) => ({
            code: c,
            label: CATEGORY_LABELS[c as Category],
          }))}
          values={interests}
        />
        <Hint>
          목록에서 기본으로 켜질 분야입니다. 목록에서 언제든 바꿀 수 있고, 하나도 고르지 않으면
          일자리·창업·주거 두 개로 봅니다.
        </Hint>
      </Section>

      {/* 이 화면에서 선이 남는 자리는 여기 하나뿐이다 — 입력이 끝나고 동작이 시작되는 경계 (§5.3) */}
      <div className="border-t-[var(--divider)] flex flex-wrap items-center gap-3 border-t pt-5">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "저장 중…" : "저장"}
        </button>
        <p
          aria-live="polite"
          className={`text-small ${state?.ok === false ? "text-danger" : "text-muted"}`}
        >
          {state?.message ?? ""}
        </p>
      </div>
    </form>
  );
}

function Section({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-sub">{legend}</legend>
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-micro text-muted mt-2">{children}</p>;
}

/**
 * 고른 구간이 실제로 얼마인지 셀렉트 오른쪽에 적는다.
 *
 * "중위소득 76~100%"는 비율일 뿐이라 자기가 해당되는지 알 수 없다. **금액을 적으려면 근거가 필요하다** —
 * 그래서 연도와 고시 출처를 같이 걸고, 링크 없이 숫자만 적지 않는다.
 *
 * 가구원 수는 프로필이 받지 않는 값이라 **한 줄로 단정하지 않고 1인·4인을 나란히 적는다** —
 * 하나만 적으면 다른 가구가 자기 기준으로 읽는다.
 */
function MedianIncomeNote({ code }: { code: string }) {
  const ratio = INCOME_BRACKET_RATIOS[code];
  if (!ratio) return null; // '선택 안 함'

  return (
    <p className="text-micro text-muted">
      1인 가구 {amount(ratio, 1)} · 4인 가구 {amount(ratio, 4)}
      <br />
      <a
        href={MEDIAN_INCOME_SOURCE.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent-ink)] underline"
      >
        {MEDIAN_INCOME_YEAR}년 기준 중위소득 · {MEDIAN_INCOME_SOURCE.label} ↗
      </a>
    </p>
  );
}

/** 비율 구간을 월 소득으로 바꾼다. 상한이 없으면 "초과", 하한이 0이면 "이하"로 적는다. */
function amount([lo, hi]: [number, number | null], size: 1 | 4): string {
  const won = (pct: number) =>
    Math.round((MEDIAN_INCOME_MONTHLY[size] * pct) / 100).toLocaleString("ko-KR");

  if (hi === null) return `월 ${won(lo)}원 초과`;
  if (lo === 0) return `월 ${won(hi)}원 이하`;
  return `월 ${won(lo)} ~ ${won(hi)}원`;
}

/** 선택 해제 수단이 필요하다 — 라디오는 한 번 고르면 끌 수 없으므로 '선택 안 함'을 첫 칸에 둔다. */
function Radios({
  name,
  options,
  value,
}: {
  name: string;
  options: Option[];
  value: string | null | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {[{ code: "", label: "선택 안 함" }, ...options].map((o) => (
        <label key={o.code} className="tag tag-btn tag-outline chip">
          <input type="radio" name={name} value={o.code} defaultChecked={(value ?? "") === o.code} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Checks({
  name,
  options,
  values,
}: {
  name: string;
  options: Option[];
  values: string[] | undefined;
}) {
  const on = new Set(values ?? []);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.code} className="tag tag-btn tag-outline chip">
          <input type="checkbox" name={name} value={o.code} defaultChecked={on.has(o.code)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
