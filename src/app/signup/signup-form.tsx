"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { GoogleIcon } from "@/components/google-icon";

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  organizationName: string;
};

const initialState: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  organizationName: "",
};

function SignupForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Same-site paths only, so ?callbackUrl= can't redirect off-domain.
  const requested = searchParams.get("callbackUrl");
  const destination =
    requested && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/dashboard";
  const [form, setForm] = useState<FormState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    const result = await signIn("credentials", {
      email: form.email,
      password: form.password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      // Account exists but auto-login failed for some reason — send them
      // to log in manually rather than leaving them stuck on this form.
      router.push("/login");
      return;
    }

    router.push(destination);
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ivory px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Image
            src="/logo.png"
            alt="Ticket Buddy"
            width={48}
            height={48}
            className="mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-charcoal">
            Create your organizer account
          </h1>
          <p className="text-secondary-text text-sm mt-1">
            Set up your organization and start selling tickets.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-white border border-border rounded-2xl p-6"
        >
          {error && <p className="text-error text-sm">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">
                First name
              </label>
              <input
                required
                value={form.firstName}
                onChange={(e) => update("firstName", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-charcoal mb-1">
                Last name
              </label>
              <input
                required
                value={form.lastName}
                onChange={(e) => update("lastName", e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal mb-1">
              Organization name
            </label>
            <input
              required
              value={form.organizationName}
              onChange={(e) => update("organizationName", e.target.value)}
              placeholder="e.g. TEDx UNIUYO"
              className="w-full rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
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
              minLength={8}
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest"
            />
            <p className="text-xs text-secondary-text mt-1">At least 8 characters.</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-forest text-ivory font-semibold py-2.5 hover:bg-emerald transition-colors disabled:opacity-60"
          >
            {loading ? "Creating account..." : "Create account"}
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
              <p className="text-xs text-secondary-text text-center -mt-1">
                We&apos;ll set up an organization for you automatically — you
                can rename it any time.
              </p>
            </>
          )}
        </form>

        <p className="text-center text-sm text-secondary-text mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-forest font-medium">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}

export default SignupForm;
