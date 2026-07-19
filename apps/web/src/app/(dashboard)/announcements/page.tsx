"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ANNOUNCEMENT_AUDIENCES, type Paginated } from "@vertik12/shared";
import { get, post, getSession, ApiClientError } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { Pager } from "@/components/data-table";
import { Icon } from "@/components/icons";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: string;
  pinned: boolean;
  createdAt: string;
  author: { firstName: string; lastName: string; role: string };
}

export default function AnnouncementsPage() {
  const [data, setData] = useState<Paginated<AnnouncementRow> | null>(null);
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", audience: "ALL", pinned: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Parents and students are read-only here: they see announcements
  // addressed to them but can never publish (the API enforces this too).
  const role = getSession()?.user.role;
  const canPublish = role === "SUPER_ADMIN" || role === "ADMIN" || role === "REGISTRAR" || role === "TEACHER";

  const load = useCallback(
    () => get<Paginated<AnnouncementRow>>(`/announcements?page=${page}&pageSize=10`).then(setData),
    [page],
  );
  useEffect(() => {
    void load().then(() =>
      // Reading the page clears the "new announcements" badge in the sidebar.
      post("/announcements/mark-seen")
        .then(() => window.dispatchEvent(new Event("vertik12:badges-refresh")))
        .catch(() => undefined),
    );
  }, [load]);
  const items = data?.items ?? null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await post("/announcements", form);
      setShowAdd(false);
      setForm({ title: "", body: "", audience: "ALL", pinned: false });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to publish");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Announcements"
        subtitle="School-wide or audience-targeted notices"
        actions={canPublish ? <Button onClick={() => setShowAdd(true)}>+ New announcement</Button> : undefined}
      />

      {!items ? (
        <div className="flex justify-center py-24 text-brand-600"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          {items.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-slate-900">
                  {a.pinned && <span title="Pinned" className="mr-1 inline-flex align-middle"><Icon name="pin" className="h-4 w-4" /></span>}
                  {a.title}
                </h2>
                <Badge tone="gray">{humanize(a.audience)}</Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{a.body}</p>
              <p className="mt-3 text-xs text-slate-400">
                {a.author.firstName} {a.author.lastName} · {formatDate(a.createdAt)}
              </p>
            </Card>
          ))}
          {items.length === 0 && <p className="py-16 text-center text-sm text-slate-400">No announcements yet.</p>}
          {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
        </div>
      )}

      <Modal open={showAdd} title="Publish announcement" onClose={() => setShowAdd(false)}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </Field>
          <Field label="Message">
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              rows={5}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              required
            />
          </Field>
          <div className="flex items-end gap-4">
            <Field label="Audience">
              <Select value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}>
                {ANNOUNCEMENT_AUDIENCES.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} />
              Pin to top
            </label>
          </div>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Publish</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
