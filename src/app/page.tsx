import { createClient } from "@/lib/supabase/server";

/**
 * 작업 0.5 완료 판정용 임시 화면. 작업 3에서 정책 목록으로 교체된다.
 *
 * 확인하는 것은 "서버가 세션을 보는가"다 (ARCHITECTURE §1.1).
 * getUser()만으로는 부족하다 — Postgres의 auth.uid()는 액세스 토큰의 클레임에서 나오므로
 * role이 authenticated이고 sub이 채워져 있는지까지 봐야 1차 필터와 RLS가 돈다고 말할 수 있다.
 */
export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const claims = session ? decodeJwtClaims(session.access_token) : null;
  const uidWorks = claims?.role === "authenticated" && Boolean(claims?.sub);

  return (
    <main className="mx-auto max-w-2xl p-8 font-mono text-sm">
      <h1 className="mb-6 font-sans text-2xl font-bold">오늘공고 — 세션 점검</h1>

      <dl className="space-y-2">
        <Row label="서버가 본 user.id" value={user?.id ?? "(없음)"} />
        <Row label="익명 사용자인가" value={user ? String(user.is_anonymous) : "(없음)"} />
        <Row label="JWT role" value={claims?.role ?? "(없음)"} />
        <Row label="JWT sub" value={claims?.sub ?? "(없음)"} />
      </dl>

      <p
        className={`mt-6 rounded p-3 font-sans ${
          uidWorks ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"
        }`}
      >
        {uidWorks
          ? "통과 — 서버 컴포넌트에서 세션이 잡히고 auth.uid()가 이 sub 값을 반환한다."
          : "실패 — 서버가 세션을 못 본다. proxy.ts와 Anonymous Sign-Ins 설정을 확인할 것."}
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-40 shrink-0 font-sans text-gray-500">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}

function decodeJwtClaims(token: string): { sub?: string; role?: string } | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
