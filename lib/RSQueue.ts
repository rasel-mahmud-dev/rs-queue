import {EventEmitter} from "events";
import {createClient} from "redis";

interface RsQueueOptions {
    jobsKey: string;
    doneKey: string;
    retryDelay?: number;
    nextJobProcessDelay?: number;
    redisUrl?: string;
}

class RsQueue extends EventEmitter {

    private option: RsQueueOptions = {
        jobsKey: "rq:jobs",
        doneKey: "rq:done",
        retryDelay: 2000,
        nextJobProcessDelay: 300,
        redisUrl: "",
    };


    private intervalId: NodeJS.Timeout | undefined;

    private state = {
        done: {} as Record<string, string>,
        queue: [] as string[],
        jobs: {} as Record<string, string>,
        currentJobSuccess: false
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
        }

        this.connectRedis()
    }

    async connectRedis() {
        try {
            this.client = createClient({
                url: this.option.redisUrl ?? "redis://127.0.0.1:6379"
            });

            await this.client.connect()
            this.state.jobs = await this.client.hGetAll(this.option.jobsKey);
            let jobKeys = Object.keys(this.state.jobs);
            this.state.queue = jobKeys
            if (this.state.queue.length) {
                clearTimeout(this.intervalId)
                this.interval()
            } else {
                clearTimeout(this.intervalId)
            }
            this.emit("ready")
        } catch (ex: any) {
            console.log("Redis connection fail:::", ex?.message)
        }
    }

    public async createJob(jobId: string, value: any) {
        try {
            const jobValueStr = JSON.stringify(value)
            await this.client.hSet(this.option.jobsKey, {
                [jobId]: jobValueStr
            })

            this.state.jobs[jobId] = jobValueStr
            this.state.queue.push(jobId)
            this.emit("new", jobId, value)

            clearTimeout(this.intervalId)
            await this.queueProcess()

        } catch (ex: any) {
            console.log(ex?.message)
        }
    }

    slats() {
        const doneCount = Object.keys(this.state.done).length;
        const pendingCount = Object.keys(this.state.jobs).length;

        const green = "\x1b[32m";
        const yellow = "\x1b[33m";
        const reset = "\x1b[0m";

        console.log(`
   ${green}Done: ${doneCount}${reset}
   ${yellow}Jobs: ${pendingCount}${reset}
    `);
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
            console.log(ex?.message)
        }
    }

    async queueProcess() {
        try {
            const jobs = this.state.jobs;
            let queueTask = this.state.queue[0]
            if (!queueTask) {
                return clearTimeout(this.intervalId)
            }
            const data = jobs[queueTask]

            this.emit("processing", queueTask, data, async (isDone: boolean) => {
                if (isDone) {
                    delete this.state.jobs[queueTask]
                    await this.client.hDel(this.option.jobsKey, queueTask)
                    await this.client.lPush(this.option.doneKey, queueTask)
                    this.state.done[queueTask] = jobs[queueTask]
                    this.state.queue.shift()
                    this.emit("done", queueTask, data)
                    this.state.currentJobSuccess = true
                } else {
                    this.state.queue.shift()
                    this.state.queue.push(queueTask)
                    this.emit("fail", queueTask, data)
                    this.state.currentJobSuccess = false
                }

                if (this.state.queue?.length) {
                    this.interval()
                } else {
                    // queue list empty
                    clearTimeout(this.intervalId)
                    this.emit("finished", queueTask)
                }
            })
        } catch (ex: any) {
            console.log(ex?.message)
        }
    }
}

export default RsQueue

