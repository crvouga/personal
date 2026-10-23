export const cancellation = new AbortController();

export function cancel() {
  cancellation.abort();
}
