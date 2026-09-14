import { Batch, type WorkerReply, type WorkerRequest } from "../lib/runEngine";

/**
 * Routes batches of picking lists off the main thread (specs.md §5.3), so the
 * page keeps drawing — and its progress bar keeps moving — however many lists
 * there are. Works in slices, posting progress after each and yielding in
 * between, which is also how a cancel gets read mid-batch.
 */

/** How long one slice routes before reporting and yielding. */
const SLICE_MS = 40;

let current: { jobId: number; batch: Batch } | null = null;

function reply(message: WorkerReply): void {
  self.postMessage(message);
}

function pump(job: { jobId: number; batch: Batch }): void {
  if (current !== job) return; // cancelled, or replaced by a newer batch
  let finished: boolean;
  try {
    finished = job.batch.step(performance.now() + SLICE_MS);
  } catch (error) {
    current = null;
    reply({ type: "error", jobId: job.jobId, message: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (finished) {
    current = null;
    reply({ type: "done", jobId: job.jobId, result: job.batch.result() });
    return;
  }
  reply({ type: "progress", jobId: job.jobId, done: job.batch.done, total: job.batch.total });
  setTimeout(() => pump(job), 0);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    if (current?.jobId === request.jobId) current = null;
    return;
  }
  current = { jobId: request.jobId, batch: new Batch(request.layout, request.lists, request.capture) };
  pump(current);
};
