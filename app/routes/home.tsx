import { ThemeMenu } from "~/components/theme-menu";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-6 py-6 sm:px-10 sm:py-8">
      <header className="flex justify-end">
        <ThemeMenu />
      </header>
      <section className="flex flex-1 items-center justify-center py-16 text-center">
        <div className="max-w-md space-y-3">
          <p className="text-sm font-medium text-muted-foreground">React SPA foundation</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Launchpad</h1>
          <p className="text-pretty text-base leading-7 text-muted-foreground">
            Your project is ready to build on.
          </p>
        </div>
      </section>
    </main>
  );
}
