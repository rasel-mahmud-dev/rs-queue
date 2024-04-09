import {EventEmitter} from "events";
import {createClient} from "redis";
import assert from "node:assert";

interface RsQueueOptions {
    jobsKey: string;
    doneKey: string;
    retryDelay?: number;
    nextJobProcessDelay?: number;
    redisUrl: string;
}

type JobOpt = {
    retries: number,
    delayUntil: number,
    timeout: number,
}

interface Job {
    jobId: string,
    value: object | null,
    opt: JobOpt,
    save: () => void,
    retries: (n: number) => Job
    delayUntil: (milisecond: number) => Job
    timeout: (milisecond: number) => Job
}

class RsQueue extends EventEmitter {

    private option = {
        jobsKey: "rq:jobs",
        doneKey: "rq:done",
        failKey: "rq:fail",
        retryDelay: 2000,
        nextJobProcessDelay: 300,
        redisUrl: "",
    };

    job: Job = {
        jobId: "",
        value: null,
        opt: {
            retries: -1,
            delayUntil: -1,
            timeout: -1,
        },
        save: this.save.bind(this),
        retries: this.retries.bind(this),
        delayUntil: this.delayUntil.bind(this),
        timeout: this.timeout.bind(this)
    }

    private queueName: string | undefined
    private intervalId: NodeJS.Timeout | undefined;

    private state = {
        done: {} as Record<string, string>,
        queue: [] as string[],
        jobs: {} as Record<string, {
            data: object | null,
            opt: JobOpt
        }>,
        currentJobSuccess: true
    };

    private client: any | undefined;

    constructor(queueName: string, options: Partial<RsQueueOptions>) {
        super()

        if (options) {
            if (options.retryDelay || options.retryDelay === 0) {
                this.option.retryDelay = options.retryDelay
            }

            if (options.nextJobProcessDelay || options.nextJobProcessDelay === 0) {
                this.option.nextJobProcessDelay = options.nextJobProcessDelay
            }

            if (options.redisUrl) this.option.redisUrl = options.redisUrl
        }

        if (queueName) {
            this.option.jobsKey = `rq:${queueName}:jobs`
            this.option.doneKey = `rq:${queueName}:done`
            this.option.failKey = `rq:${queueName}:fail`
            this.queueName = queueName
        }

        this.connectRedis()
    }

    private async preparedRedisToState() {
        const redisJobs = await this.client.hGetAll(this.option.jobsKey);
        let jobs = redisJobs || {}
        for (let jobKey in jobs) {
            jobs[jobKey] = JSON.parse(jobs[jobKey])
        }
        this.state.jobs = jobs
        const jobKeys = Object.keys(this.state.jobs);
        this.state.queue = jobKeys
        if (this.state.queue.length) {
            this.interval()
        } else {
            clearTimeout(this.intervalId)
        }
        this.emit("ready")
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
        this.job["jobId"] = jobId
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

    timeout(milisecond: number) {
        this.job.opt.timeout = milisecond
        return this.job
    }

    async save() {
        try {

            const {jobId, value, opt} = this.job

            const jobDetail = {
                data: value,
                opt: opt
            }
            const result = await this.client.hSet(this.option.jobsKey, {
                [jobId]: JSON.stringify(jobDetail)
            })

            if (result) {
                this.state.jobs[jobId] = jobDetail
                this.state.queue.push(jobId)
                this.emit("new", jobId, value)
            }

            clearTimeout(this.intervalId)
            await this.queueProcess()

        } catch (ex: any) {
            clearTimeout(this.intervalId)
            await this.queueProcess()
            console.error(ex?.message)
        }
    }

    slats() {
        const doneCount = Object.keys(this.state.done).length;
        const pendingCount = Object.keys(this.state.jobs).length;
        console.error(`${this.queueName} stats:: Done: ${doneCount} Jobs: ${pendingCount}`);
    }

    interval() {
        try {
            clearTimeout(this.intervalId);
            this.intervalId = setTimeout(async () => {
                    await this.queueProcess()
                }, this.state.currentJobSuccess
                    ? this.option.nextJobProcessDelay
                    : this.option.retryDelay
            )

        } catch (ex: any) {
            console.error(ex?.message)
        }
    }

    async queueProcess() {
        const jobs = this.state.jobs;
        let queueTask = this.state.queue[0]
        if (!queueTask) {
            return clearTimeout(this.intervalId)
        }
        const jobDetail = jobs[queueTask]

        const {opt, data} = jobDetail

        let {retries, delayUntil, timeout} = opt

        if (retries !== -1) {
            if (retries > 0) {
                retries--
            }

            if (retries === 0) {
                this.state.queue = this.state.queue.filter(q => q !== queueTask)
                delete this.state.jobs[queueTask]
                await this.client.hDel(this.option.jobsKey, queueTask)
                await this.client.hSet(this.option.failKey, {
                    [queueTask]: JSON.stringify(data || {})
                })
                if (this.state.queue?.length) {
                    this.interval()
                }
                return;
            }
        }

        this.emit("processing", queueTask, jobDetail, async (isDone: boolean) => {

            if (isDone) {
                delete this.state.jobs[queueTask]
                await this.client.hDel(this.option.jobsKey, queueTask)

                // await this.client.lPush(this.option.doneKey, queueTask) // not need to store a done job

                this.state.done[queueTask] = jobs[queueTask]
                this.state.queue.shift()
                this.emit("done", queueTask, jobDetail)
                this.state.currentJobSuccess = true
            } else {
                this.state.queue.shift()
                this.state.queue.push(queueTask)

                //update job on queue
                this.emit("fail", queueTask, jobDetail)
                this.state.currentJobSuccess = false
            }

            // update job detail
            const updateOpt = {
                timeout,
                delayUntil,
                retries
            }

            if (retries !== -1) {
                this.state.jobs[queueTask].opt = updateOpt
                await this.client.hSet(this.option.jobsKey, {
                    [queueTask]: JSON.stringify({
                        opt: updateOpt,
                        data
                    })
                })
            }

            if (this.state.queue?.length) {
                this.interval()
            } else {
                // queue list empty
                clearTimeout(this.intervalId)
                this.emit("finished", queueTask)
            }
        })
    }
}

export default RsQueue
