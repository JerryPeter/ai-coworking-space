// Memory & Knowledge (spec 6.6, 9.3). "Missing" and "Cloned" come from backend flags
// (memory.exists / memory.identical_to_default); the frontend never diffs content itself.
import { CircleExclamationPoint, Copy, FileX, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { endpoints, refetch, useApi } from "../api/client";
import type { MemoryFile, Skill } from "../api/types";
import { MemoryBlock, splitEntries } from "../components/MemoryBlock";
import { Drawer, Modal } from "../components/ui/Drawer";
import { PixelAvatar } from "../components/ui/PixelAvatar";
import { EmptyState, ErrorPanel, RelTime, Skeleton } from "../components/ui/States";
import { setParams, useRoute } from "../lib/router";
import { useTeam } from "../lib/team";
import { useNow } from "../lib/time";
import { identity } from "../theme/agents";

function BadgePill({ icon, label, token, title }: { icon: React.ReactNode; label: string; token: string; title?: string }) {
  return <span className="badge" title={title} style={{ color: `var(--${token})`, background: `var(--${token}-subtle)` }}>{icon}{label}</span>;
}

export default function Memory() {
  const team = useTeam();
  const { params } = useRoute();
  const profiles = team.members.map((m) => m.id); // agents only (Claude CLI has no Hermes memory)
  const selected = params.get("profile") && profiles.includes(params.get("profile")!) ? params.get("profile")! : profiles[0];

  if (team.loading && !profiles.length) return <Skeleton h={400} r={12} />;
  if (team.error && !profiles.length) return <ErrorPanel what="profiles" error={team.error} onRetry={() => refetch(endpoints.agents)} />;

  return (
    <div className="mem-layout">
      <div className="ptabs" role="tablist" aria-label="Profiles" aria-orientation="vertical">
        {profiles.map((p) => <ProfileTab key={p} id={p} selected={p === selected} />)}
      </div>
      {selected && <ProfilePanel key={selected} id={selected} home={team.members.find((m) => m.id === selected)?.agent?.home} />}
    </div>
  );
}

function ProfileTab({ id, selected }: { id: string; selected: boolean }) {
  const mem = useApi(endpoints.memory(id), 120_000);
  const m = mem.data?.memory;
  const warn = m && (!m.exists || m.identical_to_default === true);
  const ident = identity(id);
  return (
    <button role="tab" aria-selected={selected} className="ptab" style={{ ["--agent-c" as string]: `var(${ident.cssVar})` }}
      onClick={() => setParams({ profile: id, skill: null }, true)}>
      <PixelAvatar id={id} size={24} tile={false} />
      <span className="truncate">{ident.displayName}</span>
      {warn && <CircleExclamationPoint size={14} className="warn" aria-label={!m!.exists ? "Memory file not found" : "Cloned from default profile"} />}
    </button>
  );
}

function ProfilePanel({ id, home }: { id: string; home?: string }) {
  const mem = useApi(endpoints.memory(id), 120_000);
  const now = useNow(30_000);
  const [compare, setCompare] = useState(false);
  const ident = identity(id);
  const m = mem.data?.memory;
  const u = mem.data?.user;
  const cloned = m?.identical_to_default === true;
  const missing = m && !m.exists;
  const def = identity("default").displayName;

  return (
    <div className="mem-main" role="tabpanel">
      <div className="mem-header">
        <PixelAvatar id={id} size={40} />
        <div style={{ minWidth: 0 }}>
          <div className="lg semibold">{ident.displayName}</div>
          <div className="mono-12 muted">{home ?? "Not Available"}</div>
        </div>
        <div className="row" style={{ marginLeft: "auto", flexWrap: "wrap" }}>
          {missing && <BadgePill icon={<FileX size={12} />} label="Memory file not found" token="status-offline" />}
          {cloned && (
            <>
              <BadgePill icon={<Copy size={12} />} label="Cloned from default profile" token="status-reviewing"
                title={`Identical to ${def}'s MEMORY.md. This profile hasn't saved its own memories yet.`} />
              <button className="btn btn-text" onClick={() => setCompare(true)}>Compare</button>
            </>
          )}
        </div>
      </div>

      <section className="section" aria-label="MEMORY.md">
        <div className="row"><span className="eyebrow">MEMORY.md</span>{m?.updated_at && <span className="xs muted">updated <RelTime t={m.updated_at} now={now} /></span>}</div>
        {mem.loading ? <Skeleton h={200} /> : mem.error ? (
          <ErrorPanel what="memory" error={mem.error} onRetry={() => refetch(endpoints.memory(id))} />
        ) : !m ? null : missing ? (
          <div className="card"><EmptyState icon={<FileX size={48} />} title={`No MEMORY.md for ${ident.displayName}`}
            body={<>Expected at <code className="inline-code">{m.source}</code>. The file is created the first time this agent saves a memory note.</>} /></div>
        ) : m.content == null ? (
          <ErrorPanel what="MEMORY.md" error={new Error(m.error ?? "content not returned")} />
        ) : splitEntries(m.content).length === 0 ? (
          <div className="card"><EmptyState title="MEMORY.md is empty." body={`${ident.displayName} hasn't saved any memories yet.`} /></div>
        ) : (
          <MemoryBlock path={m.source} content={m.content} entries sizeBytes={m.size_bytes}
            strip={cloned ? (
              <div className="info-strip">
                <Copy size={14} />
                <span style={{ flex: 1 }}>This file is identical to {def}'s MEMORY.md. It was copied when the profile was created and hasn't diverged yet.</span>
                <button className="btn btn-text" onClick={() => setCompare(true)}>Compare</button>
              </div>
            ) : undefined} />
        )}
      </section>

      <section className="section" aria-label="USER.md">
        <div className="row"><span className="eyebrow">USER.md</span>{u?.identical_to_default && <span className="xs" style={{ color: "var(--status-reviewing)" }}>identical to {def}'s USER.md</span>}</div>
        {mem.loading ? <Skeleton h={80} /> : !u ? null : !u.exists ? (
          <p className="sm muted">No USER.md for this profile</p>
        ) : u.content == null ? (
          <ErrorPanel what="USER.md" error={new Error(u.error ?? "content not returned")} />
        ) : (
          <MemoryBlock path={u.source} content={u.content} sizeBytes={u.size_bytes} />
        )}
      </section>

      <SkillsSection id={id} />

      <CompareModal open={compare} onClose={() => setCompare(false)} file={m} id={id} />
    </div>
  );
}

function CompareModal({ open, onClose, file, id }: { open: boolean; onClose: () => void; file?: MemoryFile; id: string }) {
  const def = useApi(open ? endpoints.memory("default") : null, 120_000);
  const d = def.data?.memory;
  return (
    <Modal open={open} onClose={onClose} title="Compare MEMORY.md">
      <p className="sm">{file?.identical_to_default ? "Files are identical (byte-for-byte, per the API's sha256 comparison)." : "Files differ."}</p>
      <dl className="kv">
        <dt>{identity(id).shortName}</dt><dd className="mono-12">{file?.source}<br />sha256 {file?.sha256 ?? "Not Available"} · {file?.size_bytes ?? "—"} bytes</dd>
        <dt>{identity("default").shortName}</dt><dd className="mono-12">{d?.source ?? "…"}<br />sha256 {d?.sha256 ?? "…"} · {d?.size_bytes ?? "—"} bytes</dd>
      </dl>
      {file?.content && d?.content && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div className="codeblock"><div className="codeblock-body plain-body" style={{ fontSize: 11, maxHeight: 360, overflow: "auto" }}>{file.content}</div></div>
          <div className="codeblock"><div className="codeblock-body plain-body" style={{ fontSize: 11, maxHeight: 360, overflow: "auto" }}>{d.content}</div></div>
        </div>
      )}
    </Modal>
  );
}

function SkillsSection({ id }: { id: string }) {
  const r = useApi(endpoints.skills(id), 300_000);
  const { params } = useRoute();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const skills = r.data?.skills ?? [];
  const cats = [...new Set(skills.map((s) => s.category ?? "uncategorized"))].sort();
  const list = skills.filter((s) => (!cat || (s.category ?? "uncategorized") === cat)
    && (!q || `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const groups = new Map<string, Skill[]>();
  list.forEach((s) => { const k = s.category ?? "uncategorized"; groups.set(k, [...(groups.get(k) ?? []), s]); });
  const open = params.get("skill") ? skills.find((s) => s.dir === params.get("skill")) : undefined;

  return (
    <section className="section" aria-label="Skills">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="eyebrow row" style={{ gap: 4 }}><Sparkles size={12} /> Skills</span>
        {r.data && <span className="count-pill">{r.data.count}</span>}
        <div style={{ flex: 1 }} />
        <label className="search-wrap"><Search size={14} /><input className="search-input" style={{ width: 200 }} placeholder="Search skills" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search skills" /></label>
      </div>
      {cats.length > 1 && (
        <div className="chips">
          <button className="chip" aria-pressed={!cat} onClick={() => setCat(null)}>All</button>
          {cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
        </div>
      )}
      {r.loading ? <Skeleton h={120} /> : r.error ? <ErrorPanel what="skills" error={r.error} onRetry={() => refetch(endpoints.skills(id))} />
        : !skills.length ? <EmptyState title="No skills installed for this profile." foot={r.data?.source} />
        : !list.length ? <p className="sm muted">No skills match.</p>
        : [...groups.entries()].map(([c, l]) => (
          <div key={c} className="skill-group">
            <div className="eyebrow">{c}</div>
            <div className="chips">{l.map((s) => (
              <button key={s.dir} className="chip" title={s.description ?? undefined} onClick={() => setParams({ skill: s.dir })}>{s.name}</button>
            ))}</div>
          </div>
        ))}
      {open && (
        <Drawer open onClose={() => setParams({ skill: null })} title={open.name} subtitle={open.category ?? "uncategorized"}>
          <dl className="kv">
            <dt>Description</dt><dd>{open.description ?? "Not Available"}</dd>
            <dt>Directory</dt><dd className="mono-12">{r.data?.source}{open.dir}</dd>
            <dt>Category</dt><dd>{open.category ?? "Not Available"}</dd>
          </dl>
          <div className="section">
            <div className="eyebrow">SKILL.md</div>
            <p className="sm muted">Not Available. The API doesn't expose SKILL.md contents yet (see API_CONTRACT.md §12).</p>
          </div>
        </Drawer>
      )}
    </section>
  );
}
