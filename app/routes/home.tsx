import { VisualizerWorkspace } from "~/components/visualizer/visualizer-workspace";
import { createNeutralVisualizerPreview } from "~/simulation";
import { DEFAULT_ROBOT_FEATURE_OPTIONS } from "~/visualizer";

export default function Home() {
  return (
    <VisualizerWorkspace
      features={DEFAULT_ROBOT_FEATURE_OPTIONS}
      initialPreview={createNeutralVisualizerPreview()}
      initialStrategy=""
    />
  );
}
