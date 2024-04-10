import {EventEmitter} from "events";
import {createClient} from "redis";

interface RsQueueOptions {
    jobsKey: string;
    doneKey: string;
    retryDelay?: number;
    nextJobProcessDelay?: number;
    redisUrl: string;
}

class RsQueue extends EventEmitter {

    private option = {
        jobsKey: "rq:jobs",
        doneKey: "rq:done",
        failKey: "rq:fail",
        retryDelay: 1000,
        nextJobProcessDelay: 300,
        redisUrl: "",
    };

    private queueName: string | undefined
    private intervalId: NodeJS.Timeout | undefined;

    private state = {
        done: {} as Record<string, string>,
        queue: [] as string[],
        jobs: {} as Record<string, string>,
        currentJobSuccess: true
    };

    private client: any | undefined;

    constructor(queueName: string, options: Partial<RsQueueOptions>) {
        super()
        this.queueProcess = this.queueProcess.bind(this)
        if (options) {
            if (options.retryDelay !== undefined) {
                this.option.retryDelay = options.retryDelay
            }

            if (options.nextJobProcessDelay !== undefined) {
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

    private async pullFromRedis() {
        try {
            const redisJobs = await this.client.hGetAll(this.option.jobsKey);
            this.state.jobs = redisJobs
            const jobKeys = Object.keys(this.state.jobs);
            this.state.queue = jobKeys
            return this.state.queue
        } catch (ex) {
            return []
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

    public async createJob(jobId: string, value: object) {
        try {

            let data = JSON.stringify(value)

            await this.client.hSet(this.option.jobsKey, {
                [jobId]: data
            })

            this.state.jobs[jobId] = data
            this.state.queue.push(jobId)

            // this.emit("new", jobId, data)

        } catch (ex: any) {
            // revert...
            delete this.state.jobs[jobId]
            this.state.queue = this.state.queue.filter(el => el !== jobId)

            // await this.queueProcess()
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

    interval() {
        try {
            this.intervalId = setTimeout(async () => {
                await this.queueProcess()
            }, 10)

        } catch (ex: any) {
            console.error(ex?.message)
        }
    }


    async queueProcess() {
        const nextTimeout = this.state.currentJobSuccess
            ? this.option.nextJobProcessDelay
            : this.option.retryDelay
        clearTimeout(this.intervalId)

        this.intervalId = setTimeout(() => {
            const jobs = this.state.jobs;
            let queueTask = this.state.queue[0]

            if (!queueTask) {
                return clearTimeout(this.intervalId)
            }

            const jobDetail = jobs[queueTask]

            this.emit("processing", queueTask, jobDetail, async (isDone: boolean) => {
                if (isDone) {
                    this.state.queue.shift()
                    delete this.state.jobs[queueTask]
                    await this.client.hDel(this.option.jobsKey, queueTask)

                } else {
                    const el = this.state.queue.shift()
                    el && this.state.queue.push(el)
                    //update job on queue
                    this.emit("fail", queueTask, jobDetail)
                    //     this.state.currentJobSuccess = false
                }

                if (this.state.queue.length) {
                    this.queueProcess()
                } else {
                    const reFetch = await this.pullFromRedis()
                    if (reFetch.length) return this.queueProcess()

                    clearTimeout(this.intervalId)
                    this.emit("finished", this.state)
                }
            })
        }, nextTimeout)
    }
}

export default RsQueue
