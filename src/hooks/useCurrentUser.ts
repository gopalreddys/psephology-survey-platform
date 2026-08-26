"use client";

import {
  useEffect,
  useState
} from "react";

import {
  apiFetch
} from "@/lib/api";

export type PlatformRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "CAMPAIGN_MANAGER"
  | "CAMPAIGNER";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;

  role: {
    code: PlatformRole;
    name: string;
    hierarchyLevel: number;
  };

  geographies: Array<{
    id: string;
    name: string;
    geo_type: string;
    code: string | null;
    parent_id: string | null;
    access_level: string;
  }>;
};

export function useCurrentUser() {
  const [user, setUser] =
    useState<CurrentUser | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(function () {
    let cancelled = false;

    async function load() {
      try {
        const data =
          await apiFetch("/api/me");

        if (!cancelled) {
          setUser(data);
        }
      } catch (error) {
        if (!cancelled) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to load profile"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return function () {
      cancelled = true;
    };
  }, []);

  return {
    user,
    loading,
    error
  };
}
