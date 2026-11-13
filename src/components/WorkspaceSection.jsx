import React, { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { t } from "../language.js";

export function DisclosurePanel({
  title,
  description,
  badge,
  children,
  defaultOpen = false,
  forceOpen = false,
  className = "",
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (forceOpen && ref.current) ref.current.open = true;
  }, [forceOpen]);
  return (
    <details
      ref={ref}
      className={"panel disclosure-panel " + className}
      open={defaultOpen || undefined}
    >
      <summary>
        <span>
          <strong>{t(title)}</strong>
          {description && <small>{t(description)}</small>}
        </span>
        {badge != null && <span className="disclosure-badge">{t(badge)}</span>}
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}

export function WorkspaceTabs({ value, onChange, items, label, panelId }) {
  function key(event) {
    const choices = items.filter((item) => !item.disabled),
      index = choices.findIndex((item) => item.id === value);
    let next;
    if (event.key === "ArrowRight")
      next = choices[(index + 1) % choices.length];
    if (event.key === "ArrowLeft")
      next = choices[(index - 1 + choices.length) % choices.length];
    if (event.key === "Home") next = choices[0];
    if (event.key === "End") next = choices.at(-1);
    if (next) {
      event.preventDefault();
      onChange(next.id);
      event.currentTarget
        .querySelector('[data-tab="' + next.id + '"]')
        ?.focus();
    }
  }
  return (
    <div
      className="workspace-tabs progression-tabs"
      role="tablist"
      aria-label={t(label)}
      onKeyDown={key}
    >
      {items.map((item) => (
        <button
          type="button"
          role="tab"
          data-tab={item.id}
          id={panelId + "-" + encodeURIComponent(item.id)}
          key={item.id}
          aria-controls={panelId}
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {t(item.label)}
          {item.count != null && <span>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
