// Code / memory block (spec 5.8). MEMORY.md is split on lines containing only "§".
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CopyButton } from "./ui/States";

export function splitEntries(content: string): string[] {
  return content.split(/^\s*§\s*$/m).map((e) => e.trim()).filter(Boolean);
}

export function MemoryBlock({
  path, content, entries = false, maxEntries, strip, sizeBytes,
}: { path: string; content: string; entries?: boolean; maxEntries?: number; strip?: ReactNode; sizeBytes?: number | null }) {
  const [all, setAll] = useState(false);
  const [tall, setTall] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const list = entries ? splitEntries(content) : [];
  const shown = maxEntries ? list.slice(0, maxEntries) : list;
  const lines = content.split("\n").length;

  useLayoutEffect(() => {
    if (body.current) setTall(body.current.scrollHeight > 480);
  }, [content, maxEntries]);

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="path truncate" title={path}>{path}</span>
        {sizeBytes != null && <span className="xs muted tabular" title="Budget limit isn't exposed by the API, so no usage meter">{sizeBytes.toLocaleString()} bytes{entries ? ` · ${list.length} ${list.length === 1 ? "entry" : "entries"}` : ""}</span>}
        <CopyButton text={content} label="Copy file contents" />
      </div>
      {strip}
      <div ref={body} className={`codeblock-body${tall && !all ? " limited" : ""}`}>
        {entries ? (
          shown.map((e, i) => (
            <div key={i} className="mem-entry"><span className="idx">#{i + 1}</span>{e}</div>
          ))
        ) : (
          <div className="plain-body">{content}</div>
        )}
      </div>
      {tall && !all && (
        <div className="show-all"><button className="btn-text btn" onClick={() => setAll(true)}>Show all ({lines} lines)</button></div>
      )}
    </div>
  );
}

