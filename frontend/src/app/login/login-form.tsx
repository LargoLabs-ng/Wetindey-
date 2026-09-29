"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GoogleIcon } from "@/components/google-icon";
import { WordMark } from "@/components/wordmark";

function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Only ever follow a same-site path, so ?callbackUrl= can't be used to
  // bounce someone to another domain after they log in.
  const requested = searchParams.get("callbackUrl");
  const destination =
    requested && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }

    router.push(destination);
    router.refresh();
  }

  return (
    <main className="wd-night min-h-screen flex items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-5"><WordMark size="lg" /></div>
          <h1 className="text-2xl font-bold text-ink">Welcome back</h1>
          <p className="text-ink-2 text-sm mt-1">
            Log in to manage your events.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-card border border-line rounded-2xl p-6"
        >
          {error && <p className="text-error text-sm">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-purple text-white font-semibold py-2.5 hover:bg-purple-deep transition-colors disabled:opacity-60"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>

          {googleEnabled && (
            <>
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-line" />
                <span className="text-xs text-ink-2">or</span>
                <div className="flex-1 h-px bg-line" />
              </div>

              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl: destination })}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-line py-2.5 font-semibold text-ink hover:bg-cream-2 transition-colors"
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </>
          )}
        </form>

        <p className="text-center text-sm text-ink-2 mt-4">
          New organizer?{" "}
          <Link href="/signup" className="text-purple font-semibold">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}

export default LoginForm;
