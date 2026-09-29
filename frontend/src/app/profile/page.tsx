"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Check } from "lucide-react";
import { WordMark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  CampusPicker,
  EMPTY_CAMPUS_SELECTION,
  type CampusSelection,
} from "@/components/campus-picker";

/**
 * Your profile.
 *
 * Exists because campus context could only ever be set during signup. Every
 * account made before those fields existed had no university and no way to
 * acquire one — and since an event inherits its campus from whoever creates
 * it, those accounts also produced events belonging to nowhere. Campus-aware
 * discovery was switched off for them permanently, by omission.
 */
export default function ProfilePage() {
  const { status } = useSession();

  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [campus, setCampus] = useState<CampusSelection>(EMPTY_CAMPUS_SELECTION);
  const [universityName, setUniversityName] = useState<string | null>(null);
  const [departmentPending, setDepartmentPending] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") {
      if (status === "unauthenticated") setLoading(false);
      return;
    }
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (!me) return;
        setFirstName(me.firstName ?? "");
        setLastName(me.lastName ?? "");
        setEmail(me.email ?? "");
        setUniversityName(me.universityName ?? null);
        setDepartmentPending(!!me.departmentPending);
        setCampus({
          universityId: me.universityId ?? "",
          campusId: me.campusId ?? "",
          departmentId: me.departmentId ?? "",
          newDepartmentName: "",
        });
      })
      .catch(() => setError("Couldn't load your profile."))
      .finally(() => setLoading(false));
  }, [status]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        universityId: campus.universityId || null,
        campusId: campus.campusId || null,
        departmentId: campus.departmentId || null,
        newDepartmentName: campus.newDepartmentName || undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Couldn't save that.");
      return;
    }

    setSaved(true);
    // Re-read rather than trusting the local state: a department typed by
    // hand comes back with an id and a pending flag that only the server
    // knows about.
    const me = await fetch("/api/profile").then((r) => r.json());
    setUniversityName(me.universityName ?? null);
    setDepartmentPending(!!me.departmentPending);
    setCampus({
      universityId: me.universityId ?? "",
      campusId: me.campusId ?? "",
      departmentId: me.departmentId ?? "",
      newDepartmentName: "",
    });
  }

  const field =
    "w-full rounded-xl border border-line bg-cream px-4 py-3 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple";
  const label = "mb-1 block text-sm font-semibold text-ink";

  return (
    <div className="wd-night flex min-h-screen flex-col bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <WordMark />
          <div className="flex items-center gap-3">
            <Link
              href="/my-events"
              className="text-sm font-semibold text-ink-2 hover:text-ink"
            >
              My events
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-ink">
          Your profile
        </h1>
        <p className="mt-2 text-ink-2">
          Your university is what decides whose events you see first.
        </p>

        {status === "unauthenticated" ? (
          <div className="mt-6 rounded-2xl border border-line bg-card p-6">
            <p className="text-ink-2">
              <Link href="/login" className="font-semibold text-purple hover:underline">
                Sign in
              </Link>{" "}
              to see your profile.
            </p>
          </div>
        ) : loading ? (
          <p className="mt-6 text-ink-3">Loading…</p>
        ) : (
          <form onSubmit={save} className="mt-6 space-y-5">
            <div className="rounded-2xl border border-line bg-card p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="firstName">
                    First name
                  </label>
                  <input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="lastName">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className={field}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className={label} htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  value={email}
                  readOnly
                  disabled
                  className={`${field} cursor-not-allowed opacity-60`}
                />
                <p className="mt-1 text-xs text-ink-3">
                  Changing this changes how you sign in, so it isn&apos;t a
                  profile edit. Ask us if you need it moved.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-card p-5 sm:p-6">
              <h2 className="text-lg font-extrabold tracking-[-0.02em] text-ink">
                Where you study
              </h2>
              <p className="mb-4 mt-1 text-sm text-ink-2">
                {universityName
                  ? `You're set to ${universityName}. Events there show up first on your home page.`
                  : "Pick your university and your campus events move to the top of your home page."}
              </p>

              <CampusPicker
                value={campus}
                onChange={setCampus}
                labelClass={label}
                fieldClass={field}
              />

              {departmentPending && (
                <p className="mt-3 text-xs text-ink-3">
                  Your department is saved and waiting to be checked against
                  the school&apos;s list — it&apos;s yours already, it just
                  won&apos;t show in anyone else&apos;s picker yet.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-coral">{error}</p>}

            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-purple px-6 py-3 font-bold text-white hover:bg-purple-deep disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              {saved && !saving && (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ok">
                  <Check className="h-4 w-4" />
                  Saved
                </span>
              )}
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
