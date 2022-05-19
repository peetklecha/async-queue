export const END = Symbol("Stream ended.");
export const ERROR = Symbol("Stream errored.");

export type Enqueueable<T> = T | Promise<T> | typeof END | typeof ERROR;

export type Resolver<T> = (value: T | PromiseLike<T>) => void;

export type EndOptions = { immediately?: boolean, withError?: Error };

export class AsyncQueue<T = unknown> {
  #queue: Enqueueable<T>[] = [];
  #resolve: null | Resolver<Enqueueable<T>> = null;
  #error?: Error;

  #handleError(err: Error) {
    if (this.#error instanceof AggregateError) this.#error.errors.push(err);
    else if (this.#error) this.#error = new AggregateError([this.#error, err]);
    else this.#error = err;
  }

  #enqueue(immediate: boolean, data: Enqueueable<T>[]) {
    this.#queue[immediate ? "unshift" : "push"](...data);
    this.#resolve?.(this.#queue.shift()!);
    this.#resolve = null;
  }

  constructor(streamPromise?: Promise<unknown>) {
    streamPromise
      ?.catch?.(err => this.close({ withError: err }))
      ?.finally?.(() => this.close());
  }

  get length() { return this.#queue.length }

  push = (...data: (T | Promise<T>)[]) => {
    if (data.length) this.#enqueue(false, data);
    else {
      this.#enqueue(false, [ERROR]);
      this.#handleError(new Error("AsyncQueueError: queue.push was called with no arguments"));
    }
  }

  close = ({ immediately = false, withError }: EndOptions = {}) => {
    if (withError) this.#handleError(withError);
    this.#enqueue(immediately, [withError ? ERROR : END]);
    this.push = this.close = () => {};
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const value = this.#queue.length
        ? this.#queue.shift()!
        : await new Promise<Enqueueable<T>>(res => { this.#resolve = res; });
      if (value === ERROR) throw this.#error;
      if (value === END) break;
      yield value;
    }
  }
}
