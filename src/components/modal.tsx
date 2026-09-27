"use client";
import { useEffect, useRef } from "react";
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={ref} className="studio-dialog glass" aria-label={title} onCancel={onClose}><header><h2>{title}</h2><button type="button" className="secondary-button" onClick={onClose}>Close</button></header>{children}</dialog>;
}
