import { compareThermalCases, type ThermalWorkerRequest, type ThermalWorkerResponse } from './thermal-comparison';

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<ThermalWorkerRequest>) => void;
  postMessage: (message: ThermalWorkerResponse) => void;
};

worker.onmessage = ({ data }) => {
  try {
    if (data.type !== 'run') return;
    const result = compareThermalCases(data.config, {
      baselineConfig: data.baselineConfig,
      onProgress: progress => worker.postMessage({ type: 'progress', progress }),
    });
    worker.postMessage({ type: 'result', result });
  } catch (error) {
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Thermal comparison failed.' });
  }
};
