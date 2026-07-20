"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Paginated } from "@vertik12/shared";
import { get, post, ApiClientError } from "@/lib/api";
import { humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cx } from "@/components/ui";
import { Pager } from "@/components/data-table";
import { Icon } from "@/components/icons";

/**
 * Internal messaging for every portal — email-like inbox/sent/compose.
 * Staff write to anyone; parents/students write to school staff.
 */

interface Person { id: string; firstName: string; lastName: string; role: string; email: string }
interface MessageRow {
  id: string;
  subject: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  sender?: Person;
  recipient?: Person;
}

type Box = "inbox" | "sent";

export default function MessagesPage() {
  const [box, setBox] = useState<Box>("inbox");
  const [inbox, setInbox] = useState<(Paginated<MessageRow> & { unread: number }) | null>(null);
  const [sent, setSent] = useState<Paginated<MessageRow> | null>(null);
  const [inboxPage, setInboxPage] = useState(1);
  const [sentPage, setSentPage] = useState(1);
  const [open, setOpen] = useState<MessageRow | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);

  const load = useCallback(async () => {
    const [i, s] = await Promise.all([
      get<Paginated<MessageRow> & { unread: number }>(`/messages/inbox?page=${inboxPage}&pageSize=15`),
      get<Paginated<MessageRow>>(`/messages/sent?page=${sentPage}&pageSize=15`),
    ]);
    setInbox(i);
    setSent(s);
  }, [inboxPage, sentPage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openMessage(m: MessageRow) {
    setOpen(m);
    if (box === "inbox" && !m.readAt) {
      await get(`/messages/${m.id}`); // marks read server-side
      await load();
    }
  }

  const rows = box === "inbox" ? inbox?.items : sent?.items;
  const pager = box === "inbox" ? inbox : sent;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Messages"
        subtitle="Internal mail between the school and its staff, parents and students"
        actions={<Button onClick={() => { setReplyTo(null); setShowCompose(true); }}><Icon name="mail" className="h-4 w-4" /> Compose</Button>}
      />

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium text-slate-600 w-fit">
        {(["inbox", "sent"] as const).map((b) => (
          <button key={b} onClick={() => setBox(b)}
            className={cx("rounded-md px-4 py-1.5 transition-colors", box === b ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-800")}>
            {b === "inbox" ? `Inbox${inbox && inbox.unread > 0 ? ` (${inbox.unread})` : ""}` : "Sent"}
          </button>
        ))}
      </div>

      <Card>
        {!rows ? (
          <div className="flex justify-center py-16 text-brand-600"><Spinner /></div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">
            {box === "inbox" ? "Your inbox is empty." : "You haven't sent any messages yet."}
          </p>
        ) : (
          <ul className="list-scroll divide-y divide-slate-100">
            {rows.map((m) => {
              const person = box === "inbox" ? m.sender : m.recipient;
              const unread = box === "inbox" && !m.readAt;
              return (
                <li key={m.id}>
                  <button onClick={() => void openMessage(m)}
                    className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                      {person ? person.firstName[0] : "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={cx("truncate text-sm", unread ? "font-semibold text-slate-900" : "text-slate-700")}>
                          {person ? `${person.firstName} ${person.lastName}` : "Unknown"}
                          <span className="ml-2 text-xs font-normal text-slate-400">{person && humanize(person.role)}</span>
                        </p>
                        <span className="shrink-0 text-xs text-slate-400">{new Date(m.createdAt).toLocaleString()}</span>
                      </div>
                      <p className={cx("truncate text-sm", unread ? "font-medium text-slate-800" : "text-slate-500")}>
                        {m.subject}
                      </p>
                    </div>
                    {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {pager && (
          <Pager
            page={pager.page}
            totalPages={pager.totalPages}
            onPage={box === "inbox" ? setInboxPage : setSentPage}
          />
        )}
      </Card>

      {/* read view */}
      <Modal open={!!open} title={open?.subject ?? ""} onClose={() => setOpen(null)} wide>
        {open && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <p>
                {box === "inbox" ? "From" : "To"}:{" "}
                <span className="font-medium text-slate-800">
                  {(box === "inbox" ? open.sender : open.recipient)?.firstName}{" "}
                  {(box === "inbox" ? open.sender : open.recipient)?.lastName}
                </span>{" "}
                <Badge tone="gray">{humanize((box === "inbox" ? open.sender : open.recipient)?.role ?? "")}</Badge>
              </p>
              <span className="text-xs">{new Date(open.createdAt).toLocaleString()}</span>
            </div>
            <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-700">{open.body}</div>
            {box === "inbox" && (
              <div className="flex justify-end">
                <Button onClick={() => { setReplyTo(open); setOpen(null); setShowCompose(true); }}>Reply</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ComposeModal
        open={showCompose}
        replyTo={replyTo}
        onClose={() => setShowCompose(false)}
        onSent={async () => {
          setShowCompose(false);
          await load();
          setBox("sent");
        }}
      />
    </div>
  );
}

function ComposeModal({ open, replyTo, onClose, onSent }: {
  open: boolean;
  replyTo: MessageRow | null;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [recipients, setRecipients] = useState<Person[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    get<Person[]>("/messages/recipients").then(setRecipients).catch(() => setRecipients([]));
    if (replyTo?.sender) {
      setRecipientId(replyTo.sender.id);
      setSubject(replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`);
    } else {
      setRecipientId("");
      setSubject("");
    }
    setBody("");
    setError(null);
  }, [open, replyTo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await post("/messages", { recipientId, subject, body });
      await onSent();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} title={replyTo ? "Reply" : "New message"} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="To">
          <Select value={recipientId} onChange={(e) => setRecipientId(e.target.value)} required>
            <option value="">Choose a recipient…</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.firstName} {r.lastName} — {humanize(r.role)} ({r.email})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} />
        </Field>
        <Field label="Message">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={sending}>Send</Button>
        </div>
      </form>
    </Modal>
  );
}
