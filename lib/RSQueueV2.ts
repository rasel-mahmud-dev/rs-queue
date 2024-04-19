import {EventEmitter} from "events";
import {createClient} from "redis";

interface RsQueueOptions {
    jobsKey: string;
    doneKey: string;
    // Avoids rapid churn during processing of nearly-concurrent events.
    // Will be overridden, if pass job delayUntil greater than -1
    delayedDebounce?: number,
    redisUrl: string;
}


type JobOpt = {
    retries: number,
    delayUntil: number,
}

interface Job {
    jobId: string,
    value: JobData | null,
    opt: JobOpt,
    save: () => Promise<void>,
    retries: (n: number) => Job
    // Job processing start delay timeout
    delayUntil: (milisecond: number) => Job
}

type State = {
    done: Record<string, string>,
    queue: string[]
}

type JobData = {
    data: any,
    opt: JobOpt
}

type RsQueueEvent =
    | 'ready'
    | 'redis-connected'
    | 'redis-connection-fail'
    | 'fail'
    | 'retrying'
    | 'done'
    | 'finished'
    | 'processing'
    | 'new'
    | 'reset';

type Ready = (state: State) => void;
type RedisConnected = () => void;
type RedisConnectionFail = (ex: any) => void;
type Fail = (jobId: string, jobData: JobData, state: State) => void;
type Retrying = (jobId: string, jobData: JobData, state: State) => void;
type Done = (jobId: string, jobData: JobData, state: State) => void;
type Finished = (state: State) => void;
type New = (jobId: string, jobData: JobData, state: State) => void;
type Processing = (jobId: string, jobData: JobData, done: (success: boolean) => void) => void;
type Reset = (state: State) => void;


type EventCallback = Fail | Retrying | Done | Finished | New | Processing | Ready | RedisConnected | RedisConnectionFail | Reset

class RsQueue extends EventEmitter {
    on(event: 'ready', listener: Ready): this;
    on(event: 'redis-connected', listener: RedisConnected): this;
    on(event: 'redis-connection-fail', listener: RedisConnectionFail): this;
    on(event: 'fail', listener: Fail): this;
    on(event: 'retrying', listener: Retrying): this;
    on(event: 'done', listener: Done): this;
    on(event: 'finished', listener: Finished): this;
    on(event: 'processing', listener: Processing): this;
    on(event: 'new', listener: New): this;
    on(event: 'reset', listener: Reset): this;

    on(event: RsQueueEvent, listener: EventCallback): this {
        return super.on(event, listener);
    }

    emit(event: RsQueueEvent, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    private option = {
        jobsKey: "rq:jobs",
        doneKey: "rq:done",
        failKey: "rq:fail",
        delayedDebounce: 1000,
        redisUrl: "",
    };

    job: Job = {
        jobId: "",
        value: null,
        opt: {
            retries: -1,
            delayUntil: -1,
        },
        save: this.save.bind(this),
        retries: this.retries.bind(this),
        delayUntil: this.delayUntil.bind(this)
    }

    private queueName: string | undefined
    private intervalId: NodeJS.Timeout | undefined;

    private state: State = {
        done: {},
        queue: []
    };

    private client: any | undefined;

    constructor(queueName: string, options: Partial<RsQueueOptions>) {
        super()
        this.queueProcess = this.queueProcess.bind(this)

        if (options?.delayedDebounce !== undefined) {
            this.option.delayedDebounce = options.delayedDebounce
        }

        if (options?.redisUrl) this.option.redisUrl = options.redisUrl


        if (queueName) {
            this.option.jobsKey = `rq:${queueName}:jobs`
            this.option.doneKey = `rq:${queueName}:done`
            this.option.failKey = `rq:${queueName}:fail`
            this.queueName = queueName
        }

        this.connectRedis()
    }

    private async pullFromRedis() {
        try {
            const redisJobs = await this.client.hGetAll(this.option.jobsKey);
            const queue = Object.keys(redisJobs)
            this.state.queue = queue
            return queue
        } catch (ex) {
            return []
        }
    }

    private async restoreJobs() {
        try {
            await this.client.DEL(this.option.jobsKey);
            this.state.queue = []
            this.emit("reset", this.state)
        } catch (ex) {
            throw Error("Could not restore jobs: " + ex)
        }
    }

    private async preparedRedisToState() {
        const queue = await this.pullFromRedis()

        if (!queue.length) {
            return clearTimeout(this.intervalId)
        }

        await this.queueProcess()
        this.emit("ready", this.state)
    }

    async connectRedis() {
        try {
            this.client = createClient({
                pingInterval: 5000,
                url: this.option.redisUrl
            });

            this.client.on('connect', async () => {
                this.emit('redis-connected');
                this.preparedRedisToState().catch(ex => {
                    console.error(ex)
                })
            });

            this.client.on('error', (err: any) => {
                this.emit('redis-connection-fail', err);
            });

            await this.client.connect()

            console.info("redis-connected-for " + this.queueName?.toString())

        } catch (ex: any) {
            this.emit('redis-connection-fail', ex);
        }
    }

    public createJob(jobId: string, value: any) {
        this.job["jobId"] = jobId.toString()
        this.job["value"] = value
        return this.job
    }

    retries(n: number) {
        this.job.opt.retries = n
        return this.job
    }

    delayUntil(milisecond: number) {
        this.job.opt.delayUntil = milisecond
        return this.job
    }

    async save() {

        const {jobId, value, opt} = this.job

        if (!jobId) return console.error("Invalid Job ID")

        try {
            const jobDetail: JobData = {
                data: value,
                opt: opt
            }

            await this.client.hSet(this.option.jobsKey, {
                [jobId]: JSON.stringify(jobDetail)
            })

            this.state.queue.push(jobId)

            this.emit("new", jobId, jobDetail)

        } catch (ex: any) {
            // revert...
            this.state.queue = this.state.queue.filter(el => el !== jobId)
            throw Error("Failed to save job: " + ex?.message)
        } finally {
            await this.queueProcess()
        }
    }

    slats() {
        const doneCount = Object.keys(this.state.done).length;
        // const pendingCount = Object.keys(this.state.jobs).length;
        console.error(`${this.queueName} stats:: Done: ${doneCount} Jobs: ${"not implemented"}`);
    }


    hasRetries(jobDetailObj: any) {
        return jobDetailObj?.opt?.retries
    }

    async downRetryingCount(jobDetailObj: JobData, jobId: string) {
        try {
            const retries = jobDetailObj?.opt?.retries
            if (retries === -1) {
                this.emit("fail", jobId, jobDetailObj)
                return;
            }

            const updatedJob = {
                ...jobDetailObj,
                opt: {
                    ...jobDetailObj.opt,
                    retries: jobDetailObj.opt.retries - 1
                }
            }

            if (updatedJob?.opt?.retries === 0) {
                this.emit("fail", jobId, jobDetailObj)
            } else {
                this.emit("retrying", jobId, jobDetailObj)
            }

            await this.client.hSet(this.option.jobsKey, {
                [jobId]: JSON.stringify(updatedJob)
            })

        } catch {
            // revert if redis not update
        }

    }

    async removeJobFromQueue(jobId: any) {
        try {
            this.state.queue = this.state.queue.filter(el => el !== jobId)
            await this.client.hDel(this.option.jobsKey, jobId)
            return 1
        } catch (ex: any) {
            throw new Error("Job remove fail: " + ex?.message)
        }
    }

    async getJobDetail(jobId: string) {
        try {
            const jobData = await this.client.hGet(this.option.jobsKey, jobId)
            return JSON.parse(jobData) as JobData
        } catch (ex: any) {
            return null
        }
    }


    async queueProcess() {

        let nextTimeout = this.option.delayedDebounce

        clearTimeout(this.intervalId)

        let queueTask = this.state.queue[0]

        if (!queueTask) return clearTimeout(this.intervalId)


        const jobDetail = await this.getJobDetail(queueTask)
        if(!jobDetail) return clearTimeout(this.intervalId)

        const delayUntil = jobDetail?.opt?.delayUntil
        if (delayUntil != -1) {
            nextTimeout = delayUntil
        }

        this.intervalId = setTimeout(() => {

            if (!queueTask) {
                return clearTimeout(this.intervalId)
            }

            const retriesCount = this.hasRetries(jobDetail)
            if (retriesCount === 0) {
                this.removeJobFromQueue(queueTask)
                this.jobStarted()
                return;
            }

            this.emit("processing", queueTask, jobDetail, async (isDone: boolean) => {
                if (isDone) {
                    await this.client.hDel(this.option.jobsKey, queueTask)
                    this.state.queue.shift()
                    this.emit("done", queueTask, jobDetail, this.state)
                } else {
                    await this.downRetryingCount(jobDetail, queueTask)
                }
                const firstJob = this.state.queue.shift()
                firstJob && this.state.queue.push(firstJob)
                this.jobStarted()

            })
        }, nextTimeout)
    }

    async jobStarted() {
        if (this.state.queue.length) {
            this.queueProcess()
        } else {

            const reFetch = await this.pullFromRedis()
            if (reFetch.length) return this.queueProcess()

            clearTimeout(this.intervalId)
            this.emit("finished", this.state)
        }
    }
}

export default RsQueue
