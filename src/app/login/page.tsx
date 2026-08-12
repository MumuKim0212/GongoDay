import { BackToList } from "@/components/BackToList";
import { PasswordLoginForm } from "@/components/PasswordLoginForm";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  confirm_failed: "확인 링크가 올바르지 않거나 만료되었습니다. 다시 시도해 주세요.",
};

/**
 * 로그인 (PRD §9.5) — 조건 입력·판정 시점에 이 화면으로 온다.
 * 목록 열람은 로그인 없이 그대로 열려 있다.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const { redirect, error } = await searchParams;
  const redirectTo = redirect && redirect.startsWith("/") ? redirect : "/profile";
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="max-w-read mx-auto w-full px-4 py-8">
      <BackToList className="btn btn-ghost px-0">← 목록으로</BackToList>

      {errorMessage ? <p className="text-small text-danger mt-3 text-center">{errorMessage}</p> : null}

      <PasswordLoginForm redirectTo={redirectTo} />
    </main>
  );
}
