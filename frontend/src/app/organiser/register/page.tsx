import { redirect } from "next/navigation";

export default function OrganiserRegisterPage() {
  redirect("/signup?hosting=1&callbackUrl=%2Fdashboard");
}
