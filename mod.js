// deno-fmt-ignore-file
// deno-lint-ignore-file
// This code was bundled using `deno bundle` and it's not recommended to edit it manually

const END = Symbol("Stream ended.");
const ERROR = Symbol("Stream errored.");
class AsyncQueue {
    #queue = [];
    #resolve = null;
    #error;
     #handleError(err) {
        if (this.#error instanceof AggregateError) this.#error.errors.push(err);
        else if (this.#error) this.#error = new AggregateError([
            this.#error,
            err
        ]);
        else this.#error = err;
    }
     #enqueue(immediate, data) {
        this.#queue[immediate ? "unshift" : "push"](...data);
        this.#resolve?.(this.#queue.shift());
        this.#resolve = null;
    }
    constructor(streamPromise){
        streamPromise?.catch?.((err1)=>this.close({
                withError: err1
            })
        )?.finally?.(()=>this.close()
        );
    }
    get length() {
        return this.#queue.length;
    }
    push = (...data1)=>{
        if (data1.length) this.#enqueue(false, data1);
        else {
            this.#enqueue(false, [
                ERROR
            ]);
            this.#handleError(new Error("AsyncQueueError: queue.push was called with no arguments"));
        }
    };
    close = ({ immediately =false , withError  } = {})=>{
        if (withError) this.#handleError(withError);
        this.#enqueue(immediately, [
            withError ? ERROR : END
        ]);
        this.push = this.close = ()=>{};
    };
    async *[Symbol.asyncIterator]() {
        while(true){
            const value = this.#queue.length ? this.#queue.shift() : await new Promise((res)=>{
                this.#resolve = res;
            });
            if (value === ERROR) throw this.#error;
            if (value === END) break;
            yield value;
        }
    }
}
export { END as END };
export { ERROR as ERROR };
export { AsyncQueue as AsyncQueue };
