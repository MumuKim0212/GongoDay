"use server";

import { revalidatePath } from "next/cache";

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
import { log } from "@/lib/log";
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
    // 조건이 없으면 목록도 판정도 못 쓴다 — 서비스가 통째로 멈추는 실패라 error다.
    // 값 자체는 넣지 않는다: 생년·지역은 개인정보고, 무엇이 막혔는지는 메시지만으로 충분하다.
    log.error("profile.save_failed", { message: error.message });
    return { ok: false, message: `저장하지 못했습니다: ${error.message}` };
  }

  // **"목록이 이 조건으로 좁혀집니다"를 화면이 지켜야 한다.** `← 목록으로`는 정방향 이동이라
  // 서버를 다시 부르지만, **브라우저 뒤로가기는 클라이언트 캐시의 옛 목록을 그대로 돌려준다** —
  // 조건 카드·건수·목록이 저장 전 것으로 남아 안내문이 거짓이 된다.
  //
  // 범위가 `layout`인 이유는 **상세도 같이 상한다**는 것이다. 판정은 서명으로 읽으므로
  // 조건을 고치면 상세의 판정 블록도 지금 조건의 것이 아니다 — 캐시에 남은 상세로 뒤로
  // 돌아가면 옛 판정이 새 조건의 판정처럼 보인다 (§5.5). 루트 레이아웃이 전부를 감싸므로
  // 이 한 줄이 캐시에 남은 화면을 모두 버린다. 서버 쪽은 전부 `force-dynamic`이라 버릴 것이 없다.
  revalidatePath("/", "layout");

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
