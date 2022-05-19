# for-awaitable-queue

This library exposes a single class `AsyncQueue`, which constructs a queue that can be pushed into synchronously but read/consumed asynchronously.
It provides a way to convert processes that stream data asynchronously into an async iterable.
It's easiest to simply look at a few examples.

First, an example using Node/JS, we take an `EventEmitter` exposed by `ioredis`'s `scanStream` method (which streams all the keys in a redis instance) and asynchronously iterate through the keys it streams.

```js
import { AsyncQueue } from 'for-awaitable-queue';
import Redis from 'ioredis';

const redis = new Redis();

async function allRedisKeys() {
  const stream = await redis.scanStream();
  const queue = new AsyncQueue();

  stream.on("data", keys => queue.push(...keys));
  stream.on("end", queue.close);
  stream.on("error", (err) => queue.close({ withError: new Error(err) }));

  return queue;
}

async function main(){
  for await (const key of await allRedisKeys()) {
    console.log(key, await redis.get(key));
  }
  console.log("done!")
}

main();
```

In the listeners which asynchronously emit data or signal the end of the stream, we call synchronous methods on the AsyncQueue to add data into the queue.
Then in our main function we initiate the stream, and iterate through the queue as it collects data from the emitter.

Second, an example using Deno/TS, we have defined our own asynchronous function (`getPaginated`) which incrementally collects data by hitting a paginated endpoint.

```ts
async function paginator(){
  const queue = new AsyncQueue<ServerResponseData>(getPaginated());
  for await (const data of queue) {
    await processAsynchronously(data);
  }

  async function getPaginated() {
    let response = await client.get(`/${accountId}/users`);
    queue.push(...response.data);
    while (response.isThereAnotherPage) {
      response = await client.get(`/${accountId}/users/nextPage/${response.nextPage}`)
      queue.push(...response.data);
    }
  }
}
```

Every time the `getPaginated` function collects more data, it adds to the queue. We initiate this function on the second line,
passing in the promise it returns (without awaiting it) to the `AsyncQueue` constructor. This automatically adds an error handler and finalizer
to the promise which will ensure the queue is closed properly (i.e., the `for-await` loop ends) when `getPaginated` finishes.

You may ask -- why not just put the `await processAsynchronously(data)` calls inside the `getPaginated` function, replacing the `queue.push` calls?
We certainly could do that, but it means that each call of `processAsynchronously` would block the next fetch of data from the paginated API. Using this
library allows the fetching loop and the processing loop to happen independently (or as independently as they can -- the processing loop may sometimes need to wait on the fetching loop for more data) without needing to manually handle promises.

## More advanced stuff

### Checking queue length

You can check on the length of the queue; here's an example where we pause the stream if the queue gets too big:

```js
async function allRedisKeys() {
  const stream = await redis.scanStream();
  const queue = new AsyncQueue();

  stream.on("data", keys => {
    queue.push(...keys);
    if (queue.length > MAX_QUEUE_SIZE) stream.pause();
  });
  stream.on("end", queue.close);
  stream.on("error", (err) => queue.close({ withError: new Error(err) }));

  queue.resumeStream = () => stream.resume();

  return queue;
}

async function main(){
  const queue = await allRedisKeys();
  for await (const key of queue) {
    console.log(key, await redis.get(key));
    if (queue.length < MAX_QUEUE_SIZE) queue.resumeStream();
  }
  console.log("done!")
}
```

### Interrupting iteration

Whenever we close the stream, either due to an error or for any other reason, we can set the `immediately` flag to cause iteration to end immediately (i.e., on the next iteration of the `for-await` loop) rather than waiting for all the items remaining on the queue to be consumed.

```js
stream.on("error", err => queue.close({ immediately: true, withError: new Error(err) });
```

### Customize error handling/finalizing for promise-based streams

If the process that streams the data into the queue is a promise based function rather than an EventEmitter or other callback based listener, you can pass the promise for the streaming function into the `AsyncQueue` constructor as seen above; this causes the promise to be given an error handler and finalizer which close the stream appropriately. If we wanted to define error/finalization behavior ourselves, it would look like this:

```ts
async function paginator(){
  getPaginated()
  const queue = new AsyncQueue<ServerResponseData>();
  for await (const data of queue) {
    await processAsynchronously(data);
  }

  async function getPaginated() {
    try {
      let response = await client.get(`/${accountId}/users`);
      queue.push(...response.data);
      while (response.isThereAnotherPage) {
        response = await client.get(`/${accountId}/users/nextPage/${response.nextPage}`)
        queue.push(...response.data);
      }
    } catch (err) {
      queue.close({ withError: err });
    } finally {
      queue.close();
    }
  }
}
```

(This example is equivalent in behavior to the default if we pass the `getPaginated` promise into the `AsyncQueue` constructor.)

### Pushing promises directly into the queue

You can push promises directly into the queue, and things work out just like you'd expect. Here's another way of doing the ioredis stream from the very first example:

```js
import { AsyncQueue } from 'for-awaitable-queue';
import Redis from 'ioredis';

const redis = new Redis();

async function allRedisKeys() {
  const stream = await redis.scanStream();
  const queue = new AsyncQueue();

  stream.on("data", keys => queue.push(...keys.map(k => redis.get(k).then(v => [k,v]))));
  stream.on("end", queue.close);
  stream.on("error", (err) => queue.close({ withError: new Error(err) }));

  return queue;
}

async function main(){
  for await (const [key, value] of await allRedisKeys()) {
    console.log(key, value);
  }
  console.log("done!")
}

main();
```

This might be a bit more efficient because we call `redis.get` on all keys as soon as the scanStream emits them rather than waiting for each individual key to be yielded out of the queue.
