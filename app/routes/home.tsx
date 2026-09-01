import { VisualizerWorkspace } from "~/components/visualizer/visualizer-workspace";
import {
  createDemoReplay,
  DEFAULT_ROBOT_FEATURE_OPTIONS,
} from "~/visualizer";

export default function Home() {
  return (
    <VisualizerWorkspace
      features={DEFAULT_ROBOT_FEATURE_OPTIONS}
      generateReplay={createDemoReplay}
      initialStrategy=""
    />
  );
}
