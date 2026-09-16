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
  minPrice: number | null;
  isFree: boolean;
  soldOut: boolean;
  ticketsLeft: number;
  createdAt?: string;
};

/**
 * Event cards.
 *
 * Three sizes on purpose. A grid of identical rectangles reads as a database
 * table; a feed with a lead item and smaller ones around it reads as
 * something a person arranged. The build document asks for exactly this.
 */

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  const time = d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
  const date = d.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  if (days > 1 && days < 7) return `${date} · ${time}`;
  return date;
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

/** A cover we do not have is a coloured field, not a grey box with an icon. */
function Fallback({ title }: { title: string }) {
  // Deterministic per event, so the same event is always the same colour.
  const hue = [...title].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="absolute inset-0 flex items-end p-4"
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 55% 22%), hsl(${(hue + 40) % 360} 60% 14%))`,
      }}
    >
      <span className="text-lg font-extrabold leading-tight text-white/85">
        {title}
      </span>
    </div>
  );
}

function Meta({ e, className = "" }: { e: CardEvent; className?: string }) {
  const place = [e.venueName, e.city].filter(Boolean).join(", ");
  return (
    <span className={`block truncate text-sm text-ink-2 ${className}`}>
      {when(e.startDatetime)}
      {place && ` · ${place}`}
    </span>
  );
}

function Price({ e }: { e: CardEvent }) {
  const label = priceLabel(e);
  if (!label) return null;
  return (
    <span
      className={`text-sm font-semibold ${
        e.soldOut || e.minPrice === null ? "text-ink-3" : "text-ink"
      }`}
    >
      {label}
    </span>
  );
}

/** The lead item — one per rail at most. */
export function FeaturedCard({ e }: { e: CardEvent }) {
  return (
    <Link href={`/events/${e.slug}`} className="group block">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl">
        {e.coverImage ? (
          <EventImage
            src={e.coverImage}
            alt={e.title}
            priority
            sizes="(max-width: 768px) 100vw, 66vw"
            className="transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <Fallback title={e.title} />
        )}
        {e.soldOut && (
          <span className="absolute left-3 top-3 rounded-full bg-black/75 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">
            Sold out
          </span>
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xl font-extrabold tracking-[-0.02em] text-ink">
            {e.title}
          </h3>
          <Meta e={e} className="mt-1" />
          {e.hook && (
            <p className="mt-1.5 line-clamp-2 text-sm text-ink-2">{e.hook}</p>
          )}
        </div>
        <Price e={e} />
      </div>
    </Link>
  );
}

/** The workhorse: rails and grids. */
export function EventCardItem({ e }: { e: CardEvent }) {
  return (
    <Link href={`/events/${e.slug}`} className="group block">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl">
        {e.coverImage ? (
          <EventImage
            src={e.coverImage}
            alt={e.title}
            sizes="(max-width: 768px) 70vw, 25vw"
            className="transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <Fallback title={e.title} />
        )}
        {e.soldOut && (
          <span className="absolute left-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur">
            Sold out
          </span>
        )}
      </div>
      <h3 className="mt-2.5 line-clamp-2 font-bold leading-snug tracking-[-0.01em] text-ink">
        {e.title}
      </h3>
      <Meta e={e} className="mt-0.5" />
      <div className="mt-1">
        <Price e={e} />
      </div>
    </Link>
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
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-ink">
            {title}
          </h2>
          {note && <p className="text-sm text-ink-3">{note}</p>}
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-sm font-semibold text-purple">
            See all →
          </Link>
        )}
      </div>

      {/* Scrolls horizontally on a phone — the whole point of a rail — and
          never makes the page itself scroll sideways. */}
      <div className="-mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {events.map((e) => (
          <div key={e.id} className="w-[70vw] shrink-0 sm:w-56">
            <EventCardItem e={e} />
          </div>
        ))}
      </div>
    </section>
  );
}
