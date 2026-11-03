import { redirect } from "next/navigation";

export default function OrganiserLoginPage() {
  redirect("/login?callbackUrl=%2Fdashboard");
}
