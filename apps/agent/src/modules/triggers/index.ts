import {
  startHumanReplyCanceller,
  stopHumanReplyCanceller,
} from './HumanReplyCanceller.js';
import {
  startInboundSubscriber,
  stopInboundSubscriber,
} from './InboundSubscriber.js';
import {
  startAgentTriggerWorker,
  stopAgentTriggerWorker,
} from '../../shared/workers/agentTrigger/index.js';

// Entrypoint dos triggers — boot e shutdown em ordem.
//
// Ordem de boot: worker primeiro (consumidor pronto), depois subscribers
// (produtores). Assim qualquer evento que chegue durante a subida não fica
// na fila sem consumidor.
//
// Ordem de shutdown: subscribers primeiro (param de enfileirar), depois
// worker (drena o que estava em vôo).
export async function startTriggers(): Promise<void> {
  startAgentTriggerWorker();
  await startInboundSubscriber();
  await startHumanReplyCanceller();
}

export async function stopTriggers(): Promise<void> {
  await stopInboundSubscriber();
  await stopHumanReplyCanceller();
  await stopAgentTriggerWorker();
}

export { idleTriggerScheduler } from './IdleTriggerScheduler.js';
export { isOpenNow } from './OutOfHoursDetector.js';
