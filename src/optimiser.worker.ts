import { optimiseLayouts, OPTIMISER_SECONDS, type WorkerRequest, type WorkerResponse } from './optimiser';
import { createSimulation, stepSimulation } from './plan-simulation';

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
  postMessage: (message: WorkerResponse) => void;
};

worker.onmessage = async ({ data }) => {
  if (data.type !== 'run') return;
  try {
    const report = await optimiseLayouts(data.conditions, data.budget, data.suggestOpenings, conditions => {
      let result = createSimulation(conditions);
      for (let step = 0; step < OPTIMISER_SECONDS * 2; step++) result = stepSimulation(result, conditions, 0.5);
      return result;
    }, { onProgress: progress => worker.postMessage({ type: 'progress', progress }) });
    worker.postMessage({ type: 'result', report });
  } catch (error) {
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Optimisation failed. Your layout is unchanged.' });
  }
};
