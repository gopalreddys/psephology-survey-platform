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
  ReactNode
} from "react";

import {
  useCurrentUser
} from "@/hooks/useCurrentUser";


type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "CAMPAIGN_MANAGER"
  | "CAMPAIGNER";


const menuItems = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER",
      "CAMPAIGNER"
    ]
  },

  {
    label: "Studies",
    icon: FileText,
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER"
    ]
  },

  {
    label: "Geography",
    icon: Map,
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER"
    ]
  },

  {
    label: "Users",
    icon: Users,
    roles: [
      "SUPER_ADMIN",
      "ADMIN",
      "CAMPAIGN_MANAGER"
    ]
  },

  {
    label: "Contacts",
    icon: Database,
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
] satisfies Array<{
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
}>;


function AuthenticatedShell({
  children
}: {
  children: ReactNode;
}) {

  const {
    signOut
  } =
    useAuthenticator();


  const {
    user,
    loading,
    error
  } =
    useCurrentUser();


  if (loading) {

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">

        <div className="text-sm text-slate-500">
          Loading platform profile...
        </div>

      </div>
    );
  }


  if (
    error ||
    !user
  ) {

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">

        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow">

          <h1 className="text-xl font-semibold text-slate-900">
            Access unavailable
          </h1>

          <p className="mt-3 text-sm text-slate-500">
            {error ||
              "Your account is not registered in the platform."}
          </p>

          <button
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
    user.role.code;


  const visibleMenu =
    menuItems.filter(
      function (item) {

        return item.roles.includes(
          role
        );
      }
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
            function (item) {

              const Icon =
                item.icon;

              return (
                <button
                  key={item.label}
                  className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  <Icon size={19} />

                  {item.label}
                </button>
              );
            }
          )}

        </nav>


        <div className="border-t border-slate-800 p-4">

          <div className="px-2">

            <div className="truncate text-sm font-medium">
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
            onClick={signOut}
            className="mt-4 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut size={18} />
            Sign out
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
