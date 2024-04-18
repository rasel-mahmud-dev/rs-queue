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
    on(event, listener) {
        return super.on(event, listener);
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    constructor(queueName, options) {
        super();
        this.option = {
            jobsKey: "rq:jobs",
            doneKey: "rq:done",
            failKey: "rq:fail",
            delayedDebounce: 1000,
            redisUrl: "",
        };
        this.job = {
            jobId: "",
            value: null,
            opt: {
                retries: -1,
                delayUntil: -1,
            },
            save: this.save.bind(this),
            retries: this.retries.bind(this),
            delayUntil: this.delayUntil.bind(this)
        };
        this.state = {
            done: {},
            queue: [],
            jobs: {},
            currentJobSuccess: true
        };
        this.queueProcess = this.queueProcess.bind(this);
        if ((options === null || options === void 0 ? void 0 : options.delayedDebounce) !== undefined) {
            this.option.delayedDebounce = options.delayedDebounce;
        }
        if (options === null || options === void 0 ? void 0 : options.redisUrl)
            this.option.redisUrl = options.redisUrl;
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
                const jsMapping = {};
                const queue = [];
                for (let redisJobsKey in redisJobs) {
                    const data = redisJobs[redisJobsKey];
                    if (!data)
                        continue;
                    const jsData = JSON.parse(data);
                    if (!jsData)
                        continue;
                    jsMapping[redisJobsKey] = jsData;
                    queue.push(redisJobsKey);
                }
                this.state.jobs = jsMapping;
                this.state.queue = queue;
                return queue;
            }
            catch (ex) {
                return [];
            }
        });
    }
    restoreJobs() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.client.DEL(this.option.jobsKey);
                this.state.jobs = {};
                this.state.queue = [];
            }
            catch (ex) {
                throw Error("Could not restore jobs: " + ex);
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
        this.job["jobId"] = jobId.toString();
        this.job["value"] = value;
        return this.job;
    }
    retries(n) {
        this.job.opt.retries = n;
        return this.job;
    }
    delayUntil(milisecond) {
        this.job.opt.delayUntil = milisecond;
        return this.job;
    }
    save() {
        return __awaiter(this, void 0, void 0, function* () {
            const { jobId, value, opt } = this.job;
            if (!jobId)
                return console.error("Invalid Job ID");
            try {
                const jobDetail = {
                    data: value,
                    opt: opt
                };
                yield this.client.hSet(this.option.jobsKey, {
                    [jobId]: JSON.stringify(jobDetail)
                });
                this.state.jobs[jobId] = jobDetail;
                this.state.queue.push(jobId);
                this.emit("new", jobId, jobDetail);
            }
            catch (ex) {
                // revert...
                delete this.state.jobs[jobId];
                this.state.queue = this.state.queue.filter(el => el !== jobId);
                throw Error("Failed to save job: " + (ex === null || ex === void 0 ? void 0 : ex.message));
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
    hasRetries(jobDetailObj) {
        var _a;
        return (_a = jobDetailObj === null || jobDetailObj === void 0 ? void 0 : jobDetailObj.opt) === null || _a === void 0 ? void 0 : _a.retries;
    }
    hasRetries2(jobDetailObj, jobId) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const retries = (_a = jobDetailObj === null || jobDetailObj === void 0 ? void 0 : jobDetailObj.opt) === null || _a === void 0 ? void 0 : _a.retries;
                if (retries === -1)
                    return;
                const updatedJob = Object.assign(Object.assign({}, jobDetailObj), { opt: Object.assign(Object.assign({}, jobDetailObj.opt), { retries: jobDetailObj.opt.retries - 1 }) });
                this.state.jobs[jobId] = updatedJob;
                yield this.client.hSet(this.option.jobsKey, {
                    [jobId]: JSON.stringify(updatedJob)
                });
            }
            catch (_b) {
                // revert if redis not update
                this.state.jobs[jobId] = jobDetailObj;
            }
        });
    }
    removeJobFromQueue(jobId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                this.state.queue = this.state.queue.filter(el => el !== jobId);
                delete this.state.jobs[jobId];
                yield this.client.hDel(this.option.jobsKey, jobId);
                return 1;
            }
            catch (ex) {
                throw new Error("Job remove fail: " + (ex === null || ex === void 0 ? void 0 : ex.message));
            }
        });
    }
    queueProcess() {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            let nextTimeout = this.option.delayedDebounce;
            clearTimeout(this.intervalId);
            const jobDetail = (_a = this.state.jobs) === null || _a === void 0 ? void 0 : _a[(_b = this.state.queue) === null || _b === void 0 ? void 0 : _b[0]];
            const delayUntil = (_c = jobDetail === null || jobDetail === void 0 ? void 0 : jobDetail.opt) === null || _c === void 0 ? void 0 : _c.delayUntil;
            if (delayUntil != -1) {
                nextTimeout = delayUntil;
            }
            this.intervalId = setTimeout(() => {
                const jobs = this.state.jobs;
                let queueTask = this.state.queue[0];
                if (!queueTask) {
                    return clearTimeout(this.intervalId);
                }
                const jobDetail = jobs[queueTask];
                const retriesCount = this.hasRetries(jobDetail);
                if (retriesCount === 0) {
                    this.removeJobFromQueue(queueTask);
                    this.jobStarted();
                    return;
                }
                this.emit("processing", queueTask, jobDetail, (isDone) => __awaiter(this, void 0, void 0, function* () {
                    if (isDone) {
                        delete this.state.jobs[queueTask];
                        yield this.client.hDel(this.option.jobsKey, queueTask);
                        this.state.queue.shift();
                    }
                    else {
                        yield this.hasRetries2(jobDetail, queueTask);
                        this.emit("fail", queueTask, jobDetail);
                    }
                    const firstJob = this.state.queue.shift();
                    firstJob && this.state.queue.push(firstJob);
                    this.jobStarted();
                }));
            }, nextTimeout);
        });
    }
    jobStarted() {
        return __awaiter(this, void 0, void 0, function* () {
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
        });
    }
}
exports.default = RsQueue;
