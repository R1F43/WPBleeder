const browser = globalThis.browser || globalThis.chrome;

export class ScanQueue {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 5;
    this.delayMs = options.delayMs || 200;
    this.domain = options.domain || '';
    this.signal = options.signal || null;
    this.tasks = [];        // pending task functions
    this.running = 0;       // currently active
    this.completed = 0;
    this.total = 0;
    this.results = [];
    this.aborted = false;
    this._resolve = null;   // Promise resolve for run()
    this._onProgress = options.onProgress || null; // callback(progress)

    if (this.signal) {
      if (this.signal.aborted) {
        this.abort();
      } else {
        this.signal.addEventListener('abort', () => this.abort(), { once: true });
      }
    }
  }
  
  enqueue(taskFn) {
    if (this.aborted) return;
    this.tasks.push(taskFn);
    this.total++;
  }
  
  async run() {
    if (this.aborted || this.total === 0) return this.results;
    
    return new Promise((resolve) => {
      this._resolve = resolve;
      // Start initial batch
      const toStart = Math.min(this.concurrency, this.tasks.length);
      for (let i = 0; i < toStart; i++) {
        this._runNext();
      }
    });
  }
  
  async _runNext() {
    if (this.aborted) {
      if (this.running === 0 && this._resolve) {
        this._resolve(this.results);
      }
      return;
    }
    if (this.tasks.length === 0) {
      if (this.running === 0 && this._resolve) {
        this._resolve(this.results);
      }
      return;
    }
    
    const task = this.tasks.shift();
    this.running++;
    
    try {
      const result = await task();
      if (!this.aborted && result !== null) {
        this.results.push(result);
        this.completed++;
        
        // Checkpoint to session storage
        await this._checkpoint();
        
        // Notify progress with individual item result
        if (this._onProgress) {
          this._onProgress(this.getProgress(), result);
        }
      }
    } catch (err) {
      if (!this.aborted && err.name !== 'AbortError') {
        this.completed++;
        const errResult = { error: err.message };
        this.results.push(errResult);
        await this._checkpoint();
        if (this._onProgress) {
          this._onProgress(this.getProgress(), errResult);
        }
      }
    } finally {
      this.running--;
    }
    
    if (this.aborted) {
      if (this.running === 0 && this._resolve) {
        this._resolve(this.results);
      }
      return;
    }

    // Delay between requests
    if (this.tasks.length > 0) {
      await new Promise(r => setTimeout(r, this.delayMs));
      this._runNext();
    } else if (this.running === 0 && this._resolve) {
      this._resolve(this.results);
    }
  }
  
  abort() {
    this.aborted = true;
    this.tasks = []; // Drain pending tasks immediately
    if (this._resolve) {
      this._resolve(this.results); // Resolve immediately so callers await queue.run() unblocks right now!
    }
  }
  
  getProgress() {
    return {
      completed: this.completed,
      total: this.total,
      percent: this.total > 0 ? Math.round((this.completed / this.total) * 100) : 0
    };
  }
  
  async _checkpoint() {
    try {
      const key = `session:${this.domain}:inProgress`;
      const state = {
        completed: this.completed,
        total: this.total,
        results: this.results,
        progress: this.getProgress(),
        lastUpdated: Date.now()
      };
      // Try session storage first, fall back to local
      try {
        await browser.storage.session.set({ [key]: state });
      } catch(e) {
        await browser.storage.local.set({ [`session:fallback:${key}`]: state });
      }
    } catch(e) {
      // Non-critical — continue scanning even if checkpoint fails
    }
  }
}
