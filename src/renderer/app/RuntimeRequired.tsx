type RuntimeRequiredProps = {
  message: string;
};

export function RuntimeRequired({ message }: RuntimeRequiredProps) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f6ff] p-8">
      <section className="max-w-lg rounded-2xl border border-[#dedbe9] bg-white p-8 shadow-xl shadow-brand-900/5">
        <h1 className="text-2xl font-extrabold text-[#1a1b22]">
          Electron desktop runtime required
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#686577]">{message}</p>
      </section>
    </main>
  );
}
