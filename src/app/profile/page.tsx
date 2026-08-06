import Link from "next/link";

import { ProfileForm, type ProfileValues } from "@/components/ProfileForm";
import { createClient } from "@/lib/supabase/server";

/** 매 요청 조회한다 — 사용자마다 다른 값이고, 저장 직후 새로고침이 옛 값을 보이면 안 된다. */
export const dynamic = "force-dynamic";

/** 폼이 그리는 칸만. `updated_at`은 화면이 쓰지 않는다. */
const PROFILE_COLUMNS =
  "birth_year, gender, region_sido, region_sigungu, income_bracket, situations, household, business_status, interests";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile, error } = user
    ? await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle()
    : { data: null, error: null };

  return (
    <main className="max-w-read mx-auto w-full px-4 py-8">
      <Link href="/" className="btn btn-ghost px-0">
        ← 목록으로
      </Link>

      <header className="mt-3">
        <h1 className="text-title">내 조건</h1>
        <p className="text-body mt-2">
          <strong>모두 선택 사항입니다.</strong> 채울수록 정확해지고, 생년과 사는 곳만으로도 동작합니다.
        </p>
        <p className="text-small text-muted mt-1">
          비워둔 항목은 조건으로 보지 않습니다 — 그 항목 때문에 정책이 걸러지는 일은 없습니다.
        </p>
      </header>

      {/* 세션이 없으면 저장할 곳이 없다 (§7). 폼을 그려놓고 저장에서 실패시키면 입력이 통째로 날아간다 */}
      {!user ? (
        <Notice
          title="지금은 조건을 저장할 수 없습니다"
          body="세션을 만들지 못했습니다. 새로고침한 뒤 다시 시도해 주세요. 목록은 조건 없이도 볼 수 있습니다."
        />
      ) : error ? (
        // 조회 실패를 '프로필 없음'으로 흘리면 빈 폼이 뜨고, 저장하는 순간 기존 값이 지워진다
        <Notice
          title="저장된 조건을 불러오지 못했습니다"
          body="지금 저장하면 기존 값이 덮어써질 수 있어 폼을 열지 않았습니다. 잠시 후 새로고침해 주세요."
        />
      ) : (
        <ProfileForm initial={(profile as ProfileValues | null) ?? null} />
      )}
    </main>
  );
}

/** 목록·상세의 빈 상태와 같은 형태다 — 상자를 두르지 않는다 (§4.7) */
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-8">
      <p className="text-sub">{title}</p>
      <p className="text-small text-muted mt-1">{body}</p>
    </div>
  );
}
