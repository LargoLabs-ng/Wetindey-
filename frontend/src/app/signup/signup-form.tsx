"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GoogleIcon } from "@/components/google-icon";
import { WordMark } from "@/components/wordmark";
import {
  CampusPicker,
  EMPTY_CAMPUS_SELECTION,
  type CampusSelection,
} from "@/components/campus-picker";

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
      : null;
  const [form, setForm] = useState<FormState>(initialState);
  const [campus, setCampus] = useState<CampusSelection>(EMPTY_CAMPUS_SELECTION);
  // Hosting is the minority path, so it is opt-in rather than the default.
  // An account with no organization is the normal state now; one is created
  // the first time somebody actually makes an event.
  const [hosting, setHosting] = useState(false);
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
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
        universityId: campus.universityId || undefined,
        campusId: campus.campusId || undefined,
        departmentId: campus.departmentId || undefined,
        newDepartmentName: campus.newDepartmentName.trim() || undefined,
        organizationName: hosting
          ? form.organizationName.trim() || undefined
          : undefined,
      }),
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

    router.push(destination ?? (hosting ? "/dashboard" : "/"));
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ivory px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-5">
            <WordMark size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-charcoal">
            Know what dey happen
          </h1>
          <p className="text-secondary-text text-sm mt-1">
            Events around your campus, and your tickets in one place.
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

          <div className="border-t border-border pt-4">
            <CampusPicker value={campus} onChange={setCampus} />
          </div>

          <div className="border-t border-border pt-4">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-charcoal">
              <input
                type="checkbox"
                checked={hosting}
                onChange={(e) => setHosting(e.target.checked)}
                className="mt-0.5 accent-[#6C3CFF]"
              />
              <span>
                I also run events
                <span className="block text-xs text-secondary-text">
                  Sell tickets, invite gate staff, track payouts.
                </span>
              </span>
            </label>

            {hosting && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-charcoal mb-1">
                  What&apos;s the name people know you by?
                </label>
                <input
                  value={form.organizationName}
                  onChange={(e) => update("organizationName", e.target.value)}
                  placeholder="e.g. UNICROSS SUG, Faculty of Law"
                  className="w-full rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-purple text-white font-semibold py-2.5 hover:bg-purple-deep transition-colors disabled:opacity-60"
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
                onClick={() =>
                  signIn("google", { callbackUrl: destination ?? "/" })
                }
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 font-semibold text-charcoal hover:bg-ivory transition-colors"
              >
                <GoogleIcon />
                Continue with Google
              </button>

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
