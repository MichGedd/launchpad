import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GaugeIcon,
  InfoIcon,
  LoaderCircleIcon,
  BarChart3Icon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  RotateCcwIcon,
  RocketIcon,
  Settings2Icon,
  SparklesIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { ThemeMenu } from "~/components/theme-menu";
import { Button } from "~/components/ui/button";
import { Dialog, DialogTrigger } from "~/components/ui/dialog";
import {
  clampPlaybackTime,
  interpolatePlaybackFrame,
  isPlaybackComplete,
  DEFAULT_ROBOT_CUSTOMIZATION,
  type RobotCustomization,
  type RobotFeatureOption,
  type VisualizerPreview,
  type VisualizerScene,
} from "~/visualizer";

import { FieldViewport } from "./field-viewport";
import { ReplayDetails } from "./replay-details";
import { RobotCustomizationDialog } from "./robot-customization-dialog";
import { LlmConfigurationDialog } from "./llm-configuration-dialog";
import { LlmInteractionsDialog } from "./llm-interactions-dialog";
import { LlmStatisticsDialog } from "./llm-statistics-dialog";
import {
  disconnectLlm,
  generateSimulation,
  getLlmConfiguration,
  getLlmStatistics,
  saveLlmConfiguration,
  type LlmConfigurationRequest,
  type LlmConfigurationStatus,
  type LlmStatistics,
} from "~/llm/client";
import type { SimulationDebugTrace } from "~/simulation";

const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;

interface VisualizerWorkspaceProps {
  readonly features: readonly RobotFeatureOption[];
  readonly initialPreview: VisualizerPreview;
  readonly initialStrategy: string;
}

function formatTime(timeSeconds: number) {
  const minutes = Math.floor(timeSeconds / 60);
  const seconds = (timeSeconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

function VisualizerWorkspace({
  features,
  initialPreview,
  initialStrategy,
}: VisualizerWorkspaceProps) {
  const [strategy, setStrategy] = useState(initialStrategy);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<readonly string[]>(
    features.map((feature) => feature.id),
  );
  const [robotCustomization, setRobotCustomization] = useState<RobotCustomization>(
    DEFAULT_ROBOT_CUSTOMIZATION,
  );
  const [scene, setScene] = useState<VisualizerScene | null>(null);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isFeatureRailCollapsed, setIsFeatureRailCollapsed] = useState(false);
  const [isRobotCustomizationOpen, setIsRobotCustomizationOpen] = useState(false);
  const [llmConfiguration, setLlmConfiguration] = useState<LlmConfigurationStatus | null>(null);
  const [isLlmConfigurationOpen, setIsLlmConfigurationOpen] = useState(false);
  const [statistics, setStatistics] = useState<LlmStatistics | null>(null);
  const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
  const [debugTrace, setDebugTrace] = useState<readonly SimulationDebugTrace[]>([]);
  const [isDebugTraceOpen, setIsDebugTraceOpen] = useState(false);
  const [isTimelinePinned, setIsTimelinePinned] = useState(false);

  async function handleGenerate() {
    if (!llmConfiguration?.configured || isGenerating) return;
    setIsGenerating(true);
    setGenerationError(null);
    setIsPlaying(false);
    setDebugTrace([]);

    try {
      const response = await generateSimulation({
        strategy,
        selectedFeatureIds,
        robotCustomization,
      });
      setScene(response.scene);
      setCurrentTimeSeconds(0);
      if (response.statistics) setStatistics(response.statistics);
      setDebugTrace(response.debugTrace ?? []);
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : "The replay could not be generated. Try again.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveLlmConfiguration(nextConfiguration: LlmConfigurationRequest) {
    setLlmConfiguration(await saveLlmConfiguration(nextConfiguration));
  }

  async function handleDisconnectLlm() {
    await disconnectLlm();
    setLlmConfiguration({
      configured: false,
      model: "gpt-5.6-luna",
      provider: "openai",
      reasoningEffort: "low",
    });
    setStatistics(null);
    setDebugTrace([]);
  }

  async function openStatistics() {
    setIsStatisticsOpen(true);
    try {
      setStatistics(await getLlmStatistics());
    } catch {
      // The empty state remains useful while the session has no recorded requests.
    }
  }

  useEffect(() => {
    let active = true;
    void getLlmConfiguration().then((configuration) => {
      if (active) setLlmConfiguration(configuration);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || scene === null) return;

    let animationFrameId = 0;
    let previousTimestamp = performance.now();

    const advance = (timestamp: number) => {
      const elapsedRealSeconds = (timestamp - previousTimestamp) / 1000;
      previousTimestamp = timestamp;

      setCurrentTimeSeconds((currentTime) => {
        const nextTime = clampPlaybackTime(
          scene.playback,
          currentTime + elapsedRealSeconds * playbackSpeed,
        );
        if (isPlaybackComplete(scene.playback, nextTime)) {
          setIsPlaying(false);
        }
        return nextTime;
      });

      animationFrameId = requestAnimationFrame(advance);
    };

    animationFrameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, playbackSpeed, scene]);

  const frame = useMemo(
    () =>
      scene
        ? interpolatePlaybackFrame(scene.playback, currentTimeSeconds)
        : null,
    [currentTimeSeconds, scene],
  );
  const preview = useMemo<VisualizerPreview>(
    () => ({
      ...initialPreview,
      initialFrame: {
        ...initialPreview.initialFrame,
        robot: {
          ...initialPreview.initialFrame.robot,
          widthFeet: robotCustomization.widthFeet,
          lengthFeet: robotCustomization.lengthFeet,
          translationSpeedFeetPerSecond:
            robotCustomization.translationSpeedFeetPerSecond,
          spinSpeedRotationsPerSecond:
            robotCustomization.spinSpeedRotationsPerSecond,
        },
      },
    }),
    [initialPreview, robotCustomization],
  );
  const durationSeconds = scene?.playback.timing.durationSeconds ?? 0;
  const status = isGenerating ? "Generating" : frame?.status ?? "Ready";

  function toggleFeature(featureId: string) {
    setSelectedFeatureIds((currentIds) =>
      currentIds.includes(featureId)
        ? currentIds.filter((id) => id !== featureId)
        : [...currentIds, featureId],
    );
  }

  function togglePlayback() {
    if (scene === null) return;
    if (isPlaybackComplete(scene.playback, currentTimeSeconds)) {
      setCurrentTimeSeconds(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((current) => !current);
  }

  return (
    <main className="relative h-svh min-w-[1024px] overflow-hidden bg-[#808588] text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.2),transparent_32%),radial-gradient(circle_at_88%_18%,rgba(33,64,154,0.24),transparent_28%),linear-gradient(145deg,rgba(24,28,30,0.3),rgba(15,18,20,0.72))] dark:block" />
      <div className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.72),transparent_34%),radial-gradient(circle_at_88%_18%,rgba(33,64,154,0.16),transparent_26%),linear-gradient(145deg,rgba(255,255,255,0.1),rgba(78,83,86,0.2))] dark:hidden" />

      <div className="relative mx-auto flex h-svh w-full max-w-[1720px] flex-col px-8 pb-[clamp(16px,3vh,28px)] pt-[clamp(14px,2.5vh,24px)]">
        <header className="mb-[clamp(12px,2vh,20px)] flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-[#f7931e] text-[#201407] shadow-lg shadow-orange-950/20">
              <RocketIcon aria-hidden="true" className="size-5" strokeWidth={2.25} />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-[-0.025em]">Launchpad</p>
              <p className="text-xs text-white/55 dark:text-white/55">Strategy visualizer</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="glass-control flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-medium">
              <span
                className={`size-2 rounded-full ${isPlaying ? "animate-pulse bg-[#f7931e]" : "bg-[#6e8ce1]"}`}
              />
              <span className="capitalize">{status.replace("-", " ")}</span>
            </div>
            <ThemeMenu />
          </div>
        </header>

        <form className="glass-panel mb-[clamp(12px,2vh,20px)] shrink-0 rounded-[24px] p-3" onSubmit={(event) => {
          event.preventDefault();
          void handleGenerate();
        }}>
          <label className="sr-only" htmlFor="strategy-input">Strategy</label>
          <textarea
            className="h-[clamp(52px,7.5vh,64px)] w-full resize-none rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-muted-foreground dark:bg-black/15"
            disabled={llmConfiguration === null || !llmConfiguration.configured || isGenerating}
            id="strategy-input"
            onChange={(event) => setStrategy(event.target.value)}
            placeholder={llmConfiguration?.configured ? "Describe how the robot should move and act during the match…" : "Please configure your LLM"}
            value={strategy}
          />
          <div className="mt-2 flex items-center justify-between gap-4 px-1">
            <p aria-live="polite" className={`text-xs ${generationError ? "text-red-300" : "text-muted-foreground"}`}>
              {generationError ?? (llmConfiguration?.configured ? "Describe a strategy for ChatGPT to turn into an action plan." : "Configure ChatGPT to generate a strategy plan.")}
            </p>
            <div className="flex items-center gap-2">
              <Dialog onOpenChange={setIsLlmConfigurationOpen} open={isLlmConfigurationOpen}>
                <DialogTrigger render={<Button className="h-10 rounded-xl px-3 text-sm" disabled={isGenerating} type="button" variant="ghost" />}>
                  <Settings2Icon aria-hidden="true" />
                  Configure
                </DialogTrigger>
                <LlmConfigurationDialog
                  configuration={llmConfiguration}
                  onDisconnect={handleDisconnectLlm}
                  onOpenChange={setIsLlmConfigurationOpen}
                  onSave={handleSaveLlmConfiguration}
                  open={isLlmConfigurationOpen}
                />
              </Dialog>
              <Button aria-label="Report statistics" className="h-10 rounded-xl px-3 text-sm" onClick={() => void openStatistics()} type="button" variant="ghost">
                <BarChart3Icon aria-hidden="true" />
                Report Statistics
              </Button>
              <Button
                className="h-10 rounded-xl px-4 text-sm shadow-lg shadow-orange-950/20"
                disabled={llmConfiguration === null || !llmConfiguration.configured || isGenerating}
                type="submit"
              >
                {isGenerating ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : <SparklesIcon aria-hidden="true" />}
                {isGenerating ? "Generating" : "Generate"}
              </Button>
            </div>
          </div>
        </form>

        <div className="flex min-h-0 flex-1 gap-4">
          <aside
            className={`glass-panel relative flex shrink-0 flex-col overflow-hidden rounded-[24px] transition-[width] duration-200 ${isFeatureRailCollapsed ? "w-[72px]" : "w-[272px]"}`}
          >
            <div className="flex items-center justify-between border-b border-white/10 p-4 [@media(max-height:600px)]:p-3">
              {isFeatureRailCollapsed ? null : (
                <div>
                  <h2 className="text-sm font-semibold">Robot features</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Capabilities for this run</p>
                </div>
              )}
              <Button
                aria-label={isFeatureRailCollapsed ? "Expand robot features" : "Collapse robot features"}
                className="ml-auto rounded-xl"
                disabled={isGenerating}
                onClick={() => setIsFeatureRailCollapsed((collapsed) => !collapsed)}
                size="icon"
                type="button"
                variant="ghost"
              >
                {isFeatureRailCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 [@media(max-height:600px)]:space-y-1 [@media(max-height:600px)]:p-2">
              {features.map((feature) => {
                const isSelected = selectedFeatureIds.includes(feature.id);
                return (
                  <label
                    className={`group flex cursor-pointer items-start rounded-2xl border transition-colors ${isFeatureRailCollapsed ? "justify-center p-2.5" : "gap-3 p-3 [@media(max-height:600px)]:p-2"} ${isSelected ? "border-[#6e8ce1]/55 bg-[#21409a]/28" : "border-white/8 bg-white/4 hover:bg-white/8"}`}
                    key={feature.id}
                    title={isFeatureRailCollapsed ? feature.label : undefined}
                  >
                    <input
                      aria-label={feature.label}
                      checked={isSelected}
                      className="sr-only"
                      disabled={isGenerating}
                      onChange={() => toggleFeature(feature.id)}
                      type="checkbox"
                    />
                    <span className={`grid size-6 shrink-0 place-items-center rounded-lg border ${isSelected ? "border-[#6e8ce1] bg-[#21409a] text-white" : "border-white/20 text-transparent"}`}>
                      <CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={3} />
                    </span>
                    {isFeatureRailCollapsed ? null : (
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{feature.label}</span>
                        <span className="mt-1 block text-xs leading-4 text-muted-foreground [@media(max-height:560px)]:hidden">{feature.description}</span>
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <Dialog
              onOpenChange={(open) => setIsRobotCustomizationOpen(open)}
              open={isRobotCustomizationOpen}
            >
              <div className="shrink-0 border-t border-white/10 p-3 [@media(max-height:600px)]:p-2">
                <DialogTrigger
                  render={
                    <Button
                      aria-label="Customize Robot"
                      className={`w-full rounded-xl ${isFeatureRailCollapsed ? "px-0" : "justify-start"}`}
                      size={isFeatureRailCollapsed ? "icon" : "default"}
                      title={isFeatureRailCollapsed ? "Customize Robot" : undefined}
                      disabled={isGenerating}
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <Settings2Icon aria-hidden="true" />
                  {isFeatureRailCollapsed ? null : "Customize Robot"}
                </DialogTrigger>
              </div>
              <RobotCustomizationDialog
                customization={robotCustomization}
                onOpenChange={setIsRobotCustomizationOpen}
                onSave={setRobotCustomization}
                open={isRobotCustomizationOpen}
              />
            </Dialog>
          </aside>

          <section className="glass-panel relative min-w-0 flex-1 rounded-[28px] p-3" aria-label="Replay workspace">
            <FieldViewport
              frame={frame}
              isGenerating={isGenerating}
              preview={preview}
              scene={scene}
            />

            <div
              className="group/timeline absolute inset-x-3 bottom-3 z-20 h-24"
              data-pinned={isTimelinePinned}
            >
              <div
                className={`glass-panel absolute inset-x-5 bottom-0 flex items-center gap-3 rounded-[20px] px-3 py-2.5 transition-[opacity,transform] duration-200 ${
                  isTimelinePinned
                    ? "pointer-events-auto translate-y-0 opacity-100"
                    : "pointer-events-none translate-y-5 opacity-0 group-focus-within/timeline:pointer-events-auto group-focus-within/timeline:translate-y-0 group-focus-within/timeline:opacity-100 group-hover/timeline:pointer-events-auto group-hover/timeline:translate-y-0 group-hover/timeline:opacity-100"
                }`}
              >
              <Button
                aria-label="Restart replay"
                className="rounded-xl"
                disabled={scene === null || isGenerating}
                onClick={() => {
                  setCurrentTimeSeconds(0);
                  setIsPlaying(false);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <RotateCcwIcon aria-hidden="true" />
              </Button>
              <Button
                aria-label={isPlaying ? "Pause replay" : "Play replay"}
                aria-pressed={isPlaying}
                className="size-11 rounded-2xl shadow-lg shadow-orange-950/20"
                disabled={scene === null || isGenerating}
                onClick={togglePlayback}
                size="icon"
                type="button"
              >
                {isPlaying ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" className="translate-x-px" />}
              </Button>
              <span className="w-[52px] text-right font-mono text-xs tabular-nums">{formatTime(currentTimeSeconds)}</span>
              <input
                aria-label="Replay position"
                className="h-5 min-w-24 flex-1 cursor-pointer appearance-none bg-transparent accent-[#f7931e] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#f7931e] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/20 [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/20 [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f7931e]"
                disabled={scene === null || isGenerating}
                max={durationSeconds || 1}
                min="0"
                onChange={(event) => {
                  if (scene === null) return;
                  setCurrentTimeSeconds(clampPlaybackTime(scene.playback, Number(event.target.value)));
                }}
                step="0.05"
                type="range"
                value={currentTimeSeconds}
              />
              <span className="w-[52px] font-mono text-xs tabular-nums text-muted-foreground">{formatTime(durationSeconds)}</span>

              <div aria-label="Playback speed" className="glass-control flex items-center gap-0.5 rounded-xl p-1" role="group">
                <GaugeIcon aria-hidden="true" className="mx-1 size-3.5 text-muted-foreground" />
                {PLAYBACK_SPEEDS.map((speed) => (
                  <button
                    aria-pressed={playbackSpeed === speed}
                    className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${playbackSpeed === speed ? "bg-[#f7931e] text-[#201407]" : "text-muted-foreground hover:text-foreground"}`}
                    disabled={isGenerating}
                    key={speed}
                    onClick={() => setPlaybackSpeed(speed)}
                    type="button"
                  >
                    {speed}×
                  </button>
                ))}
              </div>

              <Button
                aria-label={isTimelinePinned ? "Unpin timeline" : "Pin timeline"}
                aria-pressed={isTimelinePinned}
                className={`rounded-xl ${isTimelinePinned ? "bg-[#21409a]/35 text-[#aebfff]" : ""}`}
                onClick={(event) => {
                  if (isTimelinePinned) event.currentTarget.blur();
                  setIsTimelinePinned(!isTimelinePinned);
                }}
                size="icon"
                type="button"
                variant="ghost"
                disabled={isGenerating}
              >
                <PinIcon
                  aria-hidden="true"
                  className={isTimelinePinned ? "fill-current" : undefined}
                />
              </Button>

              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      aria-label="Open replay details"
                      className="rounded-xl"
                      disabled={scene === null || isGenerating}
                      size="icon"
                      variant="ghost"
                    />
                  }
                >
                  <InfoIcon aria-hidden="true" />
                </DialogTrigger>
                <ReplayDetails
                  currentTimeSeconds={currentTimeSeconds}
                  frame={frame}
                  scene={scene}
                />
              </Dialog>
              </div>
            </div>
          </section>
        </div>
      </div>

      {import.meta.env.DEV ? (
        <Dialog onOpenChange={setIsDebugTraceOpen} open={isDebugTraceOpen}>
          <DialogTrigger
            render={
              <Button
                className="absolute bottom-5 left-5 z-30 rounded-xl bg-black/35 text-xs text-white/80 backdrop-blur-xl hover:bg-black/50"
                disabled={debugTrace.length === 0 || isGenerating}
                type="button"
                variant="ghost"
              />
            }
          >
            LLM interactions{debugTrace.length > 0 ? ` · ${debugTrace.length}` : ""}
          </DialogTrigger>
          <LlmInteractionsDialog traces={debugTrace} />
        </Dialog>
      ) : null}
      <Dialog onOpenChange={setIsStatisticsOpen} open={isStatisticsOpen}>
        <LlmStatisticsDialog statistics={statistics} />
      </Dialog>
    </main>
  );
}

export { VisualizerWorkspace };
