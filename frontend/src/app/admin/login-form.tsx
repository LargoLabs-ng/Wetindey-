"use client";

import { useState, type FormEvent } from "react";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { WordMark } from "@/components/wordmark";

export default function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Email or password is incorrect.");
        return;
      }

      const access = await fetch("/api/admin/access", { cache: "no-store" });
      if (!access.ok) {
        await signOut({ redirect: false });
        setError("This account is not authorized to access the admin dashboard.");
        return;
      }

      setPassword("");
      router.refresh();
    } catch {
      setError("Could not sign in right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wd-night flex min-h-screen items-center justify-center bg-cream px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-5 flex justify-center">
            <WordMark size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-ink">Admin sign in</h1>
          <p className="mt-1 text-sm text-ink-2">
            Sign in with your authorized administrator account.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-line bg-card p-6"
        >
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <div>
            <label htmlFor="admin-email" className="mb-1 block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-purple py-2.5 font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
