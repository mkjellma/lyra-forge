export class SingleBuildQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(work) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    return previous
      .catch(() => undefined)
      .then(work)
      .finally(() => release());
  }
}

