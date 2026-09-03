"use client";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  CheckCircle2,
  Mail,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  X
} from "lucide-react";

import AppShell
  from "@/components/AppShell";

import {
  apiFetch
} from "@/lib/api";


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
    label: "Admin"
  },
  {
    code: "CAMPAIGN_MANAGER",
    label: "Campaign Manager"
  },
  {
    code: "CAMPAIGNER",
    label: "Campaigner"
  }
];


export default function UsersPage() {

  const [
    users,
    setUsers
  ] =
    useState<UserRow[]>([]);

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    showForm,
    setShowForm
  ] =
    useState(false);

  const [
    saving,
    setSaving
  ] =
    useState(false);

  const [
    message,
    setMessage
  ] =
    useState<string | null>(
      null
    );

  const [
    search,
    setSearch
  ] =
    useState("");

  const [
    roleFilter,
    setRoleFilter
  ] =
    useState("ALL");

  const [
    form,
    setForm
  ] =
    useState({
      fullName: "",
      email: "",
      phoneNumber: "",
      roleCode: "ADMIN"
    });


  async function loadUsers() {

    setLoading(true);

    try {

      const data =
        await apiFetch(
          "/api/users"
        );

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


  useEffect(
    function () {
      loadUsers();
    },
    []
  );


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

          body:
            JSON.stringify({
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


  const filteredUsers =
    useMemo(
      function () {

        const query =
          search
            .trim()
            .toLowerCase();

        return users.filter(
          function (user) {

            const roleMatches =
              roleFilter === "ALL" ||
              user.role_code === roleFilter;

            if (!roleMatches) {
              return false;
            }

            if (!query) {
              return true;
            }

            return [
              user.full_name,
              user.email,
              user.phone_number,
              user.role_name,
              user.role_code,
              user.status
            ]
              .filter(Boolean)
              .some(
                function (value) {

                  return String(value)
                    .toLowerCase()
                    .includes(query);
                }
              );
          }
        );

      },
      [
        users,
        search,
        roleFilter
      ]
    );


  const activeUsers =
    users.filter(
      function (user) {
        return user.status === "ACTIVE";
      }
    ).length;


  const administrators =
    users.filter(
      function (user) {
        return user.role_code === "ADMIN";
      }
    ).length;


  const campaignManagers =
    users.filter(
      function (user) {
        return user.role_code === "CAMPAIGN_MANAGER";
      }
    ).length;


  const campaigners =
    users.filter(
      function (user) {
        return user.role_code === "CAMPAIGNER";
      }
    ).length;


  return (
    <AppShell>

      <div className="users-admin-page">

        <section className="users-admin-header">

          <div>

            <div className="users-admin-eyebrow">
              PLATFORM ADMINISTRATION
            </div>

            <h1>
              Users & Roles
            </h1>

            <p>
              Manage authorized platform users and
              assign operational roles across research,
              survey execution and administration.
            </p>

          </div>


          <button
            type="button"

            onClick={
              function () {
                setShowForm(
                  !showForm
                );
              }
            }

            className="users-create-button"
          >
            <Plus size={16} />
            Create User
          </button>

        </section>


        {message && (

          <div className="users-admin-message">
            {message}
          </div>

        )}


        <section className="users-summary-grid">

          <UserMetric
            icon={Users}
            label="Platform Users"
            value={
              String(
                users.length
              )
            }
          />

          <UserMetric
            icon={CheckCircle2}
            label="Active Users"
            value={
              String(
                activeUsers
              )
            }
          />

          <UserMetric
            icon={ShieldCheck}
            label="Administrators"
            value={
              String(
                administrators
              )
            }
            emphasis
          />

          <UserMetric
            icon={UserCog}
            label="Campaign Managers"
            value={
              String(
                campaignManagers
              )
            }
          />

          <UserMetric
            icon={Users}
            label="Campaigners"
            value={
              String(
                campaigners
              )
            }
          />

        </section>


        {showForm && (

          <form
            onSubmit={
              createUser
            }

            className="users-create-panel"
          >

            <div className="users-create-header">

              <div>

                <div className="users-admin-eyebrow">
                  ACCESS MANAGEMENT
                </div>

                <h2>
                  Create New User
                </h2>

                <p>
                  Add an authorized user and assign
                  the appropriate platform role.
                </p>

              </div>


              <button
                type="button"

                onClick={
                  function () {
                    setShowForm(false);
                  }
                }

                className="users-close-button"
              >
                <X size={18} />
              </button>

            </div>


            <div className="users-create-body">

              <div className="users-form-heading">

                <div className="users-form-icon">
                  <UserCog size={17} />
                </div>

                <div>

                  <h3>
                    User Identity & Access
                  </h3>

                  <p>
                    Define user identity, contact
                    information and platform role.
                  </p>

                </div>

              </div>


              <div className="users-form-grid">

                <Field label="Full Name">

                  <input
                    required

                    value={
                      form.fullName
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          fullName:
                            event.target.value
                        });
                      }
                    }

                    className="users-input"
                  />

                </Field>


                <Field label="Email">

                  <input
                    required
                    type="email"

                    value={
                      form.email
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          email:
                            event.target.value
                        });
                      }
                    }

                    className="users-input"
                  />

                </Field>


                <Field label="Phone Number">

                  <input
                    value={
                      form.phoneNumber
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          phoneNumber:
                            event.target.value
                        });
                      }
                    }

                    className="users-input"
                  />

                </Field>


                <Field label="Role">

                  <select
                    value={
                      form.roleCode
                    }

                    onChange={
                      function (event) {

                        setForm({
                          ...form,
                          roleCode:
                            event.target.value
                        });
                      }
                    }

                    className="users-input"
                  >

                    {
                      roleOptions.map(
                        function (role) {

                          return (

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

                          );
                        }
                      )
                    }

                  </select>

                </Field>

              </div>


              <div className="users-role-guidance">

                <RoleGuidance
                  title="Admin"
                  description="Platform administration and configuration."
                />

                <RoleGuidance
                  title="Campaign Manager"
                  description="Research and survey execution management."
                />

                <RoleGuidance
                  title="Campaigner"
                  description="Operational survey execution access."
                />

              </div>

            </div>


            <div className="users-create-footer">

              <button
                type="button"

                onClick={
                  function () {
                    setShowForm(false);
                  }
                }

                className="users-cancel-button"
              >
                Cancel
              </button>


              <button
                disabled={
                  saving
                }

                type="submit"

                className="users-save-button"
              >

                {
                  saving
                    ? "Creating..."
                    : (
                      <>
                        <Plus size={15} />
                        Create User
                      </>
                    )
                }

              </button>

            </div>

          </form>

        )}


        <section className="users-master-panel">

          <div className="users-master-toolbar">

            <div>

              <div className="users-admin-eyebrow">
                ACCESS DIRECTORY
              </div>

              <h2>
                Platform Users
              </h2>

              <p>
                Review user identities, assigned
                roles and current account status.
              </p>

            </div>


            <div className="users-toolbar-actions">

              <div className="users-search">

                <Search size={15} />

                <input
                  value={
                    search
                  }

                  onChange={
                    function (event) {
                      setSearch(
                        event.target.value
                      );
                    }
                  }

                  placeholder="Search users"
                />

              </div>


              <select
                value={
                  roleFilter
                }

                onChange={
                  function (event) {
                    setRoleFilter(
                      event.target.value
                    );
                  }
                }

                className="users-role-filter"
              >

                <option value="ALL">
                  All Roles
                </option>

                {
                  roleOptions.map(
                    function (role) {

                      return (

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

                      );
                    }
                  )
                }

              </select>

            </div>

          </div>


          {
            loading
              ? (

                <div className="users-loading">
                  Loading users...
                </div>

              )
              : filteredUsers.length === 0
                ? (

                  <div className="users-empty">

                    <Users size={27} />

                    <strong>
                      No matching users
                    </strong>

                    <span>
                      Try another name, email or role.
                    </span>

                  </div>

                )
                : (

                  <div className="users-table-wrap">

                    <table className="users-table">

                      <thead>

                        <tr>

                          <th>
                            User
                          </th>

                          <th>
                            Contact
                          </th>

                          <th>
                            Role
                          </th>

                          <th>
                            Status
                          </th>

                          <th>
                            Created
                          </th>

                        </tr>

                      </thead>


                      <tbody>

                        {
                          filteredUsers.map(
                            function (user) {

                              return (

                                <tr key={user.id}>

                                  <td>

                                    <div className="users-user-cell">

                                      <div className="users-avatar">

                                        {
                                          getInitials(
                                            user.full_name
                                          )
                                        }

                                      </div>

                                      <div>

                                        <strong>
                                          {
                                            user.full_name
                                          }
                                        </strong>

                                        <span>
                                          {
                                            user.role_code
                                          }
                                        </span>

                                      </div>

                                    </div>

                                  </td>


                                  <td>

                                    <div className="users-contact">

                                      <span>
                                        <Mail size={12} />
                                        {user.email}
                                      </span>

                                      {
                                        user.phone_number
                                          ? (
                                            <span>
                                              <Phone size={12} />
                                              {user.phone_number}
                                            </span>
                                          )
                                          : null
                                      }

                                    </div>

                                  </td>


                                  <td>

                                    <span className="users-role-badge">
                                      {
                                        user.role_name ||
                                        formatLabel(
                                          user.role_code
                                        )
                                      }
                                    </span>

                                  </td>


                                  <td>

                                    <span
                                      className={
                                        user.status === "ACTIVE"
                                          ? "users-status active"
                                          : "users-status"
                                      }
                                    >
                                      {
                                        formatLabel(
                                          user.status
                                        )
                                      }
                                    </span>

                                  </td>


                                  <td>

                                    <span className="users-created">
                                      {
                                        formatDate(
                                          user.created_at
                                        )
                                      }
                                    </span>

                                  </td>

                                </tr>

                              );
                            }
                          )
                        }

                      </tbody>

                    </table>

                  </div>

                )
          }


          <div className="users-access-note">

            <ShieldCheck size={14} />

            <span>
              Platform permissions continue to be
              enforced by authenticated role-based access.
            </span>

          </div>

        </section>

      </div>

    </AppShell>
  );
}


function UserMetric({
  icon: Icon,
  label,
  value,
  emphasis = false
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  emphasis?: boolean;
}) {

  return (

    <div
      className={
        emphasis
          ? "users-summary-card emphasis"
          : "users-summary-card"
      }
    >

      <div className="users-summary-icon">
        <Icon size={17} />
      </div>

      <div>

        <span>
          {label}
        </span>

        <strong>
          {value}
        </strong>

      </div>

    </div>
  );
}


function RoleGuidance({
  title,
  description
}: {
  title: string;
  description: string;
}) {

  return (

    <div className="users-role-guidance-card">

      <ShieldCheck size={14} />

      <div>

        <strong>
          {title}
        </strong>

        <span>
          {description}
        </span>

      </div>

    </div>
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

    <label className="users-field">

      <span>
        {label}
      </span>

      {children}

    </label>
  );
}


function getInitials(
  value: string
) {

  if (!value) {
    return "?";
  }

  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(
      function (part) {
        return part.charAt(0);
      }
    )
    .join("")
    .toUpperCase();
}


function formatDate(
  value: string
) {

  if (!value) {
    return "-";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  );
}


function formatLabel(
  value: string
) {

  if (!value) {
    return "-";
  }

  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(
      /\b\w/g,
      function (character) {
        return character.toUpperCase();
      }
    );
}
