"use client";

import { useActionState, useState } from "react";

import { saveProfile, type SaveState } from "@/app/profile/actions";
import {
  BIRTH_YEAR_MIN,
  BUSINESS_STATUSES,
  GENDERS,
  HOUSEHOLDS,
  INCOME_BRACKETS,
  SIDO_OPTIONS,
  SIGUNGU_OPTIONS,
  SITUATIONS,
  type Option,
} from "@/lib/profile/schema";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/sources/category";

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

  // 프로필이 없는 첫 방문은 DB 기본값과 같은 상태로 시작한다 (§2.2)
  const interests = initial?.interests ?? ["job", "housing"];

  return (
    <form action={formAction} className="mt-6 space-y-7">
      <Section legend="생년">
        {/* `--spacing` 확대로 160px까지 벌어졌던 것을 되돌린다 — 네 자리 연도에 그만한 폭은 없다 (DESIGN.md §5.3) */}
        <input
          type="number"
          name="birth_year"
          defaultValue={initial?.birth_year ?? ""}
          min={BIRTH_YEAR_MIN}
          max={new Date().getFullYear()}
          placeholder="예: 1998"
          aria-label="생년"
          className="input w-24"
        />
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
        <select
          name="income_bracket"
          defaultValue={initial?.income_bracket ?? ""}
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
