// js/performance.js - Performance utilities and optimizations

/**
 * Debounce function - delays execution until after wait time has passed since last call
 * Use for: search inputs, window resize, scroll handlers
 */
export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function - ensures function runs at most once per interval
 * Use for: scroll handlers, mouse move, real-time updates
 */
export function throttle(func, limit = 100) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Performance monitoring class
 */
export class PerformanceMonitor {
    constructor() {
        this.metrics = {};
        this.history = [];
    }

    start(label) {
        this.metrics[label] = performance.now();
    }

    end(label) {
        if (this.metrics[label]) {
            const duration = performance.now() - this.metrics[label];
            const metric = {
                label,
                duration: duration.toFixed(2),
                timestamp: new Date().toISOString()
            };

            this.history.push(metric);

            // Keep only last 100 metrics
            if (this.history.length > 100) {
                this.history.shift();
            }

            console.log(`⏱️ ${label}: ${metric.duration}ms`);
            delete this.metrics[label];
            return duration;
        }
        return null;
    }

    async measure(label, fn) {
        this.start(label);
        try {
            const result = await fn();
            this.end(label);
            return result;
        } catch (error) {
            this.end(label);
            throw error;
        }
    }

    getHistory() {
        return this.history;
    }

    getAverageTime(label) {
        const labelMetrics = this.history.filter(m => m.label === label);
        if (labelMetrics.length === 0) return 0;

        const sum = labelMetrics.reduce((acc, m) => acc + parseFloat(m.duration), 0);
        return (sum / labelMetrics.length).toFixed(2);
    }

    getSlowestOperations(count = 10) {
        return [...this.history]
            .sort((a, b) => parseFloat(b.duration) - parseFloat(a.duration))
            .slice(0, count);
    }

    clear() {
        this.metrics = {};
        this.history = [];
    }
}

/**
 * Cache manager with TTL (Time To Live)
 */
export class CacheManager {
    constructor(defaultTTL = 5 * 60 * 1000) { // 5 minutes default
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
    }

    set(key, value, ttl = this.defaultTTL) {
        this.cache.set(key, {
            value,
            expires: Date.now() + ttl
        });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        if (Date.now() > item.expires) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    // Clean expired entries
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expires) {
                this.cache.delete(key);
            }
        }
    }

    // Get cache statistics
    getStats() {
        const now = Date.now();
        let valid = 0;
        let expired = 0;

        for (const item of this.cache.values()) {
            if (now > item.expires) {
                expired++;
            } else {
                valid++;
            }
        }

        return {
            total: this.cache.size,
            valid,
            expired
        };
    }
}

/**
 * Request batcher - combines multiple requests into one
 */
export class RequestBatcher {
    constructor(batchFn, delay = 50) {
        this.batchFn = batchFn;
        this.delay = delay;
        this.queue = [];
        this.timeout = null;
    }

    add(request) {
        return new Promise((resolve, reject) => {
            this.queue.push({ request, resolve, reject });

            if (this.timeout) {
                clearTimeout(this.timeout);
            }

            this.timeout = setTimeout(() => {
                this.flush();
            }, this.delay);
        });
    }

    async flush() {
        if (this.queue.length === 0) return;

        const batch = this.queue.splice(0);
        const requests = batch.map(item => item.request);

        try {
            const results = await this.batchFn(requests);

            batch.forEach((item, index) => {
                item.resolve(results[index]);
            });
        } catch (error) {
            batch.forEach(item => {
                item.reject(error);
            });
        }

        this.timeout = null;
    }
}

/**
 * Lazy loader - loads resources only when needed
 */
export class LazyLoader {
    constructor() {
        this.loaded = new Set();
        this.loading = new Map();
    }

    async load(id, loader) {
        // Already loaded
        if (this.loaded.has(id)) {
            return;
        }

        // Currently loading
        if (this.loading.has(id)) {
            return this.loading.get(id);
        }

        // Start loading
        const promise = loader()
            .then(() => {
                this.loaded.add(id);
                this.loading.delete(id);
            })
            .catch(error => {
                this.loading.delete(id);
                throw error;
            });

        this.loading.set(id, promise);
        return promise;
    }

    isLoaded(id) {
        return this.loaded.has(id);
    }

    isLoading(id) {
        return this.loading.has(id);
    }

    reset(id) {
        this.loaded.delete(id);
        this.loading.delete(id);
    }
}

/**
 * Memory usage monitor
 */
export function getMemoryUsage() {
    if (performance.memory) {
        return {
            used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
            total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
            limit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB',
            percentage: ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(2) + '%'
        };
    }
    return null;
}

/**
 * Network performance monitor
 */
export function getNetworkTiming() {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (!navigation) return null;

    return {
        dns: (navigation.domainLookupEnd - navigation.domainLookupStart).toFixed(2) + 'ms',
        tcp: (navigation.connectEnd - navigation.connectStart).toFixed(2) + 'ms',
        request: (navigation.responseStart - navigation.requestStart).toFixed(2) + 'ms',
        response: (navigation.responseEnd - navigation.responseStart).toFixed(2) + 'ms',
        domProcessing: (navigation.domComplete - navigation.domLoading).toFixed(2) + 'ms',
        total: (navigation.loadEventEnd - navigation.fetchStart).toFixed(2) + 'ms'
    };
}

/**
 * FPS (Frames Per Second) monitor
 */
export class FPSMonitor {
    constructor() {
        this.fps = 0;
        this.frames = 0;
        this.lastTime = performance.now();
        this.running = false;
    }

    start() {
        this.running = true;
        this.tick();
    }

    stop() {
        this.running = false;
    }

    tick() {
        if (!this.running) return;

        this.frames++;
        const now = performance.now();

        if (now >= this.lastTime + 1000) {
            this.fps = Math.round((this.frames * 1000) / (now - this.lastTime));
            this.frames = 0;
            this.lastTime = now;
        }

        requestAnimationFrame(() => this.tick());
    }

    getFPS() {
        return this.fps;
    }
}

/**
 * DOM mutation observer with debouncing
 */
export function observeDOMChanges(element, callback, options = {}) {
    const debouncedCallback = debounce(callback, options.debounce || 100);

    const observer = new MutationObserver((mutations) => {
        debouncedCallback(mutations);
    });

    observer.observe(element, {
        childList: true,
        subtree: true,
        attributes: options.attributes !== false,
        characterData: options.characterData !== false,
        ...options
    });

    return observer;
}

/**
 * Intersection observer for lazy loading
 */
export function observeIntersection(elements, callback, options = {}) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                callback(entry.target, entry);
            }
        });
    }, {
        root: options.root || null,
        rootMargin: options.rootMargin || '50px',
        threshold: options.threshold || 0.1
    });

    if (Array.isArray(elements)) {
        elements.forEach(el => observer.observe(el));
    } else {
        observer.observe(elements);
    }

    return observer;
}

/**
 * Preload resources
 */
export function preloadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

export function preloadImages(sources) {
    return Promise.all(sources.map(preloadImage));
}

/**
 * Request idle callback wrapper with fallback
 */
export function runWhenIdle(callback, options = {}) {
    if ('requestIdleCallback' in window) {
        return requestIdleCallback(callback, options);
    } else {
        // Fallback for browsers that don't support requestIdleCallback
        return setTimeout(callback, 1);
    }
}

/**
 * Cancel idle callback wrapper
 */
export function cancelIdle(id) {
    if ('cancelIdleCallback' in window) {
        cancelIdleCallback(id);
    } else {
        clearTimeout(id);
    }
}

/**
 * Performance dashboard
 */
export function logPerformanceDashboard() {
    console.group('📊 Performance Dashboard');

    // Memory
    const memory = getMemoryUsage();
    if (memory) {
        console.log('💾 Memory:', memory);
    }

    // Network
    const network = getNetworkTiming();
    if (network) {
        console.log('🌐 Network:', network);
    }

    // Resources
    const resources = performance.getEntriesByType('resource');
    const totalSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
    console.log('📦 Resources:', {
        count: resources.length,
        totalSize: (totalSize / 1024).toFixed(2) + ' KB'
    });

    // Long tasks
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        const longTasks = performance.getEntriesByType('longtask');
        console.log('⏳ Long Tasks:', longTasks.length);
    }

    console.groupEnd();
}

// Global performance monitor instance
export const perfMon = new PerformanceMonitor();

// Global cache manager instance
export const cacheManager = new CacheManager();

// Periodic cache cleanup (every 5 minutes)
setInterval(() => {
    cacheManager.cleanup();
}, 5 * 60 * 1000);
