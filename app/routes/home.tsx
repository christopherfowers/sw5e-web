export function meta() {
  return [
    { title: "Star Wars 5e — Community Reference" },
    {
      name: "description",
      content:
        "A community reference for Star Wars 5e: rules, species, classes, powers, equipment, and starships.",
    },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">Star Wars 5e</h1>
      <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
        A community reference for the Star Wars 5e tabletop roleplaying game.
      </p>
    </main>
  );
}
