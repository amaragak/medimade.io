"use client";

import type { ChangeEvent, Ref } from "react";

function IconSearch({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  inputClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
};

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  "aria-label": ariaLabel,
  className = "",
  inputClassName = "",
  inputRef,
}: Props) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };
  return (
    <div className={`relative ${className}`.trim()}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
        <IconSearch />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={`w-full rounded-xl border border-border py-2.5 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted/70 focus:border-accent/50 ${
          /\bbg-/.test(inputClassName) ? "" : "bg-background"
        } ${inputClassName}`.trim()}
      />
    </div>
  );
}
