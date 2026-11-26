import { NextRequest, NextResponse } from "next/server";
import {
  COVER_MAX_BYTES,
  COVER_TYPES,
  putOrganizationLogo,
  storageConfigured,
} from "@/lib/storage";
import { getSessionUserId } from "@/lib/authz";

/**
 * POST /api/upload/org-logo
 *
 * Used by the organiser setup screen and the organisation settings page.
 * The setup screen runs BEFORE the organisation exists, so this only asks
 * for a signed-in account — the same bar the event-cover route sets for a
 * first-time creator. Saving the returned link onto an organisation goes
 * through /api/organization, which checks ownership.
 */
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "Image uploads aren't set up yet. You can add a logo later." },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
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
    const { url } = await putOrganizationLogo(file);
    return NextResponse.json({ url });
  } catch (error) {
    console.error("Logo upload failed:", error);
    return NextResponse.json(
      { error: "Upload failed. Try again in a moment." },
      { status: 502 }
    );
  }
}
