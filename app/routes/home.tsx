import { PauseIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

export default function Home() {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <main className="min-h-svh bg-black p-6 sm:p-8">
      <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-6xl flex-col gap-6 sm:min-h-[calc(100svh-4rem)]">
        <textarea
          aria-label="Strategy input"
          className="h-16 w-full resize-none border-2 border-white/80 bg-transparent p-3 text-white outline-none focus:border-emerald-400"
        />

        <select
          aria-label="Robot features"
          className="h-12 w-full border-2 border-white/80 bg-transparent px-3 text-white outline-none focus:border-emerald-400"
          defaultValue=""
        >
          <option value="" />
        </select>

        <section
          aria-label="Simulation viewport"
          className="flex min-h-56 flex-1 items-center justify-center overflow-hidden"
        >
          <img
            alt="2022 FRC field"
            className="size-full object-contain"
            src="/2022-field.png"
          />
        </section>

        <footer className="flex items-center gap-4">
          <button
            type="button"
            aria-label={isPlaying ? "Pause simulation" : "Play simulation"}
            aria-pressed={isPlaying}
            className="grid size-10 shrink-0 place-items-center text-emerald-500 transition-colors hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400"
            onClick={() => setIsPlaying((wasPlaying) => !wasPlaying)}
          >
            {isPlaying ? (
              <PauseIcon aria-hidden="true" className="size-8" strokeWidth={2.5} />
            ) : (
              <PlayIcon aria-hidden="true" className="size-8" strokeWidth={2.5} />
            )}
          </button>
          <div
            aria-label="Simulation time"
            aria-valuemax={1}
            aria-valuemin={0}
            aria-valuenow={0}
            className="h-1 flex-1 bg-white/80"
            role="progressbar"
          />
        </footer>
      </div>
    </main>
  );
}
