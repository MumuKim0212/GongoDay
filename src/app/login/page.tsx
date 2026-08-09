import { BackToList } from "@/components/BackToList";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

/**
 * 로그인 (PRD §9.5) — 관리자가 "로그인 요구"를 켰을 때 조건 입력·판정 시점에만 이 화면으로 온다.
 * 목록 열람은 로그인 없이 그대로 열려 있다.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  const redirectTo = redirect && redirect.startsWith("/") ? redirect : "/profile";

  return (
    <main className="max-w-read mx-auto w-full px-4 py-8">
      <BackToList className="btn btn-ghost px-0">← 목록으로</BackToList>

      <header className="mt-3">
        <h1 className="text-title">로그인</h1>
        <p className="text-body mt-2">
          이메일로 받은 코드를 입력하면 로그인됩니다. 계정이 없으면 자동으로 만들어집니다.
        </p>
      </header>

      <LoginForm redirectTo={redirectTo} />
    </main>
  );
}
