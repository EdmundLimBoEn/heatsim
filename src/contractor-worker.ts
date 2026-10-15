import { compareContractorPlans, type ContractorWorkerRequest, type ContractorWorkerResponse } from './contractor-comparison';

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<ContractorWorkerRequest>) => void;
  postMessage: (message: ContractorWorkerResponse) => void;
};
worker.onmessage = ({ data }) => {
  try {
    if (data.type !== 'run') return;
    const result = compareContractorPlans(data.config, { onProgress: progress => worker.postMessage({ type: 'progress', progress }) });
    worker.postMessage({ type: 'result', result });
  } catch (error) {
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Contractor study failed.' });
  }
};
