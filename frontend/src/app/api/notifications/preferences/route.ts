import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { allowRequest } from "@/lib/notifications/rate-limit";
import { CATEGORIES, setPreference } from "@/lib/notifications/preferences";
import { canChange, settingsFor, SHOWN_CHANNELS } from "@/lib/notifications/settings";

/** GET /api/notifications/preferences — the signed-in person's settings page. */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    return NextResponse.json({ sections: await settingsFor(userId, session.user?.email) });
  } catch (error) {
    console.error("Could not load notification settings:", error);
    return NextResponse.json({ error: "Couldn't load your settings." }, { status: 500 });
  }
}

const schema = z.object({
  category: z.enum(CATEGORIES),
  channel: z.enum(SHOWN_CHANNELS),
  enabled: z.boolean(),
});

/** PATCH /api/notifications/preferences { category, channel, enabled } — change one switch. */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!allowRequest(`prefs:${userId}`, 60)) {
    return NextResponse.json({ error: "Too many changes at once. Wait a moment." }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That isn't a setting." }, { status: 400 });
  const { category, channel, enabled } = parsed.data;
  try {
    if (!(await canChange(userId, session.user?.email, category, channel))) {
      return NextResponse.json({ error: "That one can't be changed." }, { status: 403 });
    }
    const result = await setPreference(userId, category, channel, enabled);
    if (!result.ok) return NextResponse.json({ error: "That one can't be changed." }, { status: 403 });
    return NextResponse.json({ ok: true, category, channel, enabled });
  } catch (error) {
    console.error("Could not save notification setting:", error);
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }
}
