"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  Users,
  ClipboardList,
  ShieldCheck,
  MapPinned,
  BrainCircuit,
  PhoneCall
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
  label: "Questionnaires",
  icon: ClipboardList,
  href: "/questionnaires",
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

  const pathname =
    usePathname();

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
    <div className="app-shell">

      <aside className="app-sidebar">

        <div className="app-sidebar-brand">

          <div className="app-brand-icon">
            <BarChart3 size={22} />
          </div>

          <div>
            <div className="app-brand-name">
              Psephology AI
            </div>

            <div className="app-brand-subtitle">
              Survey Intelligence
            </div>
          </div>

        </div>


        <div className="app-nav-label">
          WORKSPACE
        </div>


        <nav className="app-nav">

          {visibleMenu.map(
            (item) => {

              const Icon =
                item.icon;

              const active =
                Boolean(
                  item.href &&
                  (
                    pathname === item.href ||
                    (
                      item.href !== "/" &&
                      pathname.startsWith(
                        item.href + "/"
                      )
                    )
                  )
                );


              if (item.href) {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={
                      active
                        ? "app-nav-item app-nav-item-active"
                        : "app-nav-item"
                    }
                  >

                    <div className="app-nav-icon">
                      <Icon size={18} />
                    </div>

                    <span>
                      {item.label}
                    </span>

                    {active && (
                      <div className="app-nav-active-dot" />
                    )}

                  </Link>
                );
              }


              return (
                <div
                  key={item.label}
                  className="app-nav-item app-nav-item-disabled"
                >

                  <div className="app-nav-icon">
                    <Icon size={18} />
                  </div>

                  <span>
                    {item.label}
                  </span>

                  <span className="app-coming-soon">
                    Soon
                  </span>

                </div>
              );
            }
          )}

        </nav>


        <div className="app-sidebar-footer">

          <div className="app-user-card">

            <div className="app-user-avatar">
              {
                user.name
                  ?.charAt(0)
                  .toUpperCase()
              }
            </div>

            <div className="app-user-info">

              <div className="app-user-name">
                {user.name}
              </div>

              <div className="app-user-role">
                {user.role.name}
              </div>

            </div>

          </div>


          <button
            type="button"
            onClick={signOut}
            className="app-signout-button"
          >
            <LogOut size={17} />

            <span>
              Sign out
            </span>
          </button>

        </div>

      </aside>


      <div className="app-content-shell">

        <header className="app-topbar">

          <div>

            <div className="app-topbar-eyebrow">
              PSEPHOLOGY SURVEY PLATFORM
            </div>

            <div className="app-topbar-title">
              Research Workspace
            </div>

          </div>


          <div className="app-topbar-right">

            <div className="app-status-pill">
              <span className="app-status-dot" />
              Secure Session
            </div>

            <div className="app-topbar-user">

              <div className="app-topbar-avatar">
                {
                  user.name
                    ?.charAt(0)
                    .toUpperCase()
                }
              </div>

              <div className="app-topbar-user-copy">

                <span>
                  {user.name}
                </span>

                <small>
                  {user.email}
                </small>

              </div>

            </div>

          </div>

        </header>


        <main className="app-main">
          {children}
        </main>

      </div>

    </div>
  );
}


function LoginExperience() {
  return (
    <div className="login-page">

      <section className="login-brand-panel">

        <div className="login-brand-inner">

          <div className="login-brand-mark">
            <BarChart3 size={26} />
          </div>

          <div className="login-brand-copy">
            <span className="login-eyebrow">
              PSEPHOLOGY AI
            </span>

            <h1>
              Survey intelligence for better
              electoral research.
            </h1>

            <p>
              Manage voter research, AI voice surveys,
              field coverage and analytical insights
              from one secure platform.
            </p>
          </div>


          <div className="login-capabilities">

            <div className="login-capability">
              <div className="login-capability-icon">
                <PhoneCall size={18} />
              </div>

              <div>
                <strong>
                  AI Voice Surveys
                </strong>

                <span>
                  Execute structured multilingual
                  research at scale.
                </span>
              </div>
            </div>


            <div className="login-capability">
              <div className="login-capability-icon">
                <MapPinned size={18} />
              </div>

              <div>
                <strong>
                  Geography Intelligence
                </strong>

                <span>
                  Understand outcomes from constituency
                  to Mandal and village.
                </span>
              </div>
            </div>


            <div className="login-capability">
              <div className="login-capability-icon">
                <BrainCircuit size={18} />
              </div>

              <div>
                <strong>
                  Research Analytics
                </strong>

                <span>
                  Convert survey evidence into measurable
                  trends and research insights.
                </span>
              </div>
            </div>

          </div>


          <div className="login-brand-footer">
            <ShieldCheck size={17} />

            <span>
              Secure, role-based access
            </span>
          </div>

        </div>

      </section>


      <section className="login-form-panel">

        <div className="login-form-wrapper">

          <div className="login-mobile-brand">
            <div className="login-mobile-mark">
              <BarChart3 size={22} />
            </div>

            <div>
              <span>
                PSEPHOLOGY AI
              </span>

              <small>
                Survey & Voice Intelligence
              </small>
            </div>
          </div>


          <div className="login-form-heading">

            <span className="login-form-eyebrow">
              SECURE ACCESS
            </span>

            <h2>
              Welcome back
            </h2>

            <p>
              Sign in with your registered platform
              account to continue.
            </p>

          </div>


          <div className="login-authenticator">

            <Authenticator
              hideSignUp={true}
              loginMechanisms={[
                "email"
              ]}
            />

          </div>


          <div className="login-security-note">
            <ShieldCheck size={16} />

            <span>
              Authentication is protected through
              AWS Cognito.
            </span>
          </div>


          <div className="login-version">
            Psephology Survey Platform · Demo Environment
          </div>

        </div>

      </section>

    </div>
  );
}


export default function AppShell({
  children
}: {
  children: ReactNode;
}) {
  const {
    authStatus
  } = useAuthenticator(
    function (context) {
      return [
        context.authStatus
      ];
    }
  );


  if (
    authStatus ===
    "configuring"
  ) {
    return (
      <div className="login-loading">
        Loading secure access...
      </div>
    );
  }


  if (
    authStatus !==
    "authenticated"
  ) {
    return (
      <LoginExperience />
    );
  }


  return (
    <AuthenticatedShell>
      {children}
    </AuthenticatedShell>
  );
}
