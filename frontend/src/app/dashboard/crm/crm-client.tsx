"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Mail, Plus, Search, Tag, X } from "lucide-react";
import { csvCell } from "@/lib/csv";

type OrganizationContact = {
  id: string;
  name: string;
  marketingConsent: boolean;
  optedOut: boolean;
  tags: string[];
};

type ContactHistory = {
  eventId: string;
  eventTitle: string;
  organizationId: string;
  purchasedAt: string;
  orderStatus: string;
  total: number;
  tickets: Array<{
    name: string;
    email: string;
    type: string;
    status: string;
    checkedInAt: string | null;
  }>;
  answers: Array<{ label: string; value: string }>;
  refunds: Array<{
    amount: number;
    status: string;
    reason: string | null;
    createdAt: string;
  }>;
};

type Contact = {
  email: string;
  phone: string;
  orderCount: number;
  ticketCount: number;
  spend: number;
  lastPurchaseAt: string;
  organizations: OrganizationContact[];
  history: ContactHistory[];
};

type CrmData = {
  organizations: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; organizationId: string; name: string }>;
  contacts: Contact[];
};

async function fetchCrmData(): Promise<CrmData> {
  const response = await fetch("/api/dashboard/crm");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load contacts.");
  return result as CrmData;
}

function money(amount: number) {
  return `₦${amount.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CrmClient() {
  const [data, setData] = useState<CrmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [consentFilter, setConsentFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagToAssign, setTagToAssign] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchCrmData()
      .then((result) => {
        if (!active) return;
        setData(result);
        setOrganizationId((current) => current || result.organizations[0]?.id || "");
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load contacts.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await fetchCrmData();
    setData(result);
    setOrganizationId((current) => current || result.organizations[0]?.id || "");
  }, []);

  const events = useMemo(() => {
    const unique = new Map<string, string>();
    for (const contact of data?.contacts ?? []) {
      for (const item of contact.history) unique.set(item.eventId, item.eventTitle);
    }
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.contacts ?? []).filter((contact) => {
      const eventHistory = contact.history.filter(
        (item) => eventFilter === "all" || item.eventId === eventFilter
      );
      if (eventFilter !== "all" && eventHistory.length === 0) return false;
      if (
        query &&
        !contact.email.toLowerCase().includes(query) &&
        !contact.history.some(
          (item) =>
            item.eventTitle.toLowerCase().includes(query) ||
            item.tickets.some((ticket) => ticket.name.toLowerCase().includes(query))
        )
      ) {
        return false;
      }
      const hasConsent = contact.organizations.some((item) => item.marketingConsent);
      const hasOptOut = contact.organizations.some((item) => item.optedOut);
      if (consentFilter === "opted-in" && !hasConsent) return false;
      if (consentFilter === "opted-out" && !hasOptOut) return false;
      if (consentFilter === "no-consent" && (hasConsent || hasOptOut)) return false;
      if (
        tagFilter !== "all" &&
        !contact.organizations.some((item) => item.tags.includes(tagFilter))
      ) {
        return false;
      }
      return true;
    });
  }, [consentFilter, data, eventFilter, search, tagFilter]);

  const selectedContact = data?.contacts.find((contact) => contact.email === selectedEmail);
  const selectedOrganization = selectedContact?.organizations.find(
    (item) => item.id === organizationId
  );
  const selectedTags = (data?.tags ?? []).filter(
    (tag) => tag.organizationId === organizationId
  );

  async function updateContact(body: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update contact.");
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update contact.");
    } finally {
      setBusy(false);
    }
  }

  async function createTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !tagName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, name: tagName.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create tag.");
      setTagName("");
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create tag.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTag(tagId: string, name: string) {
    if (!window.confirm(`Delete the "${name}" tag from your contacts?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard/crm", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete tag.");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete tag.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const rows = [
      ["Email", "Phone", "Tickets", "Orders", "Paid spend", "Last purchase", "Organisations", "Consent by organisation", "Tags"],
      ...filteredContacts.map((contact) => [
        contact.email,
        contact.phone,
        contact.ticketCount,
        contact.orderCount,
        contact.spend.toFixed(2),
        contact.lastPurchaseAt,
        contact.organizations.map((item) => item.name).join("; "),
        contact.organizations
          .map((item) => `${item.name}: ${item.optedOut ? "opted out" : item.marketingConsent ? "opted in" : "no consent"}`)
          .join("; "),
        contact.organizations.flatMap((item) => item.tags).join("; "),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "wetin-dey-contacts.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-purple">Organiser tools</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Contacts</h1>
          <p className="mt-2 text-sm text-ink-2">
            Ticket-buyer history, tags, and marketing preferences for your organisation.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!data || filteredContacts.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral">
          {error}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-ink-3" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search email, attendee, event"
            className="w-full rounded-lg border border-line bg-white py-2.5 pl-9 pr-3 text-sm"
          />
        </label>
        <select
          value={eventFilter}
          onChange={(event) => setEventFilter(event.target.value)}
          className="rounded-lg border border-line bg-white px-3 py-2.5 text-sm"
        >
          <option value="all">All events</option>
          {events.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
        <select
          value={consentFilter}
          onChange={(event) => setConsentFilter(event.target.value)}
          className="rounded-lg border border-line bg-white px-3 py-2.5 text-sm"
        >
          <option value="all">All consent statuses</option>
          <option value="opted-in">Opted in</option>
          <option value="opted-out">Opted out</option>
          <option value="no-consent">No consent</option>
        </select>
        <select
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
          className="rounded-lg border border-line bg-white px-3 py-2.5 text-sm"
        >
          <option value="all">All tags</option>
          {[...new Set((data?.tags ?? []).map((tag) => tag.name))].sort().map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      <form onSubmit={createTag} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3">
        <Tag className="h-4 w-4 text-purple" />
        <select
          value={organizationId}
          onChange={(event) => {
            setOrganizationId(event.target.value);
            setTagToAssign("");
          }}
          className="rounded-lg border border-line px-3 py-2 text-sm"
          aria-label="Tag organisation"
        >
          {(data?.organizations ?? []).map((organization) => (
            <option key={organization.id} value={organization.id}>{organization.name}</option>
          ))}
        </select>
        <input
          value={tagName}
          onChange={(event) => setTagName(event.target.value)}
          maxLength={60}
          placeholder="New tag name"
          className="min-w-40 flex-1 rounded-lg border border-line px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !tagName.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-purple px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Create tag
        </button>
      </form>
      {(data?.tags ?? []).some((tag) => tag.organizationId === organizationId) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-3">Your tags:</span>
          {(data?.tags ?? [])
            .filter((tag) => tag.organizationId === organizationId)
            .map((tag) => (
              <span key={tag.id} className="inline-flex items-center gap-1 rounded-full bg-purple/10 px-3 py-1 text-xs font-semibold text-purple">
                {tag.name}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteTag(tag.id, tag.name)}
                  aria-label={`Delete ${tag.name} tag`}
                  className="rounded-full hover:text-coral disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-cream-2 text-ink-2">
            <tr>
              <th className="px-4 py-3 font-semibold">Contact</th>
              <th className="px-4 py-3 font-semibold">Tickets / events</th>
              <th className="px-4 py-3 font-semibold">Marketing</th>
              <th className="px-4 py-3 font-semibold">Paid spend</th>
              <th className="px-4 py-3 font-semibold">Last purchase</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-3">Loading contacts…</td></tr>
            ) : filteredContacts.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-3">No ticket buyers match these filters.</td></tr>
            ) : filteredContacts.map((contact) => (
              <tr
                key={contact.email}
                onClick={() => {
                  setSelectedEmail(contact.email);
                  setOrganizationId(contact.organizations[0]?.id ?? "");
                  setTagToAssign("");
                }}
                className="cursor-pointer border-t border-line hover:bg-cream-2/60"
              >
                <td className="px-4 py-3">
                  <p className="font-semibold text-ink">{contact.email}</p>
                  <p className="text-xs text-ink-3">{contact.phone}</p>
                </td>
                <td className="px-4 py-3 text-ink-2">
                  <p>{contact.ticketCount} ticket{contact.ticketCount === 1 ? "" : "s"}</p>
                  <p className="mt-1 max-w-xs truncate text-xs text-ink-3">
                    {[...new Set(contact.history.map((item) => item.eventTitle))].join(", ")}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {contact.organizations.some((item) => item.marketingConsent) ? (
                    <span className="rounded-full bg-ok/10 px-2.5 py-1 text-xs font-semibold text-ok">Opted in</span>
                  ) : contact.organizations.some((item) => item.optedOut) ? (
                    <span className="rounded-full bg-coral/10 px-2.5 py-1 text-xs font-semibold text-coral">Opted out</span>
                  ) : <span className="text-xs text-ink-3">No consent</span>}
                </td>
                <td className="px-4 py-3 font-medium text-ink">{money(contact.spend)}</td>
                <td className="px-4 py-3 text-ink-2">{dateTime(contact.lastPurchaseAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">Showing {filteredContacts.length} of {data?.contacts.length ?? 0} contacts.</p>

      {selectedContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedEmail(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-purple">Contact history</p>
                <h2 id="contact-title" className="mt-1 break-all text-xl font-bold text-ink">{selectedContact.email}</h2>
                <p className="mt-1 text-sm text-ink-3">{selectedContact.phone}</p>
              </div>
              <button onClick={() => setSelectedEmail(null)} aria-label="Close contact details" className="rounded-lg p-2 text-ink-3 hover:bg-cream-2">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-cream-2 p-3"><p className="text-xs text-ink-3">Tickets</p><p className="mt-1 font-bold text-ink">{selectedContact.ticketCount}</p></div>
              <div className="rounded-lg bg-cream-2 p-3"><p className="text-xs text-ink-3">Orders</p><p className="mt-1 font-bold text-ink">{selectedContact.orderCount}</p></div>
              <div className="rounded-lg bg-cream-2 p-3"><p className="text-xs text-ink-3">Paid spend</p><p className="mt-1 font-bold text-ink">{money(selectedContact.spend)}</p></div>
            </div>

            {selectedContact.organizations.length > 0 && (
              <div className="mt-5 space-y-3 rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="contact-org" className="text-sm font-semibold text-ink">Organisation</label>
                  <select
                    id="contact-org"
                    value={organizationId}
                    onChange={(event) => {
                      setOrganizationId(event.target.value);
                      setTagToAssign("");
                    }}
                    className="rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    {selectedContact.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>{organization.name}</option>
                    ))}
                  </select>
                </div>
                {selectedOrganization && (
                  <>
                    <p className="text-sm text-ink-2">
                      Marketing:{" "}
                      <strong>{selectedOrganization.optedOut ? "Opted out" : selectedOrganization.marketingConsent ? "Opted in" : "No consent"}</strong>
                    </p>
                    {!selectedOrganization.optedOut && (
                      <button
                        disabled={busy}
                        onClick={() => void updateContact({
                          action: "opt-out",
                          email: selectedContact.email,
                          organizationId: selectedOrganization.id,
                        })}
                        className="text-sm font-semibold text-coral underline disabled:opacity-50"
                      >
                        Record marketing opt-out
                      </button>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="contact-tag" className="text-sm font-semibold text-ink">Add tag</label>
                      <select
                        id="contact-tag"
                        value={tagToAssign}
                        onChange={(event) => setTagToAssign(event.target.value)}
                        className="rounded-lg border border-line px-3 py-2 text-sm"
                      >
                        <option value="">Select tag</option>
                        {selectedTags.map((tag) => (
                          <option key={tag.id} value={tag.id}>{tag.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || !tagToAssign}
                        onClick={() => {
                          void updateContact({
                            action: "assign-tag",
                            email: selectedContact.email,
                            tagId: tagToAssign,
                          });
                        }}
                        className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                      >
                        Assign
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedOrganization.tags.map((name) => {
                        const tag = selectedTags.find((item) => item.name === name);
                        return tag ? (
                          <button
                            key={tag.id}
                            type="button"
                            disabled={busy}
                            onClick={() => void updateContact({ action: "remove-tag", email: selectedContact.email, tagId: tag.id })}
                            title="Remove tag"
                            className="inline-flex items-center gap-1 rounded-full bg-purple/10 px-3 py-1 text-xs font-semibold text-purple disabled:opacity-50"
                          >
                            {name} <X className="h-3 w-3" />
                          </button>
                        ) : null;
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="mt-6">
              <h3 className="font-bold text-ink">Purchase and attendee history</h3>
              <div className="mt-3 space-y-3">
                {selectedContact.history.map((item, index) => (
                  <article key={`${item.eventId}-${item.purchasedAt}-${index}`} className="rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-ink">{item.eventTitle}</h4>
                        <p className="mt-1 text-xs text-ink-3">{dateTime(item.purchasedAt)} · {item.orderStatus}</p>
                      </div>
                      <p className="font-semibold text-ink">{money(item.total)}</p>
                    </div>
                    {item.tickets.length > 0 && (
                      <ul className="mt-3 space-y-1 text-sm text-ink-2">
                        {item.tickets.map((ticket, ticketIndex) => (
                          <li key={`${ticket.email}-${ticketIndex}`}>
                            <span className="font-medium">{ticket.name}</span> · {ticket.type} · {ticket.status}
                            {ticket.checkedInAt ? ` · Checked in ${dateTime(ticket.checkedInAt)}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.answers.length > 0 && (
                      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                        {item.answers.map((answer, answerIndex) => (
                          <div key={`${answer.label}-${answerIndex}`}><dt className="font-semibold text-ink-3">{answer.label}</dt><dd className="text-ink-2">{answer.value || "—"}</dd></div>
                        ))}
                      </dl>
                    )}
                    {item.refunds.length > 0 && (
                      <p className="mt-3 text-xs text-coral">
                        Refunds: {item.refunds.map((refund) => `${money(refund.amount)} (${refund.status})`).join(", ")}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </div>
            <a href={`mailto:${selectedContact.email}`} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-purple">
              <Mail className="h-4 w-4" /> Email contact
            </a>
          </section>
        </div>
      )}
    </section>
  );
}
