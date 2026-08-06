"use server";

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
import { CATEGORIES } from "@/lib/sources/category";
import { createClient } from "@/lib/supabase/server";

/** `useActionState`가 들고 다니는 상태. 저장 전에는 `null`이다. */
export type SaveState = { ok: boolean; message: string } | null;

/**
 * 프로필 저장 (ARCHITECTURE §6.3)
 *
 * 본인 행만 쓴다 — `id`를 세션의 `user.id`로 고정하고 RLS가 한 번 더 막는다 (§2.5).
 * 폼에서 온 값은 전부 선택이라 빈 값은 그대로 null/빈 배열로 저장한다. 게이트가 건너뛴다 (§5.0).
 */
export async function saveProfile(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 익명 세션 생성 실패 (§7). 목록은 계속 보이지만 저장할 곳이 없다.
  if (!user) {
    return { ok: false, message: "세션이 없어 저장하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요." };
  }

  const thisYear = new Date().getFullYear();
  const birthText = text(formData, "birth_year");
  let birthYear: number | null = null;
  if (birthText !== "") {
    const n = Number.parseInt(birthText, 10);
    if (!/^\d{4}$/.test(birthText) || n < BIRTH_YEAR_MIN || n > thisYear) {
      return { ok: false, message: `생년은 ${BIRTH_YEAR_MIN}~${thisYear} 사이 네 자리로 입력해 주세요.` };
    }
    birthYear = n;
  }

  const regionSido = one(formData, "region_sido", codes(SIDO_OPTIONS));

  // **시도를 안 골랐으면 시군구도 버린다.** 시도 없는 시군구 이름은 게이트에서 다른 시도의
  // 같은 이름 정책까지 막는다 (중구·서구처럼 겹치는 이름이 있다).
  const sigunguText = text(formData, "region_sigungu");
  const regionSigungu =
    regionSido !== null && SIGUNGU_OPTIONS[regionSido].includes(sigunguText) ? sigunguText : null;

  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    birth_year: birthYear,
    gender: one(formData, "gender", codes(GENDERS)),
    region_sido: regionSido,
    region_sigungu: regionSigungu,
    income_bracket: one(formData, "income_bracket", codes(INCOME_BRACKETS)),
    situations: many(formData, "situations", codes(SITUATIONS)),
    household: many(formData, "household", codes(HOUSEHOLDS)),
    business_status: one(formData, "business_status", codes(BUSINESS_STATUSES)),
    interests: many(formData, "interests", CATEGORIES),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return { ok: false, message: `저장하지 못했습니다: ${error.message}` };
  }
  return { ok: true, message: "저장했습니다. 목록이 이 조건으로 좁혀집니다." };
}

const codes = (options: Option[]) => options.map((o) => o.code);

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 선택지에 없는 값은 버린다.
 *
 * 폼이 그리는 목록과 같은 상수를 쓰지만 **폼을 우회한 요청도 여기로 온다.** 모르는 코드가
 * 그대로 저장되면 게이트가 어느 그룹과도 안 겹치는 값을 들고 판정해 조용히 오판한다.
 */
function one(formData: FormData, name: string, allowed: readonly string[]): string | null {
  const v = text(formData, name);
  return allowed.includes(v) ? v : null;
}

function many(formData: FormData, name: string, allowed: readonly string[]): string[] {
  return formData
    .getAll(name)
    .filter((v): v is string => typeof v === "string" && allowed.includes(v));
}
