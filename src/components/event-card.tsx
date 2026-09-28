import Link from "next/link";
import { EventImage } from "@/components/event-image";
import { naira } from "@/lib/fees";

export type CardEvent = {
  id: string;
  slug: string;
  title: string;
  hook: string | null;
  coverImage: string | null;
  category: string | null;
  venueName: string | null;
  city: string | null;
  startDatetime: string;
  /**
   * Provisional. The date above is still real — it decides which rail this
   * card lands in and where it sorts — but nobody may see it, so the card
   * reads "Date TBA" and the "This week" signal stays quiet.
   */
  dateTbd?: boolean;
  venueTbd?: boolean;
  minPrice: number | null;
  isFree: boolean;
  soldOut: boolean;
  ticketsLeft: number;
  createdAt?: string;
  /** Real tickets issued for this event. Never estimated, never padded. */
  going?: number;
  /**
   * Campus this belongs to, when it has one. Cards don't display it — they
   * carry it so the pages doing the arranging can group by campus. Null
   * means public: an event that belongs to everyone, not to nobody.
   */
  universityId?: string | null;
  campusId?: string | null;
};

/**
 * Event cards.
 *
 * Three sizes on purpose. A grid of identical rectangles reads as a database
 * table; a feed with a lead item and smaller ones around it reads as
 * something a person arranged. The build document asks for exactly this.
 *
 * Titles sit ON the artwork rather than in a caption underneath. A caption
 * makes the image decoration; an overlay makes the image the card, which is
 * how every product students actually use presents an event.
 */

// Takes the event rather than the string so it can't be called without the
// TBA flag in hand — which is the one mistake that would print a provisional
// date on a public card.
function when(e: CardEvent) {
  if (e.dateTbd) return "Date TBA";
  const d = new Date(e.startDatetime);
  const now = new Date();
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  const time = d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
  const date = d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  if (days > 1 && days < 7) return `${date} · ${time}`;
  return date;
}

function place(e: CardEvent) {
  if (e.venueTbd) return e.city ?? "";
  return [e.venueName, e.city].filter(Boolean).join(", ");
}

function priceLabel(e: CardEvent) {
  if (e.soldOut) return "Sold out";
  if (e.isFree) return "Free";
  // No tiers at all. Publishing now requires one, so this is only reachable
  // by events published before that rule — but a card with a blank where the
  // price goes looks broken, and this says what is actually true.
  if (e.minPrice === null) return "Tickets coming";
  return `From ${naira(e.minPrice)}`;
}

/* ─────────────────────────────────────────────────────────────────────────
   Covers we do not have

   This used to derive a hue from the title across the whole 360° wheel,
   which is why half the app rendered in forest green and maroon — the old
   Ticket Buddy palette, arrived at by accident. The set below is fixed and
   entirely within the brand's violet/coral family, so a missing cover now
   looks deliberate instead of looking like a different product.
   ───────────────────────────────────────────────────────────────────────── */
const COVERS = [
  ["#4A22C9", "#160F2E"], // purple into indigo
  ["#1B1240", "#3A1C8C"], // indigo into purple, reversed
  ["#7A1E6B", "#1A0F2E"], // plum
  ["#3B1E7A", "#0F0B1A"], // violet into the darkest surface
  ["#B83A1E", "#2A0F26"], // coral, the one warm exception
  ["#2B2A8C", "#120E28"], // blue-violet
] as const;

function coverFor(title: string) {
  const n = [...title].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return COVERS[n % COVERS.length];
}

/**
 * A cover we do not have is a designed panel, not a grey box with an icon.
 * The question mark is the brand's recurring asset, so an event with no
 * artwork still reads as Wetin Dey rather than as a gap.
 *
 * Exported because the event page's hero needs the identical treatment — an
 * event that shows as a purple poster in a rail and then as a black
 * rectangle on its own page looks like two different events.
 */
export function CoverFallback({ title }: { title: string }) {
  const [from, to] = coverFor(title);
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[0.22em] -right-[0.06em] select-none text-[13em] font-extrabold leading-none text-white/[0.09]"
      >
        ?
      </span>
    </div>
  );
}

/** Darkens the foot of the artwork just enough to carry white text. */
function Scrim() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{
        background:
          "linear-gradient(to top, rgba(8,5,16,0.88) 0%, rgba(8,5,16,0.55) 32%, rgba(8,5,16,0.05) 68%, transparent 100%)",
      }}
    />
  );
}

function Pill({
  children,
  tone = "glass",
}: {
  children: React.ReactNode;
  tone?: "glass" | "purple" | "coral";
}) {
  const tones = {
    glass: "bg-white/15 text-white backdrop-blur-sm",
    purple: "bg-purple text-white",
    coral: "text-white",
  };
  // The inset white ring matters: a coral pill can land on a coral fallback
  // cover, or a purple one on purple artwork, and without an edge it
  // disappears into the background it is supposed to stand out from.
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] ring-1 ring-inset ring-white/30 ${tones[tone]}`}
      style={tone === "coral" ? { backgroundColor: "var(--color-coral-deep)" } : undefined}
    >
      {children}
    </span>
  );
}

/**
 * At most one honest signal per card.
 *
 * Every branch below is a fact we can prove from the database. There is no
 * "trending" badge and no invented attendance — an empty product that fakes
 * a crowd gets found out on the first event, and §20 of the brief rules it
 * out explicitly. Until the numbers are real the card simply says less.
 */
function signalFor(e: CardEvent): { text: string; tone: "purple" | "coral" | "glass" } | null {
  if (e.soldOut) return { text: "Sold out", tone: "glass" };

  // Five is where a number starts sounding like a room rather than a rounding
  // error. Below it, saying "2 going" actively makes an event look dead.
  if ((e.going ?? 0) >= 5) return { text: `${e.going} going`, tone: "purple" };

  if (e.ticketsLeft > 0 && e.ticketsLeft <= 10) {
    return { text: `${e.ticketsLeft} left`, tone: "coral" };
  }

  if (e.createdAt) {
    const age = Date.now() - new Date(e.createdAt).getTime();
    if (age >= 0 && age < 3 * 86400000) return { text: "Just dropped", tone: "coral" };
  }

  // Not for a provisional date. "This week" on an event whose date is openly
  // unconfirmed is the card contradicting itself two lines apart.
  if (!e.dateTbd) {
    const days = (new Date(e.startDatetime).getTime() - Date.now()) / 86400000;
    if (days >= 0 && days < 3) return { text: "This week", tone: "glass" };
  }

  return null;
}

function Signal({ e }: { e: CardEvent }) {
  const s = signalFor(e);
  if (!s) return null;
  return <Pill tone={s.tone}>{s.text}</Pill>;
}

function Price({ e, className = "" }: { e: CardEvent; className?: string }) {
  const label = priceLabel(e);
  return (
    <span
      className={`shrink-0 text-sm font-semibold ${
        e.soldOut || e.minPrice === null ? "text-ink-3" : "text-ink"
      } ${className}`}
    >
      {label}
    </span>
  );
}

/** The lead item — one per rail at most. Tall on a phone, wide on a desktop. */
export function FeaturedCard({ e }: { e: CardEvent }) {
  return (
    <Link
      href={`/events/${e.slug}`}
      className="group relative block aspect-[4/5] w-full overflow-hidden rounded-3xl sm:aspect-[16/9]"
    >
      {e.coverImage ? (
        <EventImage
          src={e.coverImage}
          alt={e.title}
          priority
          sizes="(max-width: 768px) 100vw, 66vw"
          className="transition-transform duration-700 group-hover:scale-[1.04]"
        />
      ) : (
        <CoverFallback title={e.title} />
      )}
      <Scrim />

      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          {e.category && <Pill>{e.category}</Pill>}
          <Signal e={e} />
        </div>

        <h3 className="mt-3 text-3xl font-extrabold leading-[1.03] tracking-[-0.035em] text-white sm:text-5xl">
          {e.title}
        </h3>

        {e.hook && (
          <p className="mt-2 line-clamp-2 max-w-xl text-sm text-white/70 sm:text-base">
            {e.hook}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-white/85">
          <span>{when(e)}</span>
          {place(e) && (
            <>
              <span aria-hidden="true" className="text-white/35">
                ·
              </span>
              <span className="truncate">{place(e)}</span>
            </>
          )}
          <span aria-hidden="true" className="text-white/35">
            ·
          </span>
          <span className={e.soldOut ? "text-white/55" : "text-white"}>
            {priceLabel(e)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** The workhorse: rails and grids. A poster, not a thumbnail with a caption. */
export function EventCardItem({ e }: { e: CardEvent }) {
  return (
    <Link href={`/events/${e.slug}`} className="group block">
      {/* One ratio, everywhere. A `fill` variant briefly existed so this card
          could stretch to match a landscape lead beside it; the layout that
          needed it is gone, and with it the only way for two cards in a row
          to end up different heights. */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl">
        {e.coverImage ? (
          <EventImage
            src={e.coverImage}
            alt={e.title}
            sizes="(max-width: 768px) 78vw, 30vw"
            className="transition-transform duration-700 group-hover:scale-[1.05]"
          />
        ) : (
          <CoverFallback title={e.title} />
        )}
        <Scrim />

        <div className="absolute inset-x-0 top-0 flex flex-wrap gap-2 p-3">
          <Signal e={e} />
        </div>

        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/65">
            {when(e)}
          </p>
          <h3 className="mt-1 line-clamp-3 text-lg font-extrabold leading-[1.12] tracking-[-0.02em] text-white">
            {e.title}
          </h3>
        </div>
      </div>

      <div className="mt-2.5 flex shrink-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-ink-2">
          {place(e) || "Venue to be announced"}
        </span>
        <Price e={e} />
      </div>
    </Link>
  );
}

function RailHeading({
  title,
  note,
  href,
}: {
  title: string;
  note?: string;
  href?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div>
        <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">
          {title}
        </h2>
        {note && <p className="mt-0.5 text-sm text-ink-3">{note}</p>}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 text-sm font-semibold text-purple hover:underline"
        >
          See all →
        </Link>
      )}
    </div>
  );
}

/** A horizontal rail that scrolls on a phone and lays out on a desktop. */
export function EventRail({
  title,
  note,
  events,
  href,
}: {
  title: string;
  note?: string;
  events: CardEvent[];
  href?: string;
}) {
  if (events.length === 0) return null;
  return (
    <section className="mt-14">
      <RailHeading title={title} note={note} href={href} />

      {/* Scrolls horizontally on a phone — the whole point of a rail — and
          never makes the page itself scroll sideways. */}
      <div className="-mx-4 mt-5 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {events.map((e) => (
          <div key={e.id} className="w-[62vw] max-w-[260px] shrink-0 sm:w-60">
            <EventCardItem e={e} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * One event, given the whole width.
 *
 * The only honest reason to make a card bigger than its neighbours is that
 * it genuinely outranks them. "The next thing happening" is such a reason —
 * it is soonest, and that is a fact rather than a layout preference. So the
 * big treatment is reserved for exactly one event and comes with a heading
 * that says why it earned it.
 */
export function EventFeature({
  title,
  note,
  event,
  href,
}: {
  title: string;
  note?: string;
  event: CardEvent | undefined;
  href?: string;
}) {
  if (!event) return null;
  return (
    <section className="mt-14">
      <RailHeading title={title} note={note} href={href} />
      <div className="mt-5">
        <FeaturedCard e={event} />
      </div>
    </section>
  );
}
