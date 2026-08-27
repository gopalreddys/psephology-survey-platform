"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  Authenticator,
  useAuthenticator
} from "@aws-amplify/ui-react";

import "@aws-amplify/ui-react/styles.css";

import {
  BarChart3,
  Database,
  FileText,
  LayoutDashboard,
  LogOut,
  Map,
  Megaphone,
  Phone,
  Settings,
  Users
} from "lucide-react";

import {
  useCurrentUser
} from "@/hooks/useCurrentUser";


type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "CAMPAIGN_MANAGER"
  | "CAMPAIGNER";


type MenuItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href?: string;
  roles: Role[];
};


const menuItems: MenuItem[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER",
      "CAMPAIGNER"
    ]
  },

  {
  label: "Programs",
  icon: FileText,
  href: "/programs",
  roles: [
    "SUPER_ADMIN",
    "ADMIN",
    "CAMPAIGN_MANAGER",
    "CAMPAIGNER"
  ]
},

  {
    label: "Geography",
    icon: Map,
    href: "/geography",
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER"
    ]
  },

  {
    label: "Users",
    icon: Users,
    href: "/users",
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER"
    ]
  },

  {
    label: "Voter Data",
  icon: Database,
  href: "/voters",
  roles: [
    "SUPER_ADMIN",
    "ADMIN",
    "CAMPAIGN_MANAGER",
    "CAMPAIGNER"
  ]
  },

  {
    label: "Campaigns",
    icon: Megaphone,
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER",
      "CAMPAIGNER"
    ]
  },

  {
    label: "Calls",
    icon: Phone,
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER",
      "CAMPAIGNER"
    ]
  },

  {
    label: "Analytics",
    icon: BarChart3,
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER"
    ]
  },

  {
    label: "Pipeline",
    icon: Settings,
    roles: [
      "SUPER_ADMIN"
    ]
  }
];


function AuthenticatedShell({
  children
}: {
  children: ReactNode;
}) {
  const {
    signOut
  } = useAuthenticator();

  const {
    user,
    loading,
    error
  } = useCurrentUser();


  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">
          Loading platform profile...
        </div>
      </div>
    );
  }


  if (!user || error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">

          <h1 className="text-xl font-semibold text-slate-900">
            Access unavailable
          </h1>

          <p className="mt-3 text-sm text-slate-500">
            {error ||
              "Your account is not registered in the platform."}
          </p>

          <button
            type="button"
            onClick={signOut}
            className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
          >
            Sign out
          </button>

        </div>
      </div>
    );
  }


  const role =
    user.role.code as Role;


  const visibleMenu =
    menuItems.filter(
      (item) =>
        item.roles.includes(role)
    );


  return (
    <div className="min-h-screen bg-slate-50">

      <aside className="fixed left-0 top-0 flex h-screen w-64 flex-col bg-slate-950 text-white">

        <div className="border-b border-slate-800 px-6 py-6">

          <div className="text-lg font-bold">
            Psephology AI
          </div>

          <div className="mt-1 text-xs text-slate-400">
            Survey Platform
          </div>

        </div>


        <nav className="flex-1 space-y-1 px-3 py-5">

          {visibleMenu.map(
            (item) => {
              const Icon =
                item.icon;

              if (item.href) {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
                  >
                    <Icon size={19} />

                    <span>
                      {item.label}
                    </span>
                  </Link>
                );
              }


              return (
                <div
                  key={item.label}
                  className="flex w-full cursor-default items-center gap-3 rounded-lg px-4 py-3 text-left text-sm text-slate-500"
                >
                  <Icon size={19} />

                  <span>
                    {item.label}
                  </span>
                </div>
              );
            }
          )}

        </nav>


        <div className="border-t border-slate-800 p-4">

          <div className="px-2">

            <div className="truncate text-sm font-medium text-white">
              {user.name}
            </div>

            <div className="mt-1 text-xs text-slate-400">
              {user.role.name}
            </div>

            <div className="mt-1 truncate text-xs text-slate-500">
              {user.email}
            </div>

          </div>


          <button
            type="button"
            onClick={signOut}
            className="mt-4 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <LogOut size={18} />

            <span>
              Sign out
            </span>
          </button>

        </div>

      </aside>


      <main className="ml-64 min-h-screen">
        {children}
      </main>

    </div>
  );
}


export default function AppShell({
  children
}: {
  children: ReactNode;
}) {
  return (
    <Authenticator
      hideSignUp={true}
      loginMechanisms={[
        "email"
      ]}
    >
      <AuthenticatedShell>
        {children}
      </AuthenticatedShell>
    </Authenticator>
  );
}
