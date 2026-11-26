"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { NavHistory } from "@/components/nav-history";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <NavHistory />
      {children}
    </SessionProvider>
  );
}
