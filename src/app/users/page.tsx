"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type UserRow = {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  status: string;
  role_code: string;
  role_name: string;
  created_at: string;
};

const roleOptions = [
  {
    code: "ADMIN",
    label: "Admin",
  },
  {
    code: "CAMPAIGN_MANAGER",
    label: "Campaign Manager",
  },
  {
    code: "CAMPAIGNER",
    label: "Campaigner",
  },
];

export default function UsersPage() {
  const [users, setUsers] =
    useState<UserRow[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [showForm, setShowForm] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState<string | null>(null);

  const [form, setForm] =
    useState({
      fullName: "",
      email: "",
      phoneNumber: "",
      roleCode: "ADMIN",
    });

  async function loadUsers() {
    setLoading(true);

    try {
      const data =
        await apiFetch("/api/users");

      setUsers(data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load users"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createUser(
    event: React.FormEvent
  ) {
    event.preventDefault();

    setSaving(true);
    setMessage(null);

    try {
      await apiFetch(
        "/api/users",
        {
          method: "POST",

          body: JSON.stringify({
            fullName:
              form.fullName,

            email:
              form.email,

            phoneNumber:
              form.phoneNumber,

            roleCode:
              form.roleCode,

            accessLevel:
              "FULL"
          })
        }
      );

      setForm({
        fullName: "",
        email: "",
        phoneNumber: "",
        roleCode: "ADMIN"
      });

      setShowForm(false);

      setMessage(
        "User created successfully."
      );

      await loadUsers();

    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create user"
      );

    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>

      <div className="p-8">

        <div className="flex items-start justify-between">

          <div>
            <p className="text-sm font-medium text-indigo-600">
              Administration
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Users & Roles
            </h1>

            <p className="mt-2 text-slate-500">
              Create and manage platform administrators,
              campaign managers and campaigners.
            </p>
          </div>

          <button
            onClick={() =>
              setShowForm(
                !showForm
              )
            }
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Create User
          </button>

        </div>

        {message && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            {message}
          </div>
        )}

        {showForm && (

          <form
            onSubmit={createUser}
            className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >

            <h2 className="text-lg font-semibold text-slate-900">
              Create New User
            </h2>

            <div className="mt-6 grid gap-5 md:grid-cols-2">

              <Field
                label="Full Name"
              >
                <input
                  required
                  value={
                    form.fullName
                  }
                  onChange={(e) =>
                    setForm({
                      ...form,
                      fullName:
                        e.target.value
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </Field>

              <Field
                label="Email"
              >
                <input
                  required
                  type="email"
                  value={
                    form.email
                  }
                  onChange={(e) =>
                    setForm({
                      ...form,
                      email:
                        e.target.value
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </Field>

              <Field
                label="Phone Number"
              >
                <input
                  value={
                    form.phoneNumber
                  }
                  onChange={(e) =>
                    setForm({
                      ...form,
                      phoneNumber:
                        e.target.value
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </Field>

              <Field
                label="Role"
              >
                <select
                  value={
                    form.roleCode
                  }
                  onChange={(e) =>
                    setForm({
                      ...form,
                      roleCode:
                        e.target.value
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  {roleOptions.map(
                    (role) => (
                      <option
                        key={
                          role.code
                        }
                        value={
                          role.code
                        }
                      >
                        {role.label}
                      </option>
                    )
                  )}
                </select>
              </Field>

            </div>

            <div className="mt-6 flex justify-end gap-3">

              <button
                type="button"
                onClick={() =>
                  setShowForm(
                    false
                  )
                }
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>

              <button
                disabled={saving}
                type="submit"
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving
                  ? "Creating..."
                  : "Create User"}
              </button>

            </div>

          </form>

        )}

        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-6 py-4">

            <h2 className="font-semibold text-slate-900">
              Platform Users
            </h2>

          </div>

          {loading ? (

            <div className="p-8 text-sm text-slate-500">
              Loading users...
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full text-left">

                <thead className="bg-slate-50 text-xs uppercase text-slate-500">

                  <tr>
                    <th className="px-6 py-3">
                      Name
                    </th>

                    <th className="px-6 py-3">
                      Email
                    </th>

                    <th className="px-6 py-3">
                      Role
                    </th>

                    <th className="px-6 py-3">
                      Status
                    </th>
                  </tr>

                </thead>

                <tbody>

                  {users.map(
                    (user) => (

                      <tr
                        key={
                          user.id
                        }
                        className="border-t border-slate-100"
                      >

                        <td className="px-6 py-4 text-sm font-medium text-slate-900">
                          {
                            user.full_name
                          }
                        </td>

                        <td className="px-6 py-4 text-sm text-slate-600">
                          {
                            user.email
                          }
                        </td>

                        <td className="px-6 py-4 text-sm text-slate-600">
                          {
                            user.role_name
                          }
                        </td>

                        <td className="px-6 py-4">

                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                            {
                              user.status
                            }
                          </span>

                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          )}

        </div>

      </div>

    </AppShell>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">

      <span className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </span>

      {children}

    </label>
  );
}
