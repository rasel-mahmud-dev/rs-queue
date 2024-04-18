import {EventEmitter} from "events";
import {createClient} from "redis";

interface RsQueueOptions {
    jobsKey: string;
    doneKey: string;
    // Avoids rapid churn during processing of nearly-concurrent events.
    delayedDebounce?: number,
    retryDelay?: number;
    nextJobProcessDelay?: number;
    redisUrl: string;
}

type RsQueueEvent =
    | 'ready'
    | 'redis-connected'
    | 'redis-connection-fail'
    | 'fail'
    | 'done'
    | 'finished'
    | 'processing'
    | 'new';


type JobOpt = {
    retries: number,
    delayUntil: number,
}

interface Job {
    jobId: string,
    value: object | null,
    opt: JobOpt,
    save: () => Promise<void>,
    retries: (n: number) => Job
    delayUntil: (milisecond: number) => Job
}

class RsQueue extends EventEmitter {
    on(event: RsQueueEvent, listener: (...args: any[]) => void): this {
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

    private state = {
        done: {} as Record<string, string>,
        queue: [] as string[],
        jobs: {} as Record<string, string | any>,
        currentJobSuccess: true
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
            const jsMapping: { [key: string]: any } = {}
            const queue: string[] = []
            for (let redisJobsKey in redisJobs) {
                const data = redisJobs[redisJobsKey]
                if (!data) continue;
                const jsData = JSON.parse(data)
                if (!jsData) continue;
                jsMapping[redisJobsKey] = jsData
                queue.push(redisJobsKey)
            }
            this.state.jobs = jsMapping
            this.state.queue = queue
            return queue
        } catch (ex) {
            return []
        }
    }

    private async restoreJobs() {
        try {
            await this.client.DEL(this.option.jobsKey);
            this.state.jobs = {}
            this.state.queue = []
        } catch (ex) {

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

    public createJob(jobId: string, value: object) {
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
            const jobDetail = {
                data: value,
                opt: opt
            }

            const result = await this.client.hSet(this.option.jobsKey, {
                [jobId]: JSON.stringify(jobDetail)
            })

            this.state.jobs[jobId] = jobDetail
            this.state.queue.push(jobId)

            this.emit("new", jobId, jobDetail)

        } catch (ex: any) {
            // revert...
            delete this.state.jobs[jobId]
            this.state.queue = this.state.queue.filter(el => el !== jobId)
            console.error(ex?.message)
        } finally {
            await this.queueProcess()
        }
    }

    slats() {
        const doneCount = Object.keys(this.state.done).length;
        const pendingCount = Object.keys(this.state.jobs).length;
        console.error(`${this.queueName} stats:: Done: ${doneCount} Jobs: ${pendingCount}`);
    }


    hasRetries(jobDetailObj: any) {
        return jobDetailObj?.opt?.retries || 0
    }

    async hasRetries2(jobDetailObj: any, jobId: string) {
        try {
            const updatedJob = {
                ...jobDetailObj,
                opt: {
                    ...jobDetailObj.opt,
                    retries: jobDetailObj.opt.retries - 1
                }
            }

            this.state.jobs[jobId] = updatedJob
            await this.client.hSet(this.option.jobsKey, {
                [jobId]: JSON.stringify(updatedJob)
            })

        } catch {
            // revert if redis not update
            this.state.jobs[jobId] = jobDetailObj
        }

    }

    async removeJobFromQueue(jobId: any) {
        try {
            this.state.queue = this.state.queue.filter(el => el !== jobId)
            delete this.state.jobs[jobId]
            await this.client.hDel(this.option.jobsKey, jobId)
            return 1
        } catch (ex: any) {
            throw new Error("Job remove fail: " + ex?.message)
        }
    }


    async queueProcess() {

        let nextTimeout = this.option.delayedDebounce

        clearTimeout(this.intervalId)


        const jobDetail = this.state.jobs?.[this.state.queue?.[0]];
        const delayUntil = jobDetail?.opt?.delayUntil
        if(delayUntil != -1){
            nextTimeout = delayUntil
        }

        this.intervalId = setTimeout(() => {
            const jobs = this.state.jobs;
            let queueTask = this.state.queue[0]

            if (!queueTask) {
                return clearTimeout(this.intervalId)
            }

            const jobDetail = jobs[queueTask]


            if (!this.hasRetries(jobDetail)) {
                this.removeJobFromQueue(queueTask)
                this.jobStarted()
                return;
            }

            this.emit("processing", queueTask, jobDetail, async (isDone: boolean) => {
                if (isDone) {
                    delete this.state.jobs[queueTask]
                    await this.client.hDel(this.option.jobsKey, queueTask)

                } else {
                    await this.hasRetries2(jobDetail, queueTask)
                    this.emit("fail", queueTask, jobDetail)
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
