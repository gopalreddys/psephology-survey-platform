"use client";

import AppShell from "@/components/AppShell";

export default function Home() {
  return (
    <AppShell>
      <div className="p-8">
        <h1 className="text-3xl font-bold text-slate-900">
          Psephology Survey Dashboard
        </h1>

        <p className="mt-2 text-slate-500">
          AI-assisted survey operations and research analytics.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Studies" value="1" />
          <Card title="Contacts" value="71" />
          <Card title="Analyzed Calls" value="6" />
          <Card title="Pipeline" value="Healthy" />
        </div>
      </div>
    </AppShell>
  );
}

function Card({
  title,
  value
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-sm text-slate-500">
        {title}
      </div>

      <div className="mt-3 text-3xl font-bold text-slate-900">
        {value}
      </div>
    </div>
  );
}
