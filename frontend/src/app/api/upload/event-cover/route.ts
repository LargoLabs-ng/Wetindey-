import { NextRequest, NextResponse } from "next/server";
import {
  COVER_MAX_BYTES,
  COVER_TYPES,
  putEventCover,
  storageConfigured,
} from "@/lib/storage";
import {
  getSessionUserId,
  getOrganizationIdsForUser,
  requireEventCapability,
} from "@/lib/authz";

/**
 * POST /api/upload/event-cover
 *
 * Two callers: the edit form (an event already exists, so we check edit
 * rights on it) and the create form (no event yet, so we check the weaker
 * "this person runs an organization" rule). Either way an anonymous visitor
 * can never push bytes into our storage account.
 */
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!storageConfigured()) {
    return NextResponse.json(
      {
        error:
          "Image uploads aren't set up yet. Connect a Vercel Blob store to this project, or add BLOB_READ_WRITE_TOKEN.",
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const eventId = form.get("eventId");
  if (typeof eventId === "string" && eventId) {
    const access = await requireEventCapability(eventId, "event:edit");
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
  } else {
    const orgs = await getOrganizationIdsForUser(userId);
    if (orgs.length === 0) {
      return NextResponse.json(
        { error: "You need an organization before you can upload event art." },
        { status: 403 }
      );
    }
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file received" }, { status: 400 });
  }

  if (!COVER_TYPES[file.type]) {
    return NextResponse.json(
      { error: "That file type isn't supported. Use JPEG, PNG, WebP or AVIF." },
      { status: 415 }
    );
  }

  if (file.size > COVER_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      { error: `That image is ${mb}MB. The limit is 6MB — try exporting it smaller.` },
      { status: 413 }
    );
  }

  try {
    const hint = typeof form.get("slug") === "string" ? String(form.get("slug")) : "event";
    const { url } = await putEventCover(file, hint);
    return NextResponse.json({ url });
  } catch (error) {
    console.error("Cover upload failed:", error);
    return NextResponse.json(
      { error: "Upload failed. Try again in a moment." },
      { status: 502 }
    );
  }
}
