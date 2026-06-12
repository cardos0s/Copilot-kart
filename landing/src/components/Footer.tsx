export function Footer() {
  return (
    <footer className="bg-carbon py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 md:flex-row">
        <span className="display text-lg text-ink">
          COCKPIT
          <span className="ml-1 inline-block h-1.5 w-1.5 bg-senna-yellow" />
        </span>
        <p className="data max-w-md text-center text-[9px] uppercase leading-relaxed tracking-[0.2em] text-ink/35 md:text-right">
          Inspirado no legado do automobilismo brasileiro.
          <br />
          Sem afiliação com pilotos, equipes ou marcas oficiais.
        </p>
      </div>
    </footer>
  );
}
