"use client";

import { useEffect } from "react";

/** Same look as the bookings Modal, with a wider size option. */
export default function AdminModal({ isOpen, onClose, title, size = "lg", children, footer }) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const width = size === "sm" ? "max-w-md" : "max-w-3xl";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-[#052a50]/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92dvh] w-full ${width} flex-col overflow-hidden rounded-t-3xl bg-[#F7FAEE] shadow-2xl sm:rounded-3xl`}
      >
        <header className="flex items-center justify-between gap-4 border-b border-[#052a50]/10 px-5 py-4 sm:px-6">
          <h2 className="text-xl font-semibold text-[#052a50]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#052a50]/10 bg-white text-2xl text-[#052a50] transition hover:bg-[#e4b441]"
          >
            ×
          </button>
        </header>
        <div className="overflow-y-auto p-5 sm:p-6">{children}</div>
        {footer && <footer className="border-t border-[#052a50]/10 bg-white/60 px-5 py-4 sm:px-6">{footer}</footer>}
      </section>
    </div>
  );
}
