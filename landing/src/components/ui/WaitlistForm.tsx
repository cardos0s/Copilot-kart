"use client";

import { motion } from "framer-motion";
import { useState, type FormEvent } from "react";

type Status = "idle" | "sending" | "ok" | "error";

export function WaitlistForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          "form-name": "entrar-cockpit",
          email,
        }).toString(),
      });
      setStatus(res.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "ok") {
    return (
      <p className="data text-sm font-semibold uppercase tracking-[0.25em] text-[#0a0a0d]">
        🏁 Você está no grid. Te avisamos por e-mail.
      </p>
    );
  }

  return (
    <form
      name="entrar-cockpit"
      method="POST"
      data-netlify="true"
      netlify-honeypot="bot-field"
      onSubmit={handleSubmit}
      className="flex w-full max-w-xl flex-col gap-3 sm:flex-row"
    >
      <input type="hidden" name="form-name" value="entrar-cockpit" />
      <p className="hidden">
        <label>
          Não preencha: <input name="bot-field" />
        </label>
      </p>
      <input
        type="email"
        name="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="SEU E-MAIL"
        aria-label="Seu e-mail"
        className="data flex-1 border border-[#0a0a0d]/40 bg-transparent px-6 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-[#0a0a0d] placeholder:text-[#0a0a0d]/50 focus:border-[#0a0a0d] focus:outline-none"
      />
      <motion.button
        type="submit"
        disabled={status === "sending"}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className="data inline-flex items-center justify-center gap-3 border border-[#0a0a0d] bg-[#0a0a0d] px-8 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-senna-yellow transition-colors duration-300 hover:bg-carbon disabled:opacity-60"
      >
        {status === "sending" ? "Enviando…" : "Entrar no cockpit"}
        <span aria-hidden>→</span>
      </motion.button>
      {status === "error" && (
        <p className="data text-xs font-semibold uppercase tracking-[0.2em] text-red-700 sm:self-center">
          Erro ao enviar — tenta de novo.
        </p>
      )}
    </form>
  );
}
