"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { markNotFound } from "@/lib/analytics/client";

/** Rendered by the 404 page so its page view is stored with page_type "404". */
export function NotFoundBeacon() {
    const pathname = usePathname();
    useEffect(() => {
        markNotFound(pathname);
    }, [pathname]);
    return null;
}
