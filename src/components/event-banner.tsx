"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { EventImage } from "@/components/event-image";
import { CoverFallback } from "@/components/event-card";
import {
  bannerSlides,
  youtubeEmbedUrl,
  youtubeThumbUrl,
  type GalleryItem,
} from "@/lib/media";

/**
 * The hero: cover art, plus whatever else the organiser added.
 *
 * Three rules it is built around:
 *
 *  1. The cover comes first, always. Somebody tapped a card with that image
 *     on it; opening to a different picture is disorienting.
 *  2. Nothing moves until there is something to move between. One slide gets
 *     no dots, no timer, no controls — the same markup the page had before.
 *  3. Video never starts by itself. A hero that begins talking when a page
 *     opens is a reason to close the tab, so a YouTube slide is a still
 *     frame with a play button until somebody presses it.
 */

const ROTATE_MS = 6000;

export function EventBanner({
  title,
  cover,
  gallery,
}: {
  title: string;
  cover: string | null | undefined;
  gallery: GalleryItem[] | null | undefined;
}) {
  const slides = bannerSlides(cover, gallery);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);

  // Rotation stops the moment a video is playing, and never starts for a
  // single slide. Sliding out from under somebody mid-video would be a
  // bizarre thing for a page to do.
  useEffect(() => {
    if (slides.length < 2 || playing) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      ROTATE_MS
    );
    return () => clearInterval(timer);
  }, [slides.length, playing]);

  // An organiser deleting a slide while somebody is looking at the last one
  // would otherwise leave the carousel pointing past the end.
  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [index, slides.length]);

  if (slides.length === 0) {
    return <CoverFallback title={title} />;
  }

  const current = slides[Math.min(index, slides.length - 1)];

  return (
    <>
      {current.kind === "image" ? (
        <EventImage src={current.url} alt={title} priority sizes="100vw" />
      ) : playing === current.url ? (
        <iframe
          src={youtubeEmbedUrl(current.url)}
          title={`${title} — video`}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(current.url)}
          className="group absolute inset-0 h-full w-full"
          aria-label={`Play the video for ${title}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={youtubeThumbUrl(current.url)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 backdrop-blur transition-transform group-hover:scale-110">
              <Play className="ml-0.5 h-7 w-7 fill-white text-white" />
            </span>
          </span>
        </button>
      )}

      {slides.length > 1 && (
        // Above the gradient the page lays over the hero, and clear of the
        // title block at the bottom left.
        <div className="absolute right-3 top-3 z-10 flex gap-1.5 sm:right-5 sm:top-5">
          {slides.map((s, i) => (
            <button
              key={`${s.kind}:${s.url}`}
              type="button"
              onClick={() => {
                setIndex(i);
                setPlaying(null);
              }}
              aria-label={`Show item ${i + 1} of ${slides.length}`}
              aria-current={i === index}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"
              }`}
            />
          ))}
        </div>
      )}
    </>
  );
}
