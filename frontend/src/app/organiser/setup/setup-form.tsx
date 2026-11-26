"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { OrgLogoPicker } from "@/components/org-logo-picker";

const label = "mb-1.5 block text-sm font-semibold text-ink";
const field =
  "w-full rounded-xl border border-line bg-white px-3.5 py-3 text-ink placeholder:text-ink-2/60 focus:outline-none focus:ring-2 focus:ring-purple";

/**
 * Name (required), logo (optional), payout account (optional).
 *
 * Saving happens in two steps — the organisation first, then the bank
 * details through the existing Finance route, so the "your payout account
 * changed" alert keeps a single source. If the bank step fails, the
 * organisation is already saved: the form says so and offers to skip
 * rather than making them type their name again.
 */
export function SetupForm({
  initialName,
  initialLogoUrl,
  next,
}: {
  initialName: string;
  initialLogoUrl: string | null;
  next: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl);
  const [showBank, setShowBank] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  const [orgSaved, setOrgSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bankStarted = Boolean(bankName.trim() || accountName.trim() || accountNumber.trim());

  function goOn() {
    router.replace(next);
    router.refresh();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (!orgSaved) {
        const res = await fetch("/api/organization", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, logoUrl }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Couldn't save that. Try again.");
          return;
        }
        setOrgSaved(true);
      }

      if (showBank && bankStarted) {
        const res = await fetch("/api/finance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "bank",
            bankName: bankName.trim(),
            accountName: accountName.trim(),
            accountNumber: accountNumber.replace(/\s+/g, ""),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(
            `Your organisation is saved, but the bank details weren't: ${
              data.error ?? "check them and try again"
            }. You can also skip this and add them later in Finance.`
          );
          return;
        }
      }

      goOn();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <div>
        <label className={label} htmlFor="org-name">
          Name people know you by
        </label>
        <input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. UNICROSS SUG, Faculty of Law"
          maxLength={200}
          required
          disabled={orgSaved}
          autoComplete="organization"
          className={field}
        />
      </div>

      <div>
        <span className={label}>
          Logo <span className="font-normal text-ink-2">(optional)</span>
        </span>
        {orgSaved ? (
          <p className="text-sm text-ink-2">Saved.</p>
        ) : (
          <OrgLogoPicker value={logoUrl} onChange={setLogoUrl} />
        )}
      </div>

      <div className="rounded-2xl border border-line bg-card">
        <button
          type="button"
          onClick={() => setShowBank((v) => !v)}
          aria-expanded={showBank}
          aria-controls="setup-bank"
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-ink">
              Where should we send your money?
            </span>
            <span className="block text-xs text-ink-2">
              Optional now — needed before you can withdraw.
            </span>
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-ink-2 transition-transform ${showBank ? "rotate-180" : ""}`}
          />
        </button>
        {showBank && (
          <div id="setup-bank" className="space-y-4 border-t border-line px-4 py-4">
            <div>
              <label className={label} htmlFor="bank-name">Bank</label>
              <input
                id="bank-name"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. GTBank"
                className={field}
              />
            </div>
            <div>
              <label className={label} htmlFor="account-name">Account name</label>
              <input
                id="account-name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label className={label} htmlFor="account-number">Account number</label>
              <input
                id="account-number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                inputMode="numeric"
                placeholder="10 digits"
                className={field}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-coral/40 bg-coral/10 px-3.5 py-3 text-sm text-coral">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-purple py-3.5 font-semibold text-white transition-colors hover:bg-purple-deep disabled:opacity-60"
        >
          {busy ? "Saving…" : orgSaved ? "Save bank details" : "Continue"}
        </button>
        {orgSaved && (
          <button
            type="button"
            onClick={goOn}
            className="w-full rounded-xl border border-line py-3 font-semibold text-ink hover:bg-surface-2"
          >
            Skip for now
          </button>
        )}
      </div>
    </form>
  );
}
