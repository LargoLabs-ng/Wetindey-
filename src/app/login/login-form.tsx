"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { GoogleIcon } from "@/components/google-icon";

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
    <main className="min-h-screen flex items-center justify-center bg-ivory px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image src="/logo.png" alt="Ticket Buddy" width={48} height={48} className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-charcoal">Welcome back</h1>
          <p className="text-secondary-text text-sm mt-1">
            Log in to manage your events.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-white border border-border rounded-2xl p-6"
        >
          {error && <p className="text-error text-sm">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-charcoal mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-forest text-ivory font-semibold py-2.5 hover:bg-emerald transition-colors disabled:opacity-60"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>

          {googleEnabled && (
            <>
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-secondary-text">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl: destination })}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 font-semibold text-charcoal hover:bg-ivory transition-colors"
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </>
          )}
        </form>

        <p className="text-center text-sm text-secondary-text mt-4">
          New organizer?{" "}
          <Link href="/signup" className="text-forest font-medium">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}

export default LoginForm;
