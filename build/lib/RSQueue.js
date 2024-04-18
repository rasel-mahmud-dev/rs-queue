"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const redis_1 = require("redis");
class RsQueue extends events_1.EventEmitter {
    constructor(queueName, options) {
        super();
        this.option = {
            jobsKey: "rq:jobs",
            doneKey: "rq:done",
            failKey: "rq:fail",
            retryDelay: 1000,
            nextJobProcessDelay: 300,
            redisUrl: "",
        };
        this.state = {
            done: {},
            queue: [],
            jobs: {},
            currentJobSuccess: true
        };
        this.queueProcess = this.queueProcess.bind(this);
        if (options) {
            if (options.retryDelay !== undefined) {
                this.option.retryDelay = options.retryDelay;
            }
            if (options.nextJobProcessDelay !== undefined) {
                this.option.nextJobProcessDelay = options.nextJobProcessDelay;
            }
            if (options.redisUrl)
                this.option.redisUrl = options.redisUrl;
        }
        if (queueName) {
            this.option.jobsKey = `rq:${queueName}:jobs`;
            this.option.doneKey = `rq:${queueName}:done`;
            this.option.failKey = `rq:${queueName}:fail`;
            this.queueName = queueName;
        }
        this.connectRedis();
    }
    pullFromRedis() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const redisJobs = yield this.client.hGetAll(this.option.jobsKey);
                this.state.jobs = redisJobs;
                const jobKeys = Object.keys(this.state.jobs);
                this.state.queue = jobKeys;
                return this.state.queue;
            }
            catch (ex) {
                return [];
            }
        });
    }
    preparedRedisToState() {
        return __awaiter(this, void 0, void 0, function* () {
            const queue = yield this.pullFromRedis();
            if (!queue.length) {
                return clearTimeout(this.intervalId);
            }
            yield this.queueProcess();
            this.emit("ready", this.state);
        });
    }
    connectRedis() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                this.client = (0, redis_1.createClient)({
                    pingInterval: 5000,
                    url: this.option.redisUrl
                });
                this.client.on('connect', () => __awaiter(this, void 0, void 0, function* () {
                    this.emit('redis-connected');
                    this.preparedRedisToState().catch(ex => {
                        console.error(ex);
                    });
                }));
                this.client.on('error', (err) => {
                    this.emit('redis-connection-fail', err);
                });
                yield this.client.connect();
                console.info("redis-connected-for " + ((_a = this.queueName) === null || _a === void 0 ? void 0 : _a.toString()));
            }
            catch (ex) {
                this.emit('redis-connection-fail', ex);
            }
        });
    }
    createJob(jobId, value) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                let data = JSON.stringify(value);
                yield this.client.hSet(this.option.jobsKey, {
                    [jobId]: data
                });
                this.state.jobs[jobId] = data;
                this.state.queue.push(jobId);
                // this.emit("new", jobId, data)
            }
            catch (ex) {
                // revert...
                delete this.state.jobs[jobId];
                this.state.queue = this.state.queue.filter(el => el !== jobId);
                // await this.queueProcess()
                console.error(ex === null || ex === void 0 ? void 0 : ex.message);
            }
            finally {
                yield this.queueProcess();
            }
        });
    }
    slats() {
        const doneCount = Object.keys(this.state.done).length;
        const pendingCount = Object.keys(this.state.jobs).length;
        console.error(`${this.queueName} stats:: Done: ${doneCount} Jobs: ${pendingCount}`);
    }
    interval() {
        try {
            this.intervalId = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                yield this.queueProcess();
            }), 10);
        }
        catch (ex) {
            console.error(ex === null || ex === void 0 ? void 0 : ex.message);
        }
    }
    queueProcess() {
        return __awaiter(this, void 0, void 0, function* () {
            const nextTimeout = this.state.currentJobSuccess
                ? this.option.nextJobProcessDelay
                : this.option.retryDelay;
            clearTimeout(this.intervalId);
            this.intervalId = setTimeout(() => {
                const jobs = this.state.jobs;
                let queueTask = this.state.queue[0];
                if (!queueTask) {
                    return clearTimeout(this.intervalId);
                }
                const jobDetail = jobs[queueTask];
                this.emit("processing", queueTask, jobDetail, (isDone) => __awaiter(this, void 0, void 0, function* () {
                    if (isDone) {
                        this.state.queue.shift();
                        delete this.state.jobs[queueTask];
                        yield this.client.hDel(this.option.jobsKey, queueTask);
                    }
                    else {
                        const el = this.state.queue.shift();
                        el && this.state.queue.push(el);
                        //update job on queue
                        this.emit("fail", queueTask, jobDetail);
                        //     this.state.currentJobSuccess = false
                    }
                    if (this.state.queue.length) {
                        this.queueProcess();
                    }
                    else {
                        const reFetch = yield this.pullFromRedis();
                        if (reFetch.length)
                            return this.queueProcess();
                        clearTimeout(this.intervalId);
                        this.emit("finished", this.state);
                    }
                }));
            }, nextTimeout);
        });
    }
}
exports.default = RsQueue;
